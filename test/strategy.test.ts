import { describe, expect, it } from "vitest";
import type { PoolKey } from "../src/pool-id.js";
import {
  alignTickDown,
  applySlippage,
  type CompoundConfig,
  centredRange,
  checkGuards,
  decideCompound,
  decideLimitOrder,
  decideRebalance,
  feesOwed,
  type Guards,
  isInRange,
  type LimitOrderConfig,
  type PoolObservation,
  type PositionObservation,
  type RebalanceConfig,
  wrappingDelta,
} from "../src/strategy.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const NATIVE = "0x0000000000000000000000000000000000000000";
const HOOK = "0xbf9828455cdc5F02771536e3EcB3c0F931EABEC4";

const poolKey: PoolKey = {
  currency0: NATIVE,
  currency1: USDC,
  fee: 500,
  tickSpacing: 10,
  hooks: HOOK,
};

const NOW = 1_789_730_000;

function observation(over: Partial<PoolObservation> = {}): PoolObservation {
  return {
    poolId:
      "0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27",
    poolKey,
    slot0: {
      sqrtPriceX96: 3_963_491_443_691_221_452_379_711n,
      tick: -198_070,
      protocolFee: 512_125,
      lpFee: 500,
    },
    liquidity: 1_040_359_073_077_463_346n,
    blockNumber: 25_998_343,
    observedAt: NOW - 5,
    ...over,
  };
}

const guards: Guards = {
  maxObservationAgeSec: 60,
  minPoolLiquidity: 1_000n,
  maxLpFeeHundredthsBip: 3_000,
};

describe("wrappingDelta", () => {
  it("is a plain difference when the accumulator has not wrapped", () => {
    expect(wrappingDelta(500n, 200n)).toBe(300n);
  });

  it("stays positive across a 2^256 wrap", () => {
    const max = (1n << 256n) - 1n;
    // The accumulator was near the top, wrapped, and is now at 99.
    expect(wrappingDelta(99n, max)).toBe(100n);
  });

  it("would go negative without the mask, which is the bug it prevents", () => {
    const max = (1n << 256n) - 1n;
    expect(99n - max).toBeLessThan(0n);
    expect(wrappingDelta(99n, max)).toBeGreaterThan(0n);
  });
});

describe("alignTickDown", () => {
  it("floors a positive tick onto the spacing grid", () => {
    expect(alignTickDown(1_005, 10)).toBe(1_000);
  });

  it("floors a NEGATIVE tick down, never toward zero", () => {
    // Truncating division gives -198060, which is ABOVE -198069 and would
    // place the lower edge of a range above the current tick.
    expect(alignTickDown(-198_069, 10)).toBe(-198_070);
    expect(alignTickDown(-1, 10)).toBe(-10);
  });

  it("is a no-op on a tick already on the grid", () => {
    expect(alignTickDown(-198_070, 10)).toBe(-198_070);
  });

  it("rejects a non-positive spacing", () => {
    expect(() => alignTickDown(100, 0)).toThrow(/tickSpacing must be positive/);
  });
});

describe("guards", () => {
  it("passes a fresh, deep, cheap pool", () => {
    expect(checkGuards(observation(), guards, NOW)).toBeNull();
  });

  it("blocks an observation older than the limit", () => {
    const stale = observation({ observedAt: NOW - 120 });
    const decision = checkGuards(stale, guards, NOW);
    expect(decision?.act).toBe(false);
    expect(decision && !decision.act && decision.code).toBe(
      "stale-observation",
    );
  });

  it("blocks an observation from the future", () => {
    const skewed = observation({ observedAt: NOW + 30 });
    const decision = checkGuards(skewed, guards, NOW);
    expect(decision && !decision.act && decision.code).toBe(
      "stale-observation",
    );
  });

  it("blocks a pool thinner than the floor", () => {
    const thin = observation({ liquidity: 10n });
    const decision = checkGuards(thin, guards, NOW);
    expect(decision && !decision.act && decision.code).toBe("pool-too-thin");
  });

  it("blocks a dynamic-fee hook that raised the fee above the cap", () => {
    const pricey = observation({
      slot0: { ...observation().slot0, lpFee: 50_000 },
    });
    const decision = checkGuards(pricey, guards, NOW);
    expect(decision && !decision.act && decision.code).toBe("fee-above-cap");
  });

  it("reports the age in the evidence", () => {
    const stale = observation({ observedAt: NOW - 120 });
    const decision = checkGuards(stale, guards, NOW);
    expect(decision?.evidence.ageSec).toBe("120");
  });
});

