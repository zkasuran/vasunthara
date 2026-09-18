import type { Provider } from "ethers";
import { describe, expect, it } from "vitest";
import { getDeployment } from "../src/deployments.js";
import {
  decodeSwapLog,
  findAllSwapLogs,
  findPoolSwapLog,
  isSwapLog,
  type MinimalLog,
  SWAP_EVENT_TOPIC,
  verifySwapReceipt,
} from "../src/verify.js";

const SEPOLIA = 11_155_111;
const POOL_MANAGER = getDeployment(SEPOLIA).poolManager;
const POOL_ID =
  "0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c";

// The exact log emitted by transaction
// 0xd5bf7a3a08d96916f794c7b8d06b2a0fa5815cef0d6e617907669c8b6f10f88e in block
// 11730753 on Ethereum Sepolia, read with eth_getTransactionReceipt from a
// public RPC on 2026-09-18. Copied verbatim, so these tests decode real
// PoolManager output rather than something this library encoded itself.
const REAL_SWAP_LOG: MinimalLog = {
  address: POOL_MANAGER,
  topics: [
    "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
    POOL_ID,
    "0x0000000000000000000000009b6b46e2c869aa39918db7f52f5557fe577b6eee",
  ],
  data: "0xfffffffffffffffffffffffffffffffffffffffffffffffffffff6e7b18d6000000000000000000000000000000000000000000000000000000005b5707c31fd0000000000000000000000000000000000000000caecced7b9c6a6f83b99f40f000000000000000000000000000000000000000000000000000e49fcd9496000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedd80000000000000000000000000000000000000000000000000000000000000bb8",
};

const UNRELATED_LOG: MinimalLog = {
  address: "0x291Fb6a3e55e0C2655Dde79FC8f5b2f063a75669",
  topics: [
    // A plain ERC20 Transfer, which shares no topic with Swap.
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000009b6b46e2c869aa39918db7f52f5557fe577b6eee",
    "0x00000000000000000000000033a41051f0a8ef15e6175dae4327e20f09b78ff4",
  ],
  data: "0x0000000000000000000000000000000000000000000000000000005b5707c31fd",
};

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    status: 1,
    blockNumber: 11_730_753,
    gasUsed: 160_400n,
    from: "0x809D8252aa4f9b8F7D9bE7213855b289fe7D0444",
    to: "0x5aF5194B4b0909eB978e3Cf1e25333852277f07D",
    logs: [UNRELATED_LOG, REAL_SWAP_LOG],
    ...overrides,
  };
}

function providerReturning(value: unknown): Provider {
  return {
    getTransactionReceipt: () => Promise.resolve(value),
  } as unknown as Provider;
}

describe("SWAP_EVENT_TOPIC", () => {
  it("equals the topic observed in real Sepolia PoolManager logs", () => {
    // Pinned against block 11730753 and earlier. Derived from the ABI at
    // module load, so a signature edit breaks this rather than silently
    // changing which logs are recognised.
    expect(SWAP_EVENT_TOPIC).toBe(
      "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
    );
  });
});

describe("decodeSwapLog", () => {
  it("decodes the real fill to the figures the receipt documents", () => {
    const swap = decodeSwapLog(REAL_SWAP_LOG);
    expect(swap.poolId).toBe(POOL_ID);
    expect(swap.amount0).toBe(-10_000_000_000_000n);
    expect(swap.amount1).toBe(6_276_834_406_909n);
    expect(swap.sqrtPriceX96).toBe(62_802_255_264_272_773_889_591_473_167n);
    expect(swap.liquidity).toBe(4_022_000_000_000_000n);
    expect(swap.tick).toBe(-4648);
    expect(swap.fee).toBe(3000);
  });

  it("keeps amount0 negative, which is what marks it as paid in", () => {
    // int128 deltas are signed from the pool's point of view. Decoding them
    // unsigned turns 0.00001 ETH paid in into an enormous amount received.
    const swap = decodeSwapLog(REAL_SWAP_LOG);
    expect(swap.amount0).toBeLessThan(0n);
    expect(swap.amount1).toBeGreaterThan(0n);
  });

  it("refuses a log that is not a Swap", () => {
    expect(isSwapLog(UNRELATED_LOG)).toBe(false);
    expect(() => decodeSwapLog(UNRELATED_LOG)).toThrow(/not the PoolManager/);
  });
});

