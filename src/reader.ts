import { Contract, type Provider } from "ethers";
import { POSITION_MANAGER_ABI, QUOTER_ABI, STATE_VIEW_ABI } from "./abis.js";
import { type ChainId, getDeployment } from "./deployments.js";
import { hasHook, isDynamicFee, type PoolKey } from "./pool-id.js";

export type Slot0 = {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
};

export type FeeGrowthGlobals = {
  feeGrowthGlobal0: bigint;
  feeGrowthGlobal1: bigint;
};

export type TickLiquidity = {
  liquidityGross: bigint;
  liquidityNet: bigint;
};

export type PoolPositionInfo = {
  poolKey: PoolKey;
  /** Packed position info word (tickLower, tickUpper, hasSubscriber). */
  info: bigint;
  /** True when the pool this position sits in has a hook. */
  hasHook: boolean;
  /** True when the pool's fee is hook-controlled. */
  dynamicFee: boolean;
};

export type QuoteResult = {
  amount: bigint;
  gasEstimate: bigint;
};

/**
 * The read layer for automating Uniswap V4 hook strategies.
 *
 * Every method is a view call against the canonical V4 lens contracts for a
 * chain (StateView, PositionManager, V4Quoter), so it needs only a provider,
 * no signer and no gas. These are the reads a deterministic strategy is built
 * on: monitor a pool by poolId (limit orders, rebalancing), inspect a position
 * and the hook it sits behind (rebalance/compound), and price a swap through a
 * specific hooked pool (fill).
 */
export class VasuntharaReader {
  readonly chainId: ChainId;
  private readonly stateView: Contract;
  private readonly positionManager: Contract;
  private readonly quoter: Contract;

  constructor(provider: Provider, chainId: ChainId) {
    const d = getDeployment(chainId);
    this.chainId = chainId;
    this.stateView = new Contract(d.stateView, STATE_VIEW_ABI, provider);
    this.positionManager = new Contract(
      d.positionManager,
      POSITION_MANAGER_ABI,
      provider,
    );
    this.quoter = new Contract(d.quoter, QUOTER_ABI, provider);
  }

  // ---- StateView: pool monitoring ----------------------------------------

  /** Current price, tick and fees for a pool. The core monitoring read. */
  async getSlot0(poolId: string): Promise<Slot0> {
    const r = await this.stateView.getSlot0(poolId);
    return {
      sqrtPriceX96: r[0],
      tick: Number(r[1]),
      protocolFee: Number(r[2]),
      lpFee: Number(r[3]),
    };
  }

  /** Total in-range liquidity of a pool. Watch for it draining to exit. */
  async getLiquidity(poolId: string): Promise<bigint> {
    return await this.stateView.getLiquidity(poolId);
  }

  /** Global fee-growth accumulators. Rising values signal fees to compound. */
  async getFeeGrowthGlobals(poolId: string): Promise<FeeGrowthGlobals> {
    const r = await this.stateView.getFeeGrowthGlobals(poolId);
    return { feeGrowthGlobal0: r[0], feeGrowthGlobal1: r[1] };
  }

  /** Gross and net liquidity at a tick. Size a rebalance range. */
  async getTickLiquidity(poolId: string, tick: number): Promise<TickLiquidity> {
    const r = await this.stateView.getTickLiquidity(poolId, tick);
    return { liquidityGross: r[0], liquidityNet: r[1] };
  }

  /** The singleton PoolManager this StateView reads from. */
  async poolManager(): Promise<string> {
    return await this.stateView.poolManager();
  }

  // ---- PositionManager: position monitoring ------------------------------

  /** The token id the next minted position will get (a monotone invariant). */
  async nextTokenId(): Promise<bigint> {
    return await this.positionManager.nextTokenId();
  }

  /** Liquidity of a position NFT. The value a rebalance or exit acts on. */
  async getPositionLiquidity(tokenId: bigint): Promise<bigint> {
    return await this.positionManager.getPositionLiquidity(tokenId);
  }

  /**
   * The pool a position belongs to (including its hook) plus the packed info
   * word. Tells a workflow which hooked pool a position sits in before it
   * rebalances.
   */
  async getPoolAndPositionInfo(tokenId: bigint): Promise<PoolPositionInfo> {
    const r = await this.positionManager.getPoolAndPositionInfo(tokenId);
    const k = r[0];
    const poolKey: PoolKey = {
      currency0: k[0],
      currency1: k[1],
      fee: Number(k[2]),
      tickSpacing: Number(k[3]),
      hooks: k[4],
    };
    return {
      poolKey,
      info: r[1],
      hasHook: hasHook(poolKey.hooks),
      dynamicFee: isDynamicFee(poolKey.fee),
    };
  }

  /** Owner of a position NFT. */
  async ownerOf(tokenId: bigint): Promise<string> {
    return await this.positionManager.ownerOf(tokenId);
  }

  // ---- V4Quoter: hook-aware pricing --------------------------------------

  /**
   * Simulate a single-hop exact-input swap through a specific pool, including
   * its hook. hookData is forwarded to the hook exactly as an on-chain swap
   * would, so the quote reflects the hooked pool a fill will execute in.
   */
  async quoteExactInputSingle(
    poolKey: PoolKey,
    zeroForOne: boolean,
    exactAmount: bigint,
    hookData = "0x",
  ): Promise<QuoteResult> {
    const r = await this.quoter.quoteExactInputSingle.staticCall({
      poolKey,
      zeroForOne,
      exactAmount,
      hookData,
    });
    return { amount: r[0], gasEstimate: r[1] };
  }

  /** Exact-output variant: the input required for a target output. */
  async quoteExactOutputSingle(
    poolKey: PoolKey,
    zeroForOne: boolean,
    exactAmount: bigint,
    hookData = "0x",
  ): Promise<QuoteResult> {
    const r = await this.quoter.quoteExactOutputSingle.staticCall({
      poolKey,
      zeroForOne,
      exactAmount,
      hookData,
    });
    return { amount: r[0], gasEstimate: r[1] };
  }
}
