import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { DEPLOYMENTS } from "../src/deployments.js";
import type { WorkflowDefinition, WorkflowNode } from "../src/keeperhub.js";
import { derivePoolId, type PoolKey } from "../src/pool-id.js";
import {
  buildFeeGrowthWorkflow,
  buildPositionDriftWorkflow,
  buildSwapEventWorkflow,
  buildTickCrossWorkflow,
  jsonAbiFragment,
  writeNode,
} from "../src/workflows.js";

// The live hooked, dynamic-fee pool on Ethereum Sepolia, read on 2026-09-18:
// native ETH / KHACN, fee 0x800000, tickSpacing 60, hook 0x304d...c080.
const SEPOLIA_POOL: PoolKey = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: "0x291fb6a3e55e0c2655dde79fc8f5b2f063a75669",
  fee: 0x80_00_00,
  tickSpacing: 60,
  hooks: "0x304da18bd8c71581c34d452cfbe697a07284c080",
};

const SEPOLIA = 11_155_111;

function action(): WorkflowNode {
  return writeNode({
    id: "act-1",
    label: "Fill",
    description: "the action under test",
    chainId: SEPOLIA,
    contractAddress: "0x0000000000000000000000000000000000000001",
    abi: ["function poke(uint256 amount)"],
    functionName: "poke",
    args: ["1"],
    x: 816,
  });
}

/** Every edge endpoint must name a node that exists, or the run cannot walk. */
function assertGraphIsConnected(definition: WorkflowDefinition): void {
  const ids = new Set(definition.nodes.map((n) => n.id));
  for (const e of definition.edges) {
    expect(ids.has(e.source), `edge ${e.id} source ${e.source}`).toBe(true);
    expect(ids.has(e.target), `edge ${e.id} target ${e.target}`).toBe(true);
  }
  const triggers = definition.nodes.filter((n) => n.type === "trigger");
  expect(triggers).toHaveLength(1);
}

describe("jsonAbiFragment", () => {
  it("emits a JSON string, not an array, because KeeperHub wants a string", () => {
    const fragment = jsonAbiFragment(
      ["function getSlot0(bytes32 poolId) view returns (uint160 a)"],
      "getSlot0",
    );
    expect(typeof fragment).toBe("string");
    const parsed = JSON.parse(fragment);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("getSlot0");
  });

  it("round-trips to the same selector the deployed contract exposes", () => {
    const fragment = jsonAbiFragment(
      [
        "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
      ],
      "getSlot0",
    );
    const iface = new Interface(JSON.parse(fragment));
    const data = iface.encodeFunctionData("getSlot0", [`0x${"11".repeat(32)}`]);
    expect(data.slice(0, 10)).toBe("0xc815641c");
  });

  it("throws rather than emitting a fragment for a function that is absent", () => {
    expect(() => jsonAbiFragment(["function a()"], "b")).toThrow(/no function/);
  });
});