describe("applySlippage", () => {
  it("rounds the floor down", () => {
    expect(applySlippage(1_000_000n, 50)).toBe(995_000n);
  });

  it("returns the quote unchanged at zero tolerance", () => {
    expect(applySlippage(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("rejects a tolerance outside 0..10000", () => {
    expect(() => applySlippage(1n, 10_001)).toThrow(/slippageBps/);
    expect(() => applySlippage(1n, -1)).toThrow(/slippageBps/);
  });
});

describe("decideLimitOrder", () => {
  const base: LimitOrderConfig = {
    poolKey,
    sellCurrency0: true,
    triggerTick: -198_000,
    amountIn: 10n ** 18n,
    slippageBps: 50,
    expiresAt: NOW + 3_600,
    guards,
  };

  it("holds while the tick is below a sell-currency0 trigger", () => {
    const decision = decideLimitOrder(observation(), base, 2_500n, NOW);
    expect(decision.act).toBe(false);
    expect(!decision.act && decision.code).toBe("trigger-not-reached");
  });

  it("fills once the tick reaches the trigger", () => {
    const risen = observation({
      slot0: { ...observation().slot0, tick: -197_900 },
    });
    const decision = decideLimitOrder(risen, base, 2_500_000_000n, NOW);
    expect(decision.act).toBe(true);
    if (decision.act) {
      expect(decision.action.zeroForOne).toBe(true);
      expect(decision.action.minAmountOut).toBe(2_487_500_000n);
    }
  });

  it("inverts the comparison for the other side", () => {
    // Selling currency1 wants a LOW tick, so the same observation that held
    // the currency0 order must fill the currency1 order.
    const sellOne: LimitOrderConfig = { ...base, sellCurrency0: false };
    const decision = decideLimitOrder(observation(), sellOne, 1n, NOW);
    expect(decision.act).toBe(true);
    if (decision.act) {
      expect(decision.action.zeroForOne).toBe(false);
    }
  });

  it("refuses an expired order even when the trigger is met", () => {
    const risen = observation({
      slot0: { ...observation().slot0, tick: -197_900 },
    });
    const expired: LimitOrderConfig = { ...base, expiresAt: NOW - 1 };
    const decision = decideLimitOrder(risen, expired, 2_500_000_000n, NOW);
    expect(!decision.act && decision.code).toBe("order-expired");
  });

  it("refuses a fill below the caller's hard floor", () => {
    const risen = observation({
      slot0: { ...observation().slot0, tick: -197_900 },
    });
    const decision = decideLimitOrder(
      risen,
      base,
      2_500_000_000n,
      NOW,
      2_499_000_000n,
    );
    expect(!decision.act && decision.code).toBe("quote-below-limit");
  });

  it("puts the guard first: a stale reading never reaches the trigger test", () => {
    const staleAndTriggered = observation({
      slot0: { ...observation().slot0, tick: -197_900 },
      observedAt: NOW - 600,
    });
    const decision = decideLimitOrder(
      staleAndTriggered,
      base,
      2_500_000_000n,
      NOW,
    );
    expect(!decision.act && decision.code).toBe("stale-observation");
  });
});

describe("range helpers", () => {
  it("treats the upper edge as exclusive, matching V4", () => {
    expect(isInRange(100, 100, 200)).toBe(true);
    expect(isInRange(199, 100, 200)).toBe(true);
    expect(isInRange(200, 100, 200)).toBe(false);
    expect(isInRange(99, 100, 200)).toBe(false);
  });

  it("centres a range on the tick, on the spacing grid", () => {
    const { tickLower, tickUpper } = centredRange(-198_070, 200, 10);
    // Math.abs because a negative multiple leaves -0, which Object.is
    // distinguishes from 0.
    expect(Math.abs(tickLower % 10)).toBe(0);
    expect(Math.abs(tickUpper % 10)).toBe(0);
    expect(tickLower).toBeLessThan(-198_070);
    expect(tickUpper).toBeGreaterThan(-198_070);
    expect(tickUpper - tickLower).toBe(200);
  });

  it("never returns an empty range, even at zero width", () => {
    const { tickLower, tickUpper } = centredRange(0, 0, 60);
    expect(tickUpper).toBeGreaterThan(tickLower);
  });
});

describe("decideRebalance", () => {
  const position: PositionObservation = {
    tokenId: 408_579n,
    poolKey,
    liquidity: 289_602_464_346_483n,
    tickLower: -198_200,
    tickUpper: -198_000,
  };
  const config: RebalanceConfig = { driftToleranceTicks: 50, guards };

  it("holds while the position is in range", () => {
    const decision = decideRebalance(observation(), position, config, NOW);
    expect(!decision.act && decision.code).toBe("position-in-range");
  });

  it("holds when the drift is inside the tolerance", () => {
    // 20 ticks past the lower edge, tolerance is 50.
    const drifted = observation({
      slot0: { ...observation().slot0, tick: -198_220 },
    });
    const decision = decideRebalance(drifted, position, config, NOW);
    expect(!decision.act && decision.code).toBe("drift-within-tolerance");
  });

  it("rebalances once the drift exceeds the tolerance", () => {
    const drifted = observation({
      slot0: { ...observation().slot0, tick: -198_400 },
    });
    const decision = decideRebalance(drifted, position, config, NOW);
    expect(decision.act).toBe(true);
    if (decision.act) {
      expect(decision.action.fromTickLower).toBe(-198_200);
      // Width is preserved and the new range brackets the current tick.
      const width = decision.action.toTickUpper - decision.action.toTickLower;
      expect(width).toBe(200);
      expect(decision.action.toTickLower).toBeLessThanOrEqual(-198_400);
      expect(decision.action.toTickUpper).toBeGreaterThan(-198_400);
    }
  });

  it("skips an empty position before anything else", () => {
    const drifted = observation({
      slot0: { ...observation().slot0, tick: -198_400 },
    });
    const empty = { ...position, liquidity: 0n };
    const decision = decideRebalance(drifted, empty, config, NOW);
    expect(!decision.act && decision.code).toBe("position-empty");
  });
});

describe("feesOwed", () => {
  it("applies Uniswap's liquidity * delta / 2^128 formula", () => {
    const q128 = 1n << 128n;
    const { fees0, fees1 } = feesOwed(
      1_000n,
      { feeGrowthInside0LastX128: 0n, feeGrowthInside1LastX128: 0n },
      { feeGrowthInside0X128: q128, feeGrowthInside1X128: q128 * 2n },
    );
    expect(fees0).toBe(1_000n);
    expect(fees1).toBe(2_000n);
  });

  it("values fees correctly across an accumulator wrap", () => {
    const max = (1n << 256n) - 1n;
    const q128 = 1n << 128n;
    const { fees0 } = feesOwed(
      1_000n,
      { feeGrowthInside0LastX128: max, feeGrowthInside1LastX128: 0n },
      { feeGrowthInside0X128: q128 - 1n, feeGrowthInside1X128: 0n },
    );
    expect(fees0).toBe(1_000n);
  });
});

describe("decideCompound", () => {
  const position: PositionObservation = {
    tokenId: 408_579n,
    poolKey,
    liquidity: 1_000n,
    tickLower: -198_200,
    tickUpper: -198_000,
  };
  const checkpoint = {
    feeGrowthInside0LastX128: 0n,
    feeGrowthInside1LastX128: 0n,
  };
  const config: CompoundConfig = { minFees0: 500n, guards };

  it("holds while fees are below the floor", () => {
    const current = {
      feeGrowthInside0X128: (1n << 128n) / 4n,
      feeGrowthInside1X128: 0n,
    };
    const decision = decideCompound(
      observation(),
      position,
      checkpoint,
      current,
      config,
      NOW,
    );
    expect(!decision.act && decision.code).toBe("fees-below-threshold");
  });

  it("compounds once the floor is reached", () => {
    const current = {
      feeGrowthInside0X128: 1n << 128n,
      feeGrowthInside1X128: 0n,
    };
    const decision = decideCompound(
      observation(),
      position,
      checkpoint,
      current,
      config,
      NOW,
    );
    expect(decision.act).toBe(true);
    if (decision.act) {
      expect(decision.action.fees0).toBe(1_000n);
    }
  });

  it("never fires on a side that has no configured floor", () => {
    const onlyOne: CompoundConfig = { minFees1: 1n, guards };
    const current = {
      feeGrowthInside0X128: 1n << 200n,
      feeGrowthInside1X128: 0n,
    };
    const decision = decideCompound(
      observation(),
      position,
      checkpoint,
      current,
      onlyOne,
      NOW,
    );
    expect(!decision.act && decision.code).toBe("fees-below-threshold");
  });
});
