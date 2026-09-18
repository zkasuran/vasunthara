import { getAddress, Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { getProtocol, registerProtocol } from "@/lib/protocol-registry";
import uniswapV4Def from "@/protocols/uniswap-v4";

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const HEX_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

// The seven chains the definition declares StateView / PositionManager /
// Quoter addresses for, from docs.uniswap.org/contracts/v4/deployments.
const EXPECTED_CHAINS = ["1", "8453", "42161", "10", "137", "130", "11155111"];

// Canonical mainnet addresses, verified against the deployments page and
// (StateView / PositionManager) against live eth_call on 2026-09-18.
const MAINNET = {
  stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
  quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
};

describe("Uniswap V4 Protocol Definition (ABI-driven)", () => {
  it("imports and identifies as uniswap-v4", () => {
    expect(uniswapV4Def).toBeDefined();
    expect(uniswapV4Def.name).toBe("Uniswap V4");
    expect(uniswapV4Def.slug).toBe("uniswap-v4");
  });

  it("protocol and all action slugs are valid kebab-case", () => {
    expect(uniswapV4Def.slug).toMatch(KEBAB_CASE_REGEX);
    for (const action of uniswapV4Def.actions) {
      expect(action.slug).toMatch(KEBAB_CASE_REGEX);
    }
  });

  it("has no duplicate action slugs", () => {
    const slugs = uniswapV4Def.actions.map((a) => a.slug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("every action references a declared contract", () => {
    const contractKeys = new Set(Object.keys(uniswapV4Def.contracts));
    for (const action of uniswapV4Def.actions) {
      expect(
        contractKeys.has(action.contract),
        `action "${action.slug}" references unknown contract "${action.contract}"`
      ).toBe(true);
    }
  });

  it("is entirely read-only: no write actions, no payable", () => {
    expect(uniswapV4Def.actions.filter((a) => a.type === "write")).toHaveLength(
      0
    );
    expect(uniswapV4Def.actions.every((a) => a.payable === undefined)).toBe(
      true
    );
  });

  it("every read action defines at least one output", () => {
    for (const action of uniswapV4Def.actions) {
      expect(
        action.outputs?.length,
        `read action "${action.slug}" must have outputs`
      ).toBeGreaterThan(0);
    }
  });

  it("declares three contracts: StateView, PositionManager, Quoter", () => {
    expect(Object.keys(uniswapV4Def.contracts).sort()).toEqual([
      "positionManager",
      "quoter",
      "stateView",
    ]);
  });

  it("declares the same chain set for all three contracts", () => {
    for (const key of Object.keys(uniswapV4Def.contracts)) {
      expect(
        Object.keys(uniswapV4Def.contracts[key].addresses).sort(),
        `contract "${key}" chain set`
      ).toEqual([...EXPECTED_CHAINS].sort());
    }
  });

  it("all declared addresses are valid hex", () => {
    for (const [key, contract] of Object.entries(uniswapV4Def.contracts)) {
      for (const [chain, address] of Object.entries(contract.addresses)) {
        expect(address, `contract "${key}" chain "${chain}"`).toMatch(
          HEX_ADDRESS_REGEX
        );
      }
    }
  });

  it("pins the verified mainnet addresses", () => {
    expect(uniswapV4Def.contracts.stateView.addresses["1"]).toBe(
      MAINNET.stateView
    );
    expect(uniswapV4Def.contracts.positionManager.addresses["1"]).toBe(
      MAINNET.positionManager
    );
    expect(uniswapV4Def.contracts.quoter.addresses["1"]).toBe(MAINNET.quoter);
  });

  it("Sepolia StateView matches the deployment table", () => {
    expect(uniswapV4Def.contracts.stateView.addresses["11155111"]).toBe(
      "0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c"
    );
  });

  it("getSlot0 reads pool price/tick/fee by poolId", () => {
    const slot0 = uniswapV4Def.actions.find((a) => a.slug === "get-slot0");
    expect(slot0).toBeDefined();
    expect(slot0?.contract).toBe("stateView");
    expect(slot0?.function).toBe("getSlot0");
    expect(slot0?.type).toBe("read");
    expect(slot0?.inputs).toHaveLength(1);
    expect(slot0?.inputs[0].name).toBe("poolId");
    expect(slot0?.inputs[0].type).toBe("bytes32");
    const outNames = slot0?.outputs?.map((o) => o.name);
    expect(outNames).toEqual(["sqrtPriceX96", "tick", "protocolFee", "lpFee"]);
  });

  it("getLiquidity reads a uint128 by poolId", () => {
    const liq = uniswapV4Def.actions.find((a) => a.slug === "get-liquidity");
    expect(liq?.function).toBe("getLiquidity");
    expect(liq?.inputs[0].name).toBe("poolId");
    expect(liq?.outputs?.[0].name).toBe("liquidity");
    expect(liq?.outputs?.[0].type).toBe("uint128");
  });

  it("PositionManager exposes position reads a rebalance workflow needs", () => {
    const slugs = uniswapV4Def.actions
      .filter((a) => a.contract === "positionManager")
      .map((a) => a.slug)
      .sort();
    expect(slugs).toEqual([
      "get-pool-and-position-info",
      "get-position-liquidity",
      "next-token-id",
      "pm-pool-manager",
      "position-owner-of",
    ]);
  });

  it("get-pool-and-position-info returns the PoolKey tuple (with hooks) and info", () => {
    const info = uniswapV4Def.actions.find(
      (a) => a.slug === "get-pool-and-position-info"
    );
    expect(info?.function).toBe("getPoolAndPositionInfo");
    expect(info?.inputs[0].name).toBe("tokenId");
    const outNames = info?.outputs?.map((o) => o.name);
    expect(outNames).toEqual(["poolKey", "info"]);
    expect(info?.outputs?.[0].type).toBe("tuple");
  });

  it("Quoter quotes are hook-aware: PoolKey + hookData are inputs", () => {
    for (const slug of ["quote-exact-input", "quote-exact-output"]) {
      const q = uniswapV4Def.actions.find((a) => a.slug === slug);
      expect(q, `action ${slug}`).toBeDefined();
      expect(q?.contract).toBe("quoter");
      const inNames = q?.inputs.map((i) => i.name);
      expect(inNames).toEqual([
        "poolKey",
        "zeroForOne",
        "exactAmount",
        "hookData",
      ]);
      // The pool identity (which carries the hooks address) is a tuple input
      // with the five PoolKey components.
      const poolKey = q?.inputs.find((i) => i.name === "poolKey");
      expect(poolKey?.type).toBe("tuple");
      expect(poolKey?.components?.map((c) => c.name)).toEqual([
        "currency0",
        "currency1",
        "fee",
        "tickSpacing",
        "hooks",
      ]);
      // hookData is forwarded to the hook verbatim.
      expect(q?.inputs.find((i) => i.name === "hookData")?.type).toBe("bytes");
    }
  });

  it("StateView ABI encodes getSlot0 to the on-chain selector 0xc815641c", () => {
    const abi = uniswapV4Def.contracts.stateView.abi;
    expect(abi).toBeDefined();
    const iface = new Interface(abi as string);
    const data = iface.encodeFunctionData("getSlot0", [
      "0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27",
    ]);
    // Selector verified live against mainnet StateView on 2026-09-18.
    expect(data.slice(0, 10)).toBe("0xc815641c");
  });

  it("StateView getSlot0 decodes the live mainnet response shape", () => {
    // Raw eth_call return recorded from mainnet StateView.getSlot0 on the
    // ETH/USDC 0.05% pool, 2026-09-18: sqrtPriceX96 3959048026709477221707753,
    // tick -198092, protocolFee 512125, lpFee 500. This pins that the ABI
    // output types decode the deployed bytecode's return correctly.
    const raw =
      "0x00000000000000000000000000000000000000000003465c6c6f84d6050fafe9fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfa34000000000000000000000000000000000000000000000000000000000007d07d00000000000000000000000000000000000000000000000000000000000001f4";
    const iface = new Interface(uniswapV4Def.contracts.stateView.abi as string);
    const decoded = iface.decodeFunctionResult("getSlot0", raw);
    expect(decoded[0].toString()).toBe("3959048026709477221707753");
    expect(decoded[1].toString()).toBe("-198092");
    expect(decoded[2].toString()).toBe("512125");
    expect(decoded[3].toString()).toBe("500");
  });

  it("Quoter ABI encodes the deployed quoteExactInputSingle selector 0xaa9d21cb", () => {
    const iface = new Interface(uniswapV4Def.contracts.quoter.abi as string);
    const params = {
      poolKey: {
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        fee: 500,
        tickSpacing: 10,
        hooks: "0x0000000000000000000000000000000000000000",
      },
      zeroForOne: true,
      exactAmount: BigInt("1000000000000000000"),
      hookData: "0x",
    };
    const data = iface.encodeFunctionData("quoteExactInputSingle", [params]);
    // Selector verified live against mainnet V4Quoter on 2026-09-18: this
    // exact single-struct calldata returned a live USDC amountOut over
    // eth_call (about 2497-2504 USDC as the pool price moves). The deployed
    // Quoter takes the whole QuoteExactSingleParams as one struct arg, which
    // is why the selector is 0xaa9d21cb rather than the flattened form.
    expect(data.slice(0, 10)).toBe("0xaa9d21cb");
  });

  it("PositionManager ABI encodes getPoolAndPositionInfo to 0x7ba03aad", () => {
    const iface = new Interface(
      uniswapV4Def.contracts.positionManager.abi as string
    );
    const data = iface.encodeFunctionData("getPoolAndPositionInfo", [
      BigInt("408000"),
    ]);
    expect(data.slice(0, 10)).toBe("0x7ba03aad");
  });

  it("all mainnet addresses are EIP-55 checksummable and round-trip", () => {
    for (const key of Object.keys(uniswapV4Def.contracts)) {
      const addr = uniswapV4Def.contracts[key].addresses["1"];
      // getAddress throws on a bad checksum; a lowercased address round-trips
      // to its checksummed form, proving the hex is a valid address.
      expect(() => getAddress(addr)).not.toThrow();
    }
  });

  it("binds test data for every non-skipped action on chain 1", () => {
    const chainOne = uniswapV4Def.testData?.["1"];
    expect(chainOne).toBeDefined();
    const bound = new Set(Object.keys(chainOne?.actions ?? {}));
    const skipped = new Set(Object.keys(chainOne?.skipped ?? {}));
    // Every action is either bound or explicitly skipped; the union is the
    // full slug set, and the two do not overlap.
    const all = uniswapV4Def.actions.map((a) => a.slug).sort();
    expect([...bound, ...skipped].sort()).toEqual(all);
    for (const slug of bound) {
      expect(skipped.has(slug), `${slug} both bound and skipped`).toBe(false);
    }
  });

  it("skips only the two nested-tuple Quoter actions, with a reason", () => {
    const skipped = uniswapV4Def.testData?.["1"]?.skipped ?? {};
    expect(Object.keys(skipped).sort()).toEqual([
      "quote-exact-input",
      "quote-exact-output",
    ]);
    for (const reason of Object.values(skipped)) {
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it("registers in the protocol registry and is retrievable", () => {
    registerProtocol(uniswapV4Def);
    const retrieved = getProtocol("uniswap-v4");
    expect(retrieved?.slug).toBe("uniswap-v4");
    expect(retrieved?.name).toBe("Uniswap V4");
  });
});
