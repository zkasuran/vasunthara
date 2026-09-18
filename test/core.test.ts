import { getAddress, Interface } from "ethers";
import { describe, expect, it } from "vitest";
import {
  POSITION_MANAGER_ABI,
  QUOTER_ABI,
  STATE_VIEW_ABI,
} from "../src/abis.js";
import {
  DEPLOYMENTS,
  getDeployment,
  KEEPERHUB_CHAINS,
  KEEPERHUB_TESTNETS,
  SUPPORTED_CHAINS,
} from "../src/deployments.js";
import {
  DYNAMIC_FEE_FLAG,
  derivePoolId,
  hasHook,
  isDynamicFee,
  type PoolKey,
} from "../src/pool-id.js";

const ETH = "0x0000000000000000000000000000000000000000";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

describe("deployments", () => {
  it("covers the nine shipped chains", () => {
    expect([...SUPPORTED_CHAINS].sort((a, b) => a - b)).toEqual([
      1, 10, 130, 137, 8453, 42161, 84532, 421614, 11155111,
    ]);
  });

  it("pins the verified testnet lens addresses", () => {
    // Confirmed live on 2026-09-18: on each chain StateView, PositionManager
    // and V4Quoter all return this same poolManager().
    expect(DEPLOYMENTS[84532].poolManager).toBe(
      "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
    );
    expect(DEPLOYMENTS[84532].stateView).toBe(
      "0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4",
    );
    expect(DEPLOYMENTS[421614].poolManager).toBe(
      "0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317",
    );
    expect(DEPLOYMENTS[11155111].poolManager).toBe(
      "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    );
  });

  it("no two chains share a PoolManager, because V4 does not reuse one", () => {
    const seen = new Set<string>();
    for (const chainId of SUPPORTED_CHAINS) {
      const pm = getDeployment(chainId).poolManager.toLowerCase();
      expect(seen.has(pm), `${chainId} reuses ${pm}`).toBe(false);
      seen.add(pm);
    }
  });

  it("every KeeperHub chain has a V4 deployment shipped", () => {
    for (const chainId of KEEPERHUB_CHAINS) {
      expect(() => getDeployment(chainId), String(chainId)).not.toThrow();
    }
    for (const chainId of KEEPERHUB_TESTNETS) {
      expect(KEEPERHUB_CHAINS).toContain(chainId);
    }
  });

  it("does not ship Unichain Sepolia, whose sources disagree", () => {
    expect(SUPPORTED_CHAINS).not.toContain(1301);
  });

  it("every deployment address is a valid checksummed address", () => {
    for (const chainId of SUPPORTED_CHAINS) {
      const d = getDeployment(chainId);
      for (const key of [
        "poolManager",
        "stateView",
        "positionManager",
        "quoter",
      ] as const) {
        // getAddress throws on an invalid address or bad checksum.
        expect(() => getAddress(d[key]), `${d.name} ${key}`).not.toThrow();
      }
    }
  });

  it("pins the verified mainnet lens addresses", () => {
    const d = DEPLOYMENTS[1];
    expect(d.stateView).toBe("0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227");
    expect(d.positionManager).toBe(
      "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    );
    expect(d.quoter).toBe("0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203");
    expect(d.poolManager).toBe("0x000000000004444c5dc75cB358380D2e3dE08A90");
  });

  it("throws for an unsupported chain", () => {
    expect(() => getDeployment(999)).toThrow(/not configured/);
  });
});

describe("poolId derivation", () => {
  it("derives the mainnet ETH/USDC 0.05% no-hook poolId", () => {
    const key: PoolKey = {
      currency0: ETH,
      currency1: USDC,
      fee: 500,
      tickSpacing: 10,
      hooks: ETH,
    };
    // Verified live: StateView.getSlot0 on this id on mainnet returns the
    // ETH/USDC pool's price.
    expect(derivePoolId(key)).toBe(
      "0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27",
    );
  });

  it("rejects unsorted currencies", () => {
    const key: PoolKey = {
      currency0: USDC,
      currency1: ETH,
      fee: 500,
      tickSpacing: 10,
      hooks: ETH,
    };
    expect(() => derivePoolId(key)).toThrow(/must be sorted/);
  });

  it("changes the poolId when the hook changes (hook is part of identity)", () => {
    const base: PoolKey = {
      currency0: ETH,
      currency1: USDC,
      fee: 500,
      tickSpacing: 10,
      hooks: ETH,
    };
    const hooked: PoolKey = {
      ...base,
      hooks: "0xbf9828455cdc5F02771536e3EcB3c0F931EABEC4",
    };
    expect(derivePoolId(hooked)).not.toBe(derivePoolId(base));
  });

  it("recognizes the dynamic-fee sentinel and a hook address", () => {
    expect(isDynamicFee(DYNAMIC_FEE_FLAG)).toBe(true);
    expect(isDynamicFee(500)).toBe(false);
    expect(hasHook(ETH)).toBe(false);
    expect(hasHook("0xbf9828455cdc5F02771536e3EcB3c0F931EABEC4")).toBe(true);
  });
});

describe("ABI selectors match the deployed bytecode", () => {
  it("StateView.getSlot0 -> 0xc815641c", () => {
    const iface = new Interface(STATE_VIEW_ABI as unknown as string[]);
    const data = iface.encodeFunctionData("getSlot0", [
      "0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27",
    ]);
    expect(data.slice(0, 10)).toBe("0xc815641c");
  });

  it("PositionManager.getPoolAndPositionInfo -> 0x7ba03aad", () => {
    const iface = new Interface(POSITION_MANAGER_ABI as unknown as string[]);
    const data = iface.encodeFunctionData("getPoolAndPositionInfo", [408_000n]);
    expect(data.slice(0, 10)).toBe("0x7ba03aad");
  });

  it("Quoter.quoteExactInputSingle -> 0xaa9d21cb (single-struct form)", () => {
    const iface = new Interface(QUOTER_ABI as unknown as string[]);
    const data = iface.encodeFunctionData("quoteExactInputSingle", [
      {
        poolKey: {
          currency0: ETH,
          currency1: USDC,
          fee: 500,
          tickSpacing: 10,
          hooks: ETH,
        },
        zeroForOne: true,
        exactAmount: 10n ** 18n,
        hookData: "0x",
      },
    ]);
    expect(data.slice(0, 10)).toBe("0xaa9d21cb");
  });
});

describe("live response decoding", () => {
  it("decodes a recorded mainnet getSlot0 return", () => {
    // Raw eth_call return recorded from mainnet StateView.getSlot0 on the
    // ETH/USDC 0.05% pool, 2026-09-18.
    const raw =
      "0x00000000000000000000000000000000000000000003465c6c6f84d6050fafe9fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfa34000000000000000000000000000000000000000000000000000000000007d07d00000000000000000000000000000000000000000000000000000000000001f4";
    const iface = new Interface(STATE_VIEW_ABI as unknown as string[]);
    const decoded = iface.decodeFunctionResult("getSlot0", raw);
    expect(decoded[0].toString()).toBe("3959048026709477221707753");
    expect(decoded[1].toString()).toBe("-198092");
    expect(decoded[2].toString()).toBe("512125");
    expect(decoded[3].toString()).toBe("500");
  });
});
