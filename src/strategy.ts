// The deterministic decision layer.
//
// Every strategy here is a pure function from an observation of Uniswap V4
// state to a decision. No clock, no network, no randomness: the same
// observation always produces the same decision, which is what makes a run
// reproducible and a refusal explainable. Nothing in this file signs or sends
// anything; turning an action into calldata is the planner's job.
//
// Guards run before the strategy, in a fixed order, so a skip always carries
// the first reason that applied rather than whichever check happened to run.

import type { PoolKey } from "./pool-id.js";
import type { Slot0 } from "./reader.js";

const UINT256_MASK = (1n << 256n) - 1n;
const Q128 = 1n << 128n;
const BPS_DENOMINATOR = 10_000n;

/** The largest and smallest tick Uniswap V4 allows. */
export const MIN_TICK = -887_272;
export const MAX_TICK = 887_272;

/**
 * Fee growth accumulators are unsigned and are allowed to overflow, so the
 * difference between two readings is taken modulo 2^256. Subtracting them as
 * plain integers goes negative across a wrap and reads as "no fees earned"
 * exactly when the most fees have been earned.
 */
export function wrappingDelta(current: bigint, last: bigint): bigint {
  return (current - last) & UINT256_MASK;
}

/**
 * Round a tick down to a multiple of tickSpacing. V4 only allows initialised
 * ticks on the spacing grid, so a computed range has to be snapped to it or
 * the mint reverts. Rounds toward negative infinity, matching Solidity's
 * compress() rather than its truncating division.
 */
export function alignTickDown(tick: number, tickSpacing: number): number {
  if (tickSpacing <= 0) {
    throw new Error(`tickSpacing must be positive, got ${tickSpacing}`);
  }
  const quotient = Math.floor(tick / tickSpacing);
  return quotient * tickSpacing;
}

/** Clamp a tick into the range V4 accepts, on the spacing grid. */
export function clampTick(tick: number, tickSpacing: number): number {
  const lowest = alignTickDown(MIN_TICK, tickSpacing) + tickSpacing;
  const highest = alignTickDown(MAX_TICK, tickSpacing);
  return Math.min(Math.max(tick, lowest), highest);
}

/** Why a strategy declined to act. Stable strings, safe to alert on. */
export type SkipCode =
  | "stale-observation"
  | "pool-too-thin"
  | "fee-above-cap"
  | "order-expired"
  | "trigger-not-reached"
  | "quote-below-limit"
  | "position-empty"
  | "position-in-range"
  | "drift-within-tolerance"
  | "fees-below-threshold";

/** Numbers behind a decision, as strings so a log line never loses precision. */
export type Evidence = Readonly<Record<string, string>>;

export type Decision<TAction> =
  | {
      readonly act: true;
      readonly action: TAction;
      readonly reason: string;
      readonly evidence: Evidence;
    }
  | {
      readonly act: false;
      readonly code: SkipCode;
      readonly reason: string;
      readonly evidence: Evidence;
    };

/** A reading of pool state, with the block and time it was taken at. */
export type PoolObservation = {
  readonly poolId: string;
  readonly poolKey: PoolKey;
  readonly slot0: Slot0;
  readonly liquidity: bigint;
  readonly blockNumber: number;
  /** Unix seconds at which this reading was taken. */
  readonly observedAt: number;
};

/**
 * The checks that apply to every strategy. They exist because the expensive
 * failures in automated DeFi are not wrong maths, they are acting on a reading
 * that was already old, on a pool too thin to fill, or through a hook that has
 * raised the fee since the order was written.
 */
export type Guards = {
  /** Refuse an observation older than this many seconds. */
  readonly maxObservationAgeSec: number;
  /** Refuse to act when in-range liquidity is below this. */
  readonly minPoolLiquidity?: bigint;
  /**
   * Refuse when the pool's live LP fee exceeds this, in hundredths of a bip.
   * A dynamic-fee hook can move the fee between writing an order and filling
   * it, and this is the only thing that catches that.
   */
  readonly maxLpFeeHundredthsBip?: number;
};

function guardEvidence(
  observation: PoolObservation,
  now: number,
): Record<string, string> {
  return {
    poolId: observation.poolId,
    tick: String(observation.slot0.tick),
    lpFee: String(observation.slot0.lpFee),
    liquidity: observation.liquidity.toString(),
    blockNumber: String(observation.blockNumber),
    ageSec: String(now - observation.observedAt),
  };
}