describe("buildTickCrossWorkflow", () => {
  const wf = buildTickCrossWorkflow({
    name: "v4-limit-order",
    chainId: SEPOLIA,
    poolKey: SEPOLIA_POOL,
    comparison: ">=",
    triggerTick: -4000,
    trigger: { kind: "schedule", cron: "*/5 * * * *" },
    action: action(),
  });

  it("is a connected graph with exactly one trigger", () => {
    assertGraphIsConnected(wf);
  });

  it("reads StateView at the address shipped for that chain", () => {
    const read = wf.nodes.find((n) => n.id === "read-slot0");
    expect(read?.data.config.contractAddress).toBe(
      DEPLOYMENTS[SEPOLIA].stateView,
    );
    expect(read?.data.config.network).toBe("11155111");
    expect(read?.data.config.abiFunction).toBe("getSlot0");
  });

  it("passes the poolId derived from the PoolKey, hook included", () => {
    const read = wf.nodes.find((n) => n.id === "read-slot0");
    const args = JSON.parse(read?.data.config.functionArgs as string);
    expect(args).toEqual([derivePoolId(SEPOLIA_POOL)]);
  });

  it("sends abi and functionArgs as STRINGS, which the API requires", () => {
    const read = wf.nodes.find((n) => n.id === "read-slot0");
    expect(typeof read?.data.config.abi).toBe("string");
    expect(typeof read?.data.config.functionArgs).toBe("string");
  });

  it("gates on the tick with == style loose comparison operators only", () => {
    const gate = wf.nodes.find((n) => n.id === "gate-tick");
    const expression = gate?.data.config.condition as string;
    expect(expression).toContain(
      "{{@read-slot0:Read V4 Slot0.result.tick}} >= -4000",
    );
    // A strict comparison silently takes the false branch, because contract
    // reads come back as strings.
    expect(expression).not.toContain("===");
  });

  it("routes the action off the Condition's true handle", () => {
    const e = wf.edges.find((x) => x.target === "act-1");
    expect(e?.source).toBe("gate-tick");
    expect(e?.sourceHandle).toBe("true");
  });

  it("uses triggerType on the trigger, never actionType", () => {
    const trigger = wf.nodes.find((n) => n.type === "trigger");
    expect(trigger?.data.config.triggerType).toBe("Schedule");
    expect(trigger?.data.config.actionType).toBeUndefined();
    expect(trigger?.data.config.scheduleCron).toBe("*/5 * * * *");
  });

  it("flips the comparison for a falling tick", () => {
    const falling = buildTickCrossWorkflow({
      name: "v4-limit-order-down",
      chainId: SEPOLIA,
      poolKey: SEPOLIA_POOL,
      comparison: "<=",
      triggerTick: -9000,
      trigger: { kind: "manual" },
      action: action(),
    });
    const gate = falling.nodes.find((n) => n.id === "gate-tick");
    expect(gate?.data.config.condition).toContain("<= -9000");
  });

  it("gives a hooked pool a different workflow from the same pair unhooked", () => {
    const unhooked = buildTickCrossWorkflow({
      name: "v4-limit-order",
      chainId: SEPOLIA,
      poolKey: {
        ...SEPOLIA_POOL,
        hooks: "0x0000000000000000000000000000000000000000",
      },
      comparison: ">=",
      triggerTick: -4000,
      trigger: { kind: "manual" },
      action: action(),
    });
    const a = wf.nodes.find((n) => n.id === "read-slot0");
    const b = unhooked.nodes.find((n) => n.id === "read-slot0");
    expect(a?.data.config.functionArgs).not.toBe(b?.data.config.functionArgs);
  });
});

describe("buildPositionDriftWorkflow", () => {
  const wf = buildPositionDriftWorkflow({
    name: "v4-rebalance",
    chainId: SEPOLIA,
    tokenId: 39_000n,
    poolKey: SEPOLIA_POOL,
    tickLower: -4800,
    tickUpper: -4200,
    trigger: { kind: "block", chainId: SEPOLIA },
    action: action(),
  });

  it("is a connected graph", () => {
    assertGraphIsConnected(wf);
  });

  it("checks liquidity before it checks the range", () => {
    const order = wf.edges.map((e) => `${e.source}->${e.target}`);
    expect(order).toContain("gate-liquidity->gate-range");
    const gate = wf.nodes.find((n) => n.id === "gate-liquidity");
    expect(gate?.data.config.condition).toContain("> 0");
  });

  it("fires on either side of the range, exclusive at the top", () => {
    const gate = wf.nodes.find((n) => n.id === "gate-range");
    const expression = gate?.data.config.condition as string;
    expect(expression).toContain("< -4800");
    expect(expression).toContain(">= -4200");
  });

  it("reads the position off PositionManager, not StateView", () => {
    const read = wf.nodes.find((n) => n.id === "read-liquidity");
    expect(read?.data.config.contractAddress).toBe(
      DEPLOYMENTS[SEPOLIA].positionManager,
    );
    expect(JSON.parse(read?.data.config.functionArgs as string)).toEqual([
      "39000",
    ]);
  });

  it("uses a Block trigger carrying the network", () => {
    const trigger = wf.nodes.find((n) => n.type === "trigger");
    expect(trigger?.data.config.triggerType).toBe("Block");
    expect(trigger?.data.config.network).toBe("11155111");
  });
});

