// GENERATED FILE. Do not edit.
//
// Copied verbatim from src/simulate.ts by scripts/sync-site-lib.mjs.
// Change the original and run `npm run sync:site` from the repository root.
// `npm run check:site` fails when this copy drifts from src/.
//
// This exists because Vercel builds the site with site/ as its root directory
// and cannot reach src/ without a project setting a fresh clone would lack.

// Dry runs and incident controls.
//
// The brief KeeperHub wrote for this hackathon puts it plainly: an agent
// composes a workflow, you review it, you dry run it without touching the
// chain, then that exact workflow executes. This module is the dry run and the
// kill switch.
//
// A simulation is worth more than a gas estimate here, because a V4 swap can
// succeed and still be a bad trade. The hook prices it, so the only way to know
// what a fill returns is to ask the chain to run it.

import { Interface, type Provider } from "ethers";
import type { WorkflowNode } from "./keeperhub.js";
import { POOL_SWAP_TEST_ABI, type V4SwapPlan } from "./swap.js";

/**
 * V4 returns a BalanceDelta: one int256 word holding two signed int128s,
 * amount0 in the high half and amount1 in the low half. It is not two return
 * values and it is not a struct, so a naive decode reads one enormous number.
 *
 * Sign convention is from the caller's side: negative means the caller paid it
 * to the pool, positive means the pool paid it to the caller.
 */
export function decodeBalanceDelta(raw: string): {
  amount0: bigint;
  amount1: bigint;
} {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (hex.length < 64) {
    throw new Error(`BalanceDelta must be 32 bytes, got ${hex.length / 2}`);
  }
  const word = hex.slice(0, 64);
  return {
    amount0: toInt128(word.slice(0, 32)),
    amount1: toInt128(word.slice(32, 64)),
  };
}

function toInt128(half: string): bigint {
  const value = BigInt(`0x${half}`);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
}

export type SwapSimulation = {
  /** Signed deltas exactly as the pool reports them. */
  readonly amount0: bigint;
  readonly amount1: bigint;
  /** What the caller pays, always positive. */
  readonly amountIn: bigint;
  /** What the caller receives, always positive. */
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
};

/**
 * Run the planned swap with `eth_call` and report what it would return.
 *
 * Nothing is signed and nothing is broadcast. A revert surfaces here as a
 * thrown error rather than as a failed transaction that still cost gas, which
 * is the entire point of doing it first.
 *
 * Compare the result against the strategy's own minimum-out before sending. A
 * simulation that succeeds is not the same as a fill worth taking: a hostile or
 * misconfigured hook can return a legal but terrible price, and this is where
 * that shows up.
 */
export async function simulateSwap(
  provider: Provider,
  plan: V4SwapPlan,
  from: string,
): Promise<SwapSimulation> {
  const iface = new Interface(POOL_SWAP_TEST_ABI as unknown as string[]);
  const data = iface.encodeFunctionData("swap", [
    [
      plan.poolKey.currency0,
      plan.poolKey.currency1,
      plan.poolKey.fee,
      plan.poolKey.tickSpacing,
      plan.poolKey.hooks,
    ],
    [plan.zeroForOne, plan.amountSpecified, plan.sqrtPriceLimitX96],
    [false, false],
    plan.hookData,
  ]);

  const tx = { to: plan.router, data, from, value: plan.valueWei };
  const [raw, gasEstimate] = await Promise.all([
    provider.call(tx),
    provider.estimateGas(tx),
  ]);

  const { amount0, amount1 } = decodeBalanceDelta(raw);
  const amountIn = plan.zeroForOne ? -amount0 : -amount1;
  const amountOut = plan.zeroForOne ? amount1 : amount0;

  return { amount0, amount1, amountIn, amountOut, gasEstimate };
}

/**
 * Check a simulated fill against the floor the strategy computed.
 * Returns null when it passes, or the reason it does not.
 */
export function checkSimulation(
  simulation: SwapSimulation,
  minAmountOut: bigint,
  expectedAmountIn: bigint,
): string | null {
  if (simulation.amountOut < minAmountOut) {
    return `simulated out ${simulation.amountOut} is below the floor ${minAmountOut}`;
  }
  if (simulation.amountIn !== expectedAmountIn) {
    return `simulated in ${simulation.amountIn} does not match the planned ${expectedAmountIn}`;
  }
  if (simulation.amountOut <= 0n) {
    return "simulated fill returns nothing";
  }
  return null;
}

/**
 * Engage KeeperHub's organisation-wide circuit breaker.
 *
 * Tripping it fails every value-moving workflow and protocol step in the
 * organisation closed, including runs already in progress, until an admin
 * resets it. Read-only actions keep running, which is what makes it usable as
 * an incident switch rather than a full stop: monitoring still reports while
 * nothing can spend.
 *
 * It always targets the organisation that owns the running workflow. There is
 * no target field, so a workflow cannot trip somebody else's breaker.
 */
export function tripCircuitBreakerNode(params: {
  id: string;
  label?: string;
  reason: string;
  x: number;
}): WorkflowNode {
  return {
    id: params.id,
    type: "action",
    position: { x: params.x, y: 160 },
    data: {
      label: params.label ?? "Trip Circuit Breaker",
      description: "fail every value-moving step closed until an admin resets",
      type: "action",
      status: "idle",
      config: {
        actionType: "Trip Circuit Breaker",
        reason: params.reason,
      },
    },
  };
}

/**
 * Clear the breaker. Privileged: this only succeeds when the workflow's
 * creator is currently an admin or owner of the organisation.
 */
export function resetCircuitBreakerNode(params: {
  id: string;
  label?: string;
  x: number;
}): WorkflowNode {
  return {
    id: params.id,
    type: "action",
    position: { x: params.x, y: 160 },
    data: {
      label: params.label ?? "Reset Circuit Breaker",
      description: "clear the incident breaker so runs resume",
      type: "action",
      status: "idle",
      config: { actionType: "Reset Circuit Breaker" },
    },
  };
}

/**
 * A sanity gate to sit between a read and a write.
 *
 * Its false branch is where a Trip Circuit Breaker belongs: a pool that reads
 * as empty, or a hook that has moved the fee to something absurd, is not a
 * "skip this run" condition. It means an assumption the strategy rests on has
 * stopped holding, and continuing to trade through it is how an automated
 * system turns a bad minute into a bad day.
 */
export function sanityGate(params: {
  id: string;
  label: string;
  /** Node id and label of the read whose result is being checked. */
  readNodeId: string;
  readNodeLabel: string;
  minLiquidity: bigint;
  maxLpFee: number;
  x: number;
}): WorkflowNode {
  const liquidity = `{{@${params.readNodeId}:${params.readNodeLabel}.result.liquidity}}`;
  const fee = `{{@${params.readNodeId}:${params.readNodeLabel}.result.lpFee}}`;
  return {
    id: params.id,
    type: "action",
    position: { x: params.x, y: 0 },
    data: {
      label: params.label,
      description: "refuse to trade a pool that has stopped looking sane",
      type: "action",
      status: "idle",
      config: {
        actionType: "Condition",
        condition: `${liquidity} >= ${params.minLiquidity.toString()} && ${fee} <= ${params.maxLpFee}`,
      },
    },
  };
}
