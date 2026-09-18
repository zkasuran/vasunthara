// Independent verification that a transaction really did swap a specific
// Uniswap V4 pool.
//
// This exists because of how KeeperHub executes. Writes are relayed and the
// gas is sponsored, so the explorer shows a KeeperHub relayer as `from` and
// its executor contract as `to`. Neither is our wallet and neither is Uniswap.
// The sender column therefore proves nothing about which pool was traded.
//
// What does prove it is the `Swap` event the PoolManager emits, whose first
// indexed topic is the poolId. One PoolManager serves every pool on a chain,
// so matching that topic against a poolId derived from the PoolKey is what
// ties a transaction to one specific hooked pool.
//
// Nothing here asks KeeperHub whether the run worked. A platform confirming
// its own work is not independent evidence, so every field below is read from
// a plain JSON-RPC provider.

import { Interface, type Provider } from "ethers";
import { POOL_MANAGER_EVENTS_ABI } from "./abis.js";
import { type ChainId, getDeployment } from "./deployments.js";

const poolManagerEvents = new Interface(POOL_MANAGER_EVENTS_ABI);

/**
 * topic0 of the PoolManager `Swap` event, derived from the ABI rather than
 * pasted in, so it cannot drift from the signature this library decodes with.
 * A test pins it to the value observed in real Ethereum Sepolia logs.
 */
export const SWAP_EVENT_TOPIC =
  poolManagerEvents.getEvent("Swap")?.topicHash ?? "";

/** The parts of a log this module needs, so a fixture can stand in for one. */
export type MinimalLog = {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
};

/** A decoded PoolManager `Swap` event. */
export type SwapEvent = {
  readonly poolId: string;
  readonly sender: string;
  /**
   * Signed deltas from the pool's point of view: negative is what the pool
   * received, positive is what it paid out. So a swap spending currency0 has a
   * negative amount0 and a positive amount1.
   */
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly sqrtPriceX96: bigint;
  readonly liquidity: bigint;
  readonly tick: number;
  readonly fee: number;
};

/** True when a log is a PoolManager `Swap`, ignoring which pool it is for. */
export function isSwapLog(log: MinimalLog): boolean {
  return log.topics[0]?.toLowerCase() === SWAP_EVENT_TOPIC.toLowerCase();
}

/**
 * Decode a `Swap` log. Throws when the log is not a Swap, rather than
 * returning a half-filled object, because a caller that ignores the error
 * would report another event's data as a fill.
 */
export function decodeSwapLog(log: MinimalLog): SwapEvent {
  if (!isSwapLog(log)) {
    throw new Error(
      `log topic0 ${log.topics[0]} is not the PoolManager Swap topic ${SWAP_EVENT_TOPIC}`,
    );
  }
  const parsed = poolManagerEvents.decodeEventLog(
    "Swap",
    log.data,
    log.topics as string[],
  );
  return {
    poolId: String(parsed[0]),
    sender: String(parsed[1]),
    amount0: BigInt(parsed[2]),
    amount1: BigInt(parsed[3]),
    sqrtPriceX96: BigInt(parsed[4]),
    liquidity: BigInt(parsed[5]),
    tick: Number(parsed[6]),
    fee: Number(parsed[7]),
  };
}

/**
 * Find the `Swap` a receipt emitted for one specific pool.
 *
 * Both filters matter. The address filter rejects a look-alike event from
 * another contract, and the topic1 filter rejects a swap that went through the
 * same PoolManager but a different pool, which is the common case since every
 * pool on a chain shares that contract.
 */
export function findPoolSwapLog(
  logs: readonly MinimalLog[],
  poolManager: string,
  poolId: string,
): SwapEvent | null {
  const manager = poolManager.toLowerCase();
  const wanted = poolId.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== manager || !isSwapLog(log)) {
      continue;
    }
    if (log.topics[1]?.toLowerCase() === wanted) {
      return decodeSwapLog(log);
    }
  }
  return null;
}