describe("buildFeeGrowthWorkflow", () => {
  const wf = buildFeeGrowthWorkflow({
    name: "v4-compound",
    chainId: SEPOLIA,
    poolKey: SEPOLIA_POOL,
    tickLower: -4800,
    tickUpper: -4200,
    minFeeGrowthInside0X128: 1n << 100n,
    trigger: { kind: "schedule", cron: "0 * * * *" },
    action: action(),
  });

  it("is a connected graph", () => {
    assertGraphIsConnected(wf);
  });

  it("reads getFeeGrowthInside over the position's own range", () => {
    const read = wf.nodes.find((n) => n.id === "read-fee-growth");
    expect(read?.data.config.abiFunction).toBe("getFeeGrowthInside");
    const args = JSON.parse(read?.data.config.functionArgs as string);
    expect(args).toEqual([derivePoolId(SEPOLIA_POOL), -4800, -4200]);
  });

  it("writes the threshold as a decimal integer, never in exponent form", () => {
    const gate = wf.nodes.find((n) => n.id === "gate-fees");
    const expression = gate?.data.config.condition as string;
    expect(expression).toContain((1n << 100n).toString());
    expect(expression).not.toContain("e+");
  });
});

describe("buildSwapEventWorkflow", () => {
  const wf = buildSwapEventWorkflow({
    name: "v4-swap-driven",
    chainId: SEPOLIA,
    poolKey: SEPOLIA_POOL,
    action: action(),
  });

  it("is a connected graph", () => {
    assertGraphIsConnected(wf);
  });

  it("subscribes to PoolManager, the one contract every V4 pool shares", () => {
    const trigger = wf.nodes.find((n) => n.type === "trigger");
    expect(trigger?.data.config.triggerType).toBe("Event");
    expect(trigger?.data.config.eventName).toBe("Swap");
    expect(trigger?.data.config.contractAddress).toBe(
      DEPLOYMENTS[SEPOLIA].poolManager,
    );
  });

  it("carries a Swap event ABI whose topic0 matches the live chain", () => {
    const trigger = wf.nodes.find((n) => n.type === "trigger");
    const abi = JSON.parse(trigger?.data.config.contractABI as string);
    const iface = new Interface(abi);
    const fragment = iface.getEvent("Swap");
    // Confirmed against real Ethereum Sepolia PoolManager logs on 2026-09-18.
    expect(fragment?.topicHash).toBe(
      "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
    );
  });

  it("narrows the PoolManager-wide stream to our poolId", () => {
    // Without this the workflow acts on strangers' pools, because one
    // PoolManager serves every pool on the chain.
    const gate = wf.nodes.find((n) => n.id === "gate-pool");
    expect(gate?.data.config.condition).toBe(
      `{{@trigger-1:Trigger.args.id}} == "${derivePoolId(SEPOLIA_POOL)}"`,
    );
    const first = wf.edges.find((e) => e.source === "trigger-1");
    expect(first?.target).toBe("gate-pool");
  });

  it("chains a second gate before the action when one is given", () => {
    const gated = buildSwapEventWorkflow({
      name: "v4-swap-driven-gated",
      chainId: SEPOLIA,
      poolKey: SEPOLIA_POOL,
      extraCondition: "{{@trigger-1:Trigger.args.tick}} <= -5000",
      action: action(),
    });
    assertGraphIsConnected(gated);
    const toAction = gated.edges.find((e) => e.target === "act-1");
    expect(toAction?.source).toBe("gate-state");
    expect(toAction?.sourceHandle).toBe("true");
  });
});

describe("block trigger", () => {
  it("always sets blockInterval, which the platform requires", () => {
    const wf = buildTickCrossWorkflow({
      name: "v4-block",
      chainId: SEPOLIA,
      poolKey: SEPOLIA_POOL,
      comparison: ">=",
      triggerTick: 0,
      trigger: { kind: "block", chainId: SEPOLIA },
      action: action(),
    });
    const trigger = wf.nodes.find((n) => n.type === "trigger");
    // Omitting it leaves a trigger that never fires.
    expect(trigger?.data.config.blockInterval).toBe("1");
  });

  it("honours an explicit interval", () => {
    const wf = buildTickCrossWorkflow({
      name: "v4-block-10",
      chainId: SEPOLIA,
      poolKey: SEPOLIA_POOL,
      comparison: ">=",
      triggerTick: 0,
      trigger: { kind: "block", chainId: SEPOLIA, blockInterval: 10 },
      action: action(),
    });
    const trigger = wf.nodes.find((n) => n.type === "trigger");
    expect(trigger?.data.config.blockInterval).toBe("10");
  });
});