/**
 * Run the shared guards. Returns the blocking decision, or null to proceed.
 * `now` is passed in rather than read from a clock so the caller controls
 * time and a replay reproduces exactly.
 */
export function checkGuards(
  observation: PoolObservation,
  guards: Guards,
  now: number,
): Decision<never> | null {
  const evidence = guardEvidence(observation, now);
  const age = now - observation.observedAt;

  if (age > guards.maxObservationAgeSec || age < 0) {
    return {
      act: false,
      code: "stale-observation",
      reason: `observation is ${age}s old, limit is ${guards.maxObservationAgeSec}s`,
      evidence,
    };
  }
  if (
    guards.minPoolLiquidity !== undefined &&
    observation.liquidity < guards.minPoolLiquidity
  ) {
    return {
      act: false,
      code: "pool-too-thin",
      reason: `pool liquidity ${observation.liquidity} is below the ${guards.minPoolLiquidity} floor`,
      evidence,
    };
  }
  if (
    guards.maxLpFeeHundredthsBip !== undefined &&
    observation.slot0.lpFee > guards.maxLpFeeHundredthsBip
  ) {
    return {
      act: false,
      code: "fee-above-cap",
      reason: `live lpFee ${observation.slot0.lpFee} is above the ${guards.maxLpFeeHundredthsBip} cap`,
      evidence,
    };
  }
  return null;
}

// ---- Limit order --------------------------------------------------------

/**
 * A resting order that fills when the pool's tick crosses a level.
 *
 * Tick orientation, because getting it backwards silently inverts the order:
 * price is currency1 per currency0 and equals 1.0001^tick, so the price of
 * currency0 RISES as the tick rises. Selling currency0 therefore waits for the
 * tick to reach `triggerTick` from below, and selling currency1 waits for it to
 * fall to `triggerTick` from above.
 */
export type LimitOrderConfig = {
  readonly poolKey: PoolKey;
  /** True to sell currency0 for currency1 (a zeroForOne swap). */
  readonly sellCurrency0: boolean;
  readonly triggerTick: number;
  readonly amountIn: bigint;
  /** Tolerated shortfall against the quote, in basis points. */
  readonly slippageBps: number;
  /** Unix seconds after which the order must not fill. */
  readonly expiresAt: number;
  readonly guards: Guards;
};

export type LimitOrderFill = {
  readonly kind: "limit-order-fill";
  readonly poolKey: PoolKey;
  readonly zeroForOne: boolean;
  readonly amountIn: bigint;
  /** The floor to hand the executor, derived from the live quote. */
  readonly minAmountOut: bigint;
};

/** Apply slippage tolerance to a quote, rounding down. */
export function applySlippage(
  quotedAmountOut: bigint,
  slippageBps: number,
): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`slippageBps must be within 0..10000, got ${slippageBps}`);
  }
  const keep = BPS_DENOMINATOR - BigInt(slippageBps);
  return (quotedAmountOut * keep) / BPS_DENOMINATOR;
}

/**
 * Decide whether a limit order fills.
 *
 * `quotedAmountOut` must come from the hook-aware quoter against this exact
 * pool, because a hook can price a swap differently from the curve alone.
 * `minAcceptableOut` is the order's own hard floor, independent of slippage,
 * and it is what stops a hook that has quietly turned hostile from filling the
 * order at any price.
 */
export function decideLimitOrder(
  observation: PoolObservation,
  config: LimitOrderConfig,
  quotedAmountOut: bigint,
  now: number,
  minAcceptableOut = 0n,
): Decision<LimitOrderFill> {
  const blocked = checkGuards(observation, config.guards, now);
  if (blocked) {
    return blocked;
  }

  const { tick } = observation.slot0;
  const evidence: Evidence = {
    ...guardEvidence(observation, now),
    triggerTick: String(config.triggerTick),
    side: config.sellCurrency0 ? "sell-currency0" : "sell-currency1",
    quotedAmountOut: quotedAmountOut.toString(),
  };

  if (now > config.expiresAt) {
    return {
      act: false,
      code: "order-expired",
      reason: `order expired at ${config.expiresAt}, now ${now}`,
      evidence,
    };
  }

  const reached = config.sellCurrency0
    ? tick >= config.triggerTick
    : tick <= config.triggerTick;
  if (!reached) {
    const direction = config.sellCurrency0 ? "rise to" : "fall to";
    return {
      act: false,
      code: "trigger-not-reached",
      reason: `tick ${tick} has not ${direction} ${config.triggerTick}`,
      evidence,
    };
  }

  const minAmountOut = applySlippage(quotedAmountOut, config.slippageBps);
  if (minAmountOut < minAcceptableOut) {
    return {
      act: false,
      code: "quote-below-limit",
      reason: `slippage-adjusted out ${minAmountOut} is below the ${minAcceptableOut} floor`,
      evidence: { ...evidence, minAmountOut: minAmountOut.toString() },
    };
  }

  return {
    act: true,
    action: {
      kind: "limit-order-fill",
      poolKey: config.poolKey,
      zeroForOne: config.sellCurrency0,
      amountIn: config.amountIn,
      minAmountOut,
    },
    reason: `tick ${tick} crossed ${config.triggerTick}`,
    evidence: { ...evidence, minAmountOut: minAmountOut.toString() },
  };
}

