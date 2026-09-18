import type { ChainId } from "./vasunthara/deployments";
import { getDeployment } from "./vasunthara/deployments";
import { tickToPriceAdjusted } from "./vasunthara/format";
import type { PoolKey } from "./vasunthara/pool-id";
import { derivePoolId } from "./vasunthara/pool-id";
import type {
  FeeGrowthGlobals,
  QuoteResult,
  Slot0,
} from "./vasunthara/reader";
import { VasuntharaReader } from "./vasunthara/reader";
import type { PoolObservation } from "./vasunthara/strategy";
import { providerFor } from "./rpc";
import { type TokenMeta, readTokenMeta } from "./tokens";

export type PoolSnapshot = {
  /** Exactly the shape the library's strategy layer consumes. */
  readonly observation: PoolObservation;
  readonly token0: TokenMeta;
  readonly token1: TokenMeta;
  /** The PoolManager this chain's StateView reads from, read live. */
  readonly poolManager: string;
  readonly feeGrowth: FeeGrowthGlobals;
  /**
   * False when the pool has never been initialised. StateView reads storage
   * rather than reverting, so an uninitialised pool answers with zeros and a
   * caller that does not check this reads price 0 as a real price.
   */
  readonly exists: boolean;
  /** currency1 per currency0, adjusted for both tokens' decimals. */
  readonly price: number;
};

/**
 * Read everything a decision needs about a pool, in as few round trips as the
 * endpoint allows. The reads are independent, so they go out together: on a
 * public RPC the latency dominates and doing them in sequence is visibly slow.
 */
export async function loadPoolSnapshot(
  chainId: ChainId,
  poolKey: PoolKey,
): Promise<PoolSnapshot> {
  const poolId = derivePoolId(poolKey);
  const provider = providerFor(chainId);
  const reader = new VasuntharaReader(provider, chainId);

  const [slot0, liquidity, feeGrowth, poolManager, blockNumber, token0, token1] =
    await Promise.all([
      reader.getSlot0(poolId),
      reader.getLiquidity(poolId),
      reader.getFeeGrowthGlobals(poolId),
      reader.poolManager(),
      provider.getBlockNumber(),
      readTokenMeta(provider, poolKey.currency0),
      readTokenMeta(provider, poolKey.currency1),
    ]);

  return {
    observation: {
      poolId,
      poolKey,
      slot0,
      liquidity,
      blockNumber,
      // The reading's own timestamp, which is what the staleness guard measures
      // against. Taken here rather than inside the guard so a replay can pass
      // the original value back in and get the original decision.
      observedAt: Math.floor(Date.now() / 1000),
    },
    token0,
    token1,
    poolManager,
    feeGrowth,
    exists: slot0.sqrtPriceX96 > 0n,
    price: tickToPriceAdjusted(slot0.tick, token0.decimals, token1.decimals),
  };
}

/**
 * A hook-aware quote for a swap through this exact pool. The quoter forwards
 * hookData to the hook the same way a real swap would, so a hook that prices
 * differently from the curve shows up here rather than at fill time.
 */
export async function loadQuote(
  chainId: ChainId,
  poolKey: PoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
): Promise<QuoteResult> {
  const reader = new VasuntharaReader(providerFor(chainId), chainId);
  return await reader.quoteExactInputSingle(poolKey, zeroForOne, amountIn);
}

export type PositionSnapshot = {
  readonly tokenId: bigint;
  readonly poolKey: PoolKey;
  readonly poolId: string;
  readonly liquidity: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly hasHook: boolean;
  readonly dynamicFee: boolean;
  readonly owner: string | null;
};

/**
 * Read a position NFT: which hooked pool it sits in, its range and its
 * liquidity. The range comes out of the packed info word, which is the only
 * place PositionManager puts it.
 *
 * Returns null for a token id that was never minted or has been burned. That
 * call does not revert, it answers with zeros, so this is the check between a
 * caller and acting on a position that is not there.
 */
export async function loadPosition(
  chainId: ChainId,
  tokenId: bigint,
): Promise<PositionSnapshot | null> {
  const provider = providerFor(chainId);
  const reader = new VasuntharaReader(provider, chainId);
  const info = await reader.getPoolAndPositionInfo(tokenId);
  if (!info.exists || !info.range) {
    return null;
  }
  const [liquidity, owner] = await Promise.all([
    reader.getPositionLiquidity(tokenId),
    reader.ownerOf(tokenId).catch(() => null),
  ]);
  return {
    tokenId,
    poolKey: info.poolKey,
    poolId: derivePoolId(info.poolKey),
    liquidity,
    tickLower: info.range.tickLower,
    tickUpper: info.range.tickUpper,
    hasHook: info.hasHook,
    dynamicFee: info.dynamicFee,
    owner,
  };
}

/** The next token id PositionManager will mint, a cheap liveness probe. */
export async function loadNextTokenId(chainId: ChainId): Promise<bigint> {
  const reader = new VasuntharaReader(providerFor(chainId), chainId);
  return await reader.nextTokenId();
}

export type Slot0View = Slot0;

/** The lens addresses this library ships for a chain, for the evidence panel. */
export function lensesFor(chainId: ChainId) {
  const d = getDeployment(chainId);
  return [
    { name: "PoolManager", address: d.poolManager },
    { name: "StateView", address: d.stateView },
    { name: "PositionManager", address: d.positionManager },
    { name: "V4Quoter", address: d.quoter },
  ];
}