/** Every `Swap` a receipt emitted on a chain's PoolManager, in log order. */
export function findAllSwapLogs(
  logs: readonly MinimalLog[],
  poolManager: string,
): readonly SwapEvent[] {
  const manager = poolManager.toLowerCase();
  const found: SwapEvent[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() === manager && isSwapLog(log)) {
      found.push(decodeSwapLog(log));
    }
  }
  return found;
}

/** Why a verification passed or failed. Stable strings, safe to branch on. */
export type VerdictCode =
  | "verified"
  | "receipt-not-found"
  | "reverted"
  | "no-v4-swap"
  | "pool-mismatch";

export type SwapReceiptVerification = {
  readonly hash: string;
  readonly chainId: ChainId;
  readonly verdict: VerdictCode;
  /** One line stating what was proved or what was missing. */
  readonly summary: string;
  readonly blockNumber: number | null;
  readonly gasUsed: bigint | null;
  /** The relayer that submitted it under sponsored execution. */
  readonly from: string | null;
  /** The executor contract, not the Uniswap router. */
  readonly to: string | null;
  readonly logCount: number;
  readonly poolManager: string;
  /** The Swap for the expected pool, when one is present. */
  readonly swap: SwapEvent | null;
  /** Every Swap on this chain's PoolManager, for when the expected one missed. */
  readonly otherSwaps: readonly SwapEvent[];
};

/**
 * Verify on chain that a transaction swapped an expected Uniswap V4 pool.
 *
 * `poolId` is the pool the caller believes was traded, normally derived from a
 * PoolKey rather than pasted in. The verdict separates the three ways this can
 * fail that mean different things: the transaction reverted, it succeeded but
 * touched no V4 pool at all, or it swapped a different pool than expected.
 */
export async function verifySwapReceipt(
  provider: Provider,
  params: {
    hash: string;
    chainId: ChainId;
    poolId: string;
  },
): Promise<SwapReceiptVerification> {
  const deployment = getDeployment(params.chainId);
  const base = {
    hash: params.hash,
    chainId: params.chainId,
    poolManager: deployment.poolManager,
  };

  const receipt = await provider.getTransactionReceipt(params.hash);
  if (!receipt) {
    return {
      ...base,
      verdict: "receipt-not-found",
      summary:
        "no receipt on this chain: the transaction is unknown, still pending, or on a different network",
      blockNumber: null,
      gasUsed: null,
      from: null,
      to: null,
      logCount: 0,
      swap: null,
      otherSwaps: [],
    };
  }

  const found = {
    ...base,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    from: receipt.from,
    to: receipt.to,
    logCount: receipt.logs.length,
  };

  if (receipt.status !== 1) {
    return {
      ...found,
      verdict: "reverted",
      summary: `transaction reverted in block ${receipt.blockNumber}, so nothing moved`,
      swap: null,
      otherSwaps: [],
    };
  }

  const swap = findPoolSwapLog(
    receipt.logs,
    deployment.poolManager,
    params.poolId,
  );
  if (swap) {
    return {
      ...found,
      verdict: "verified",
      summary: `PoolManager emitted Swap for ${params.poolId} in block ${receipt.blockNumber}: amount0 ${swap.amount0}, amount1 ${swap.amount1}, tick now ${swap.tick}`,
      swap,
      otherSwaps: [],
    };
  }

  const others = findAllSwapLogs(receipt.logs, deployment.poolManager);
  if (others.length === 0) {
    return {
      ...found,
      verdict: "no-v4-swap",
      summary: `transaction succeeded but emitted no Uniswap V4 Swap on ${deployment.poolManager}`,
      swap: null,
      otherSwaps: [],
    };
  }
  return {
    ...found,
    verdict: "pool-mismatch",
    summary: `transaction swapped ${others.length} other V4 pool(s) but not ${params.poolId}`,
    swap: null,
    otherSwaps: others,
  };
}