// ---- Rebalance ----------------------------------------------------------

/** A liquidity position, as PositionManager and StateView describe it. */
export type PositionObservation = {
  readonly tokenId: bigint;
  readonly poolKey: PoolKey;
  readonly liquidity: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
};

export type RebalanceConfig = {
  /**
   * How far past its edge the tick must travel before a rebalance is allowed.
   * This is hysteresis: without it a tick sitting on the boundary rebalances
   * on every block and pays fees to stand still.
   */
  readonly driftToleranceTicks: number;
  /** Width of the replacement range. Defaults to the current width. */
  readonly widthTicks?: number;
  readonly guards: Guards;
};

export type RebalanceAction = {
  readonly kind: "rebalance";
  readonly tokenId: bigint;
  readonly poolKey: PoolKey;
  readonly liquidity: bigint;
  readonly fromTickLower: number;
  readonly fromTickUpper: number;
  readonly toTickLower: number;
  readonly toTickUpper: number;
};

/** True when the tick sits inside the position's range, V4's convention. */
export function isInRange(tick: number, lower: number, upper: number): boolean {
  return tick >= lower && tick < upper;
}

/**
 * Centre a range of the given width on a tick, snapped to the spacing grid and
 * clamped to V4's limits. Width is rounded up to at least one spacing so the
 * result is always a valid, non-empty range.
 */
export function centredRange(
  tick: number,
  widthTicks: number,
  tickSpacing: number,
): { tickLower: number; tickUpper: number } {
  const halfWidth = Math.max(Math.floor(widthTicks / 2), tickSpacing);
  const lower = clampTick(
    alignTickDown(tick - halfWidth, tickSpacing),
    tickSpacing,
  );
  const rawUpper = alignTickDown(tick + halfWidth, tickSpacing);
  const upper = clampTick(Math.max(rawUpper, lower + tickSpacing), tickSpacing);
  return { tickLower: lower, tickUpper: upper };
}

/**
 * Decide whether a position should move to a new range. Fires only once the
 * tick is outside the range by more than the tolerance, and the replacement
 * range keeps the original width unless one is given.
 */
export function decideRebalance(
  observation: PoolObservation,
  position: PositionObservation,
  config: RebalanceConfig,
  now: number,
): Decision<RebalanceAction> {
  const blocked = checkGuards(observation, config.guards, now);
  if (blocked) {
    return blocked;
  }

  const { tick } = observation.slot0;
  const width = config.widthTicks ?? position.tickUpper - position.tickLower;
  const evidence: Evidence = {
    ...guardEvidence(observation, now),
    tokenId: position.tokenId.toString(),
    tickLower: String(position.tickLower),
    tickUpper: String(position.tickUpper),
    positionLiquidity: position.liquidity.toString(),
  };

  if (position.liquidity === 0n) {
    return {
      act: false,
      code: "position-empty",
      reason: `position ${position.tokenId} holds no liquidity`,
      evidence,
    };
  }
  if (isInRange(tick, position.tickLower, position.tickUpper)) {
    return {
      act: false,
      code: "position-in-range",
      reason: `tick ${tick} is inside [${position.tickLower}, ${position.tickUpper})`,
      evidence,
    };
  }

  const drift =
    tick < position.tickLower
      ? position.tickLower - tick
      : tick - (position.tickUpper - 1);
  if (drift <= config.driftToleranceTicks) {
    return {
      act: false,
      code: "drift-within-tolerance",
      reason: `drift of ${drift} ticks is within the ${config.driftToleranceTicks} tolerance`,
      evidence: { ...evidence, driftTicks: String(drift) },
    };
  }

  const next = centredRange(tick, width, position.poolKey.tickSpacing);
  return {
    act: true,
    action: {
      kind: "rebalance",
      tokenId: position.tokenId,
      poolKey: position.poolKey,
      liquidity: position.liquidity,
      fromTickLower: position.tickLower,
      fromTickUpper: position.tickUpper,
      toTickLower: next.tickLower,
      toTickUpper: next.tickUpper,
    },
    reason: `tick ${tick} drifted ${drift} ticks past the range`,
    evidence: {
      ...evidence,
      driftTicks: String(drift),
      toTickLower: String(next.tickLower),
      toTickUpper: String(next.tickUpper),
    },
  };
}

