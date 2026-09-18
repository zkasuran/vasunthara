import { describe, expect, it } from "vitest";
import {
  decodePositionInfo,
  positionInfoIsEmpty,
  positionMatchesPool,
} from "../src/position-info.js";
import { alignTickDown, MAX_TICK, MIN_TICK } from "../src/strategy.js";

// Every word below was read from Ethereum mainnet PositionManager
// 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e on 2026-09-18 via
// getPoolAndPositionInfo, together with the PoolKey the same call returned.
// They are fixtures of real state, not hand-built bit patterns, so the layout
// is pinned against the deployed contract rather than against our own encoder.
const LIVE = {
  // tickSpacing 10, the full-range position minted first.
  fullRange: {
    tokenId: 1n,
    info: 0x4f88f7c99022eace4740c6898f59ce6a2e798a1e64ce5458970d89e6f2761a00n,
    tickSpacing: 10,
    tickLower: -887_270,
    tickUpper: 887_270,
  },
  // tickSpacing 600, a wide positive range.
  wide: {
    tokenId: 100_000n,
    info: 0xd37f60035efaeca13e85ac47aeaa1485f821aaeec89ace0e8f04918804837800n,
    tickSpacing: 600,
    tickLower: 295_800,
    tickUpper: 299_400,
  },
  // tickSpacing 1, a one-tick range at a negative tick.
  narrowNegative: {
    tokenId: 250_000n,
    info: 0x63bb22f47c7ede6578a25c873e77eb782ec8e4c19778e36ce6fbc897fbc89600n,
    tickSpacing: 1,
    tickLower: -276_330,
    tickUpper: -276_329,
  },
  // tickSpacing 1, a range straddling zero behind a dynamic-fee hook.
  straddlingZero: {
    tokenId: 408_571n,
    info: 0xeda62d2906d0edf26d40c793d581609552a44a87f618a98ff7000001fffffb00n,
    tickSpacing: 1,
    tickLower: -5,
    tickUpper: 1,
  },
} as const;

describe("decodePositionInfo", () => {
  for (const [name, live] of Object.entries(LIVE)) {
    it(`decodes the live ${name} position's range`, () => {
      const decoded = decodePositionInfo(live.info);
      expect(decoded.tickLower).toBe(live.tickLower);
      expect(decoded.tickUpper).toBe(live.tickUpper);
    });

    it(`puts the live ${name} range on the pool's tick spacing grid`, () => {
      const decoded = decodePositionInfo(live.info);
      // Math.abs because a negative tick yields -0, which Object.is separates
      // from 0 and toBe would reject.
      expect(Math.abs(decoded.tickLower % live.tickSpacing)).toBe(0);
      expect(Math.abs(decoded.tickUpper % live.tickSpacing)).toBe(0);
      expect(decoded.tickLower).toBeLessThan(decoded.tickUpper);
    });
  }

  it("sign-extends negative ticks instead of masking them", () => {
    // tickLower -5 sits in bits 31..8 as 0xfffffb. Masking without
    // sign-extending yields 16777211, a tick outside V4's range entirely.
    const decoded = decodePositionInfo(LIVE.straddlingZero.info);
    expect(decoded.tickLower).toBe(-5);
    expect(decoded.tickLower).toBeGreaterThan(MIN_TICK);
  });

  it("decodes the widest range V4 allows, at both extremes", () => {
    const decoded = decodePositionInfo(LIVE.fullRange.info);
    const spacing = LIVE.fullRange.tickSpacing;
    expect(decoded.tickLower).toBe(alignTickDown(MIN_TICK, spacing) + spacing);
    expect(decoded.tickUpper).toBe(alignTickDown(MAX_TICK, spacing));
  });

  it("reads the subscriber flag out of the low byte", () => {
    for (const live of Object.values(LIVE)) {
      expect(decodePositionInfo(live.info).hasSubscriber).toBe(false);
    }
    const subscribed = LIVE.wide.info | 0x01n;
    expect(decodePositionInfo(subscribed).hasSubscriber).toBe(true);
    // Setting the flag must not disturb the range packed above it.
    expect(decodePositionInfo(subscribed).tickLower).toBe(LIVE.wide.tickLower);
    expect(decodePositionInfo(subscribed).tickUpper).toBe(LIVE.wide.tickUpper);
  });

  it("refuses an empty word rather than reporting range [0, 0)", () => {
    // Token id 408579 returned exactly this on mainnet: the position had been
    // burned. The call does not revert, so this is the only thing between a
    // caller and rebalancing a position that is not there.
    expect(positionInfoIsEmpty(0n)).toBe(true);
    expect(() => decodePositionInfo(0n)).toThrow(/never minted|burned/);
  });
});

describe("positionMatchesPool", () => {
  it("matches a poolId whose upper 200 bits agree", () => {
    const info = LIVE.wide.info;
    // The packed 200 bits, re-expanded into a full bytes32 with arbitrary low
    // bits, is exactly what a truncating comparison must still accept.
    const poolId = `0x${((info >> 56n) << 56n).toString(16).padStart(64, "0")}`;
    expect(positionMatchesPool(info, poolId)).toBe(true);
  });

  it("rejects a different pool", () => {
    expect(positionMatchesPool(LIVE.wide.info, `0x${"11".repeat(32)}`)).toBe(
      false,
    );
  });

  it("never matches an empty info word", () => {
    expect(positionMatchesPool(0n, `0x${"00".repeat(32)}`)).toBe(false);
  });
});
