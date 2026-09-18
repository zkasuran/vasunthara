import { describe, expect, it } from "vitest";
import {
  checkSimulation,
  decodeBalanceDelta,
  resetCircuitBreakerNode,
  type SwapSimulation,
  sanityGate,
  tripCircuitBreakerNode,
} from "../src/simulate.js";

describe("decodeBalanceDelta", () => {
  it("splits one int256 word into two signed int128s", () => {
    // Captured from a live eth_call against PoolSwapTest on Ethereum Sepolia:
    // pay 0.00001 ETH, receive 6276834406909 KHACN.
    const raw =
      "0xfffffffffffffffffffff6e7b18d60000000000000000000000005b5707c31fd";
    const { amount0, amount1 } = decodeBalanceDelta(raw);
    expect(amount0).toBe(-10_000_000_000_000n);
    expect(amount1).toBe(6_276_834_406_909n);
  });

  it("reads the high half as NEGATIVE, not as an enormous positive", () => {
    // A naive decode of the whole word gives a number near 2^256. Treating the
    // high half as unsigned gives a number near 2^128. Both are wrong and both
    // look like a spectacular trade.
    const raw =
      "0xfffffffffffffffffffff6e7b18d60000000000000000000000005b5707c31fd";
    const naive = BigInt(raw);
    expect(naive).toBeGreaterThan(1n << 250n);
    expect(decodeBalanceDelta(raw).amount0).toBeLessThan(0n);
  });

  it("handles a zero delta", () => {
    const { amount0, amount1 } = decodeBalanceDelta(`0x${"0".repeat(64)}`);
    expect(amount0).toBe(0n);
    expect(amount1).toBe(0n);
  });

  it("rejects a short word rather than decoding rubbish", () => {
    expect(() => decodeBalanceDelta("0x1234")).toThrow(/must be 32 bytes/);
  });
});

describe("checkSimulation", () => {
  const sim: SwapSimulation = {
    amount0: -10_000_000_000_000n,
    amount1: 6_276_834_406_909n,
    amountIn: 10_000_000_000_000n,
    amountOut: 6_276_834_406_909n,
    gasEstimate: 115_316n,
  };

  it("passes a fill at or above the floor", () => {
    expect(checkSimulation(sim, 6_000_000_000_000n, 10n ** 13n)).toBeNull();
    expect(checkSimulation(sim, sim.amountOut, 10n ** 13n)).toBeNull();
  });

  it("rejects a fill below the floor", () => {
    expect(checkSimulation(sim, 9_000_000_000_000n, 10n ** 13n)).toMatch(
      /below the floor/,
    );
  });

  it("rejects a simulation that spends a different amount than planned", () => {
    expect(checkSimulation(sim, 1n, 5n)).toMatch(/does not match the planned/);
  });

  it("rejects a fill that returns nothing", () => {
    const empty = { ...sim, amountOut: 0n };
    expect(checkSimulation(empty, 0n, 10n ** 13n)).toMatch(/returns nothing/);
  });
});

describe("incident controls", () => {
  it("trips the breaker with a recorded reason", () => {
    const node = tripCircuitBreakerNode({
      id: "halt",
      reason: "pool liquidity collapsed",
      x: 0,
    });
    expect(node.data.config.actionType).toBe("Trip Circuit Breaker");
    expect(node.data.config.reason).toBe("pool liquidity collapsed");
  });

  it("has no target field, so it cannot trip another org's breaker", () => {
    const node = tripCircuitBreakerNode({ id: "halt", reason: "r", x: 0 });
    expect(node.data.config).not.toHaveProperty("target");
    expect(node.data.config).not.toHaveProperty("organizationId");
  });

  it("resets without parameters", () => {
    const node = resetCircuitBreakerNode({ id: "resume", x: 0 });
    expect(node.data.config).toEqual({ actionType: "Reset Circuit Breaker" });
  });
});

describe("sanityGate", () => {
  const gate = sanityGate({
    id: "sane",
    label: "Pool Sane",
    readNodeId: "read-slot0",
    readNodeLabel: "Read V4 Slot0",
    minLiquidity: 10n ** 15n,
    maxLpFee: 3000,
    x: 0,
  });

  it("checks both depth and the live hook fee", () => {
    const expression = gate.data.config.condition as string;
    expect(expression).toContain(
      "{{@read-slot0:Read V4 Slot0.result.liquidity}} >= 1000000000000000",
    );
    expect(expression).toContain(
      "{{@read-slot0:Read V4 Slot0.result.lpFee}} <= 3000",
    );
  });

  it("writes the threshold as a decimal integer, never in exponent form", () => {
    expect(gate.data.config.condition).not.toContain("e+");
  });
});