// ---- Fee compounding ----------------------------------------------------

/** A position's stored fee-growth checkpoint, from StateView. */
export type FeeCheckpoint = {
  readonly feeGrowthInside0LastX128: bigint;
  readonly feeGrowthInside1LastX128: bigint;
};

/** Fee growth inside the range as of now, from StateView. */
export type FeeGrowthInsideNow = {
  readonly feeGrowthInside0X128: bigint;
  readonly feeGrowthInside1X128: bigint;
};

export type CompoundConfig = {
  /** Fire once either side reaches its floor. Omit a side to ignore it. */
  readonly minFees0?: bigint;
  readonly minFees1?: bigint;
  readonly guards: Guards;
};

export type CompoundAction = {
  readonly kind: "compound-fees";
  readonly tokenId: bigint;
  readonly poolKey: PoolKey;
  readonly fees0: bigint;
  readonly fees1: bigint;
};

/**
 * Fees a position is owed, by Uniswap's own formula:
 *
 *   owed = liquidity * (feeGrowthInsideNow - feeGrowthInsideLast) / 2^128
 *
 * The subtraction wraps, which is why it goes through wrappingDelta. Reading
 * the two accumulators and doing this arithmetic is the only way to value
 * uncollected fees without simulating a collect.
 */
export function feesOwed(
  liquidity: bigint,
  checkpoint: FeeCheckpoint,
  current: FeeGrowthInsideNow,
): { fees0: bigint; fees1: bigint } {
  const delta0 = wrappingDelta(
    current.feeGrowthInside0X128,
    checkpoint.feeGrowthInside0LastX128,
  );
  const delta1 = wrappingDelta(
    current.feeGrowthInside1X128,
    checkpoint.feeGrowthInside1LastX128,
  );
  return {
    fees0: (liquidity * delta0) / Q128,
    fees1: (liquidity * delta1) / Q128,
  };
}

/** Decide whether uncollected fees are worth a compounding transaction. */
export function decideCompound(
  observation: PoolObservation,
  position: PositionObservation,
  checkpoint: FeeCheckpoint,
  current: FeeGrowthInsideNow,
  config: CompoundConfig,
  now: number,
): Decision<CompoundAction> {
  const blocked = checkGuards(observation, config.guards, now);
  if (blocked) {
    return blocked;
  }

  const evidence: Evidence = {
    ...guardEvidence(observation, now),
    tokenId: position.tokenId.toString(),
    positionLiquidity: position.liquidity.toString(),
  };

  if (position.liquidity === 0n) {
    return {
      act: false,
      code: "position-empty",
      reason: `position ${position.tokenId} holds no liquidity`,
      evidence,
    };
  }

  const { fees0, fees1 } = feesOwed(position.liquidity, checkpoint, current);
  const withFees: Evidence = {
    ...evidence,
    fees0: fees0.toString(),
    fees1: fees1.toString(),
  };

  const hit0 = config.minFees0 !== undefined && fees0 >= config.minFees0;
  const hit1 = config.minFees1 !== undefined && fees1 >= config.minFees1;
  if (!(hit0 || hit1)) {
    return {
      act: false,
      code: "fees-below-threshold",
      reason: `fees ${fees0}/${fees1} are below the configured floor`,
      evidence: withFees,
    };
  }

  return {
    act: true,
    action: {
      kind: "compound-fees",
      tokenId: position.tokenId,
      poolKey: position.poolKey,
      fees0,
      fees1,
    },
    reason: `uncollected fees reached the floor on ${hit0 ? "currency0" : "currency1"}`,
    evidence: withFees,
  };
}