describe("findPoolSwapLog", () => {
  it("finds the Swap for the expected pool", () => {
    const swap = findPoolSwapLog(
      [UNRELATED_LOG, REAL_SWAP_LOG],
      POOL_MANAGER,
      POOL_ID,
    );
    expect(swap?.tick).toBe(-4648);
  });

  it("matches a poolId whose case differs from the log", () => {
    const swap = findPoolSwapLog(
      [REAL_SWAP_LOG],
      POOL_MANAGER.toLowerCase(),
      POOL_ID.toUpperCase().replace("0X", "0x"),
    );
    expect(swap).not.toBeNull();
  });

  it("rejects the same event from a contract that is not the PoolManager", () => {
    // Anyone can emit an identical event. Without the address filter a
    // look-alike log would be accepted as proof of a Uniswap V4 fill.
    const spoofed: MinimalLog = {
      ...REAL_SWAP_LOG,
      address: "0x1111111111111111111111111111111111111111",
    };
    expect(findPoolSwapLog([spoofed], POOL_MANAGER, POOL_ID)).toBeNull();
  });

  it("rejects a swap on a different pool through the same PoolManager", () => {
    // One PoolManager serves every pool on the chain, so this is the common
    // case rather than an edge case.
    const otherPool = `0x${"22".repeat(32)}`;
    expect(
      findPoolSwapLog([REAL_SWAP_LOG], POOL_MANAGER, otherPool),
    ).toBeNull();
  });
});

describe("findAllSwapLogs", () => {
  it("returns every PoolManager Swap and ignores the rest", () => {
    const all = findAllSwapLogs(
      [UNRELATED_LOG, REAL_SWAP_LOG, REAL_SWAP_LOG],
      POOL_MANAGER,
    );
    expect(all).toHaveLength(2);
  });
});

describe("verifySwapReceipt", () => {
  const hash =
    "0xd5bf7a3a08d96916f794c7b8d06b2a0fa5815cef0d6e617907669c8b6f10f88e";

  it("verifies a real fill and reports the movement", async () => {
    const result = await verifySwapReceipt(providerReturning(receipt()), {
      hash,
      chainId: SEPOLIA,
      poolId: POOL_ID,
    });
    expect(result.verdict).toBe("verified");
    expect(result.swap?.amount1).toBe(6_276_834_406_909n);
    expect(result.blockNumber).toBe(11_730_753);
    expect(result.gasUsed).toBe(160_400n);
  });

  it("reports the relayer as sender rather than claiming it was our wallet", async () => {
    // Sponsored execution means `from` is a KeeperHub relayer and `to` is its
    // executor. Surfacing both is what keeps the evidence honest.
    const result = await verifySwapReceipt(providerReturning(receipt()), {
      hash,
      chainId: SEPOLIA,
      poolId: POOL_ID,
    });
    expect(result.from).toBe("0x809D8252aa4f9b8F7D9bE7213855b289fe7D0444");
    expect(result.to).toBe("0x5aF5194B4b0909eB978e3Cf1e25333852277f07D");
  });

  it("reports a missing receipt rather than throwing", async () => {
    const result = await verifySwapReceipt(providerReturning(null), {
      hash,
      chainId: SEPOLIA,
      poolId: POOL_ID,
    });
    expect(result.verdict).toBe("receipt-not-found");
    expect(result.swap).toBeNull();
  });

  it("separates a revert from a missing event", async () => {
    const result = await verifySwapReceipt(
      providerReturning(receipt({ status: 0 })),
      { hash, chainId: SEPOLIA, poolId: POOL_ID },
    );
    expect(result.verdict).toBe("reverted");
  });

  it("reports a success that touched no V4 pool", async () => {
    const result = await verifySwapReceipt(
      providerReturning(receipt({ logs: [UNRELATED_LOG] })),
      { hash, chainId: SEPOLIA, poolId: POOL_ID },
    );
    expect(result.verdict).toBe("no-v4-swap");
  });

  it("distinguishes a swap on the wrong pool from no swap at all", async () => {
    const result = await verifySwapReceipt(providerReturning(receipt()), {
      hash,
      chainId: SEPOLIA,
      poolId: `0x${"33".repeat(32)}`,
    });
    expect(result.verdict).toBe("pool-mismatch");
    expect(result.otherSwaps).toHaveLength(1);
    expect(result.otherSwaps[0]?.poolId).toBe(POOL_ID);
  });
});
