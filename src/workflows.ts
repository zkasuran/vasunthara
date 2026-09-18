// Uniswap V4 strategies expressed as KeeperHub workflow graphs.
//
// KeeperHub automates 47 integrations and 522 actions, and its `uniswap`
// plugin is Uniswap V3: every action is labelled "Uniswap V3: ...". There is
// no V4 PoolManager, no poolId, no hooks. These builders close that gap using
// the generic `web3/read-contract` and `web3/write-contract` actions, so a V4
// strategy runs on KeeperHub today without waiting for a plugin to merge.
//
// The ABI fragment each node carries is derived from the same human-readable
// ABI the reader uses, so the library and the workflow can never drift apart.

import { Interface } from "ethers";
import {
  POOL_MANAGER_EVENTS_ABI,
  POSITION_MANAGER_ABI,
  STATE_VIEW_ABI,
} from "./abis.js";
import { type ChainId, getDeployment } from "./deployments.js";
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from "./keeperhub.js";
import { derivePoolId, type PoolKey } from "./pool-id.js";

/**
 * KeeperHub wants a JSON ABI as a STRING, not an array and not the
 * human-readable form. Deriving it from our own ABI means one source of truth.
 */
export function jsonAbiFragment(
  abi: readonly string[],
  functionName: string,
): string {
  const iface = new Interface(abi as unknown as string[]);
  const fragment = iface.getFunction(functionName);
  if (!fragment) {
    throw new Error(`no function ${functionName} in the supplied ABI`);
  }
  return JSON.stringify([JSON.parse(fragment.format("json"))]);
}

/** The same, for an event, which the Event trigger wants as `contractABI`. */
export function jsonEventAbi(
  abi: readonly string[],
  eventName: string,
): string {
  const iface = new Interface(abi as unknown as string[]);
  const fragment = iface.getEvent(eventName);
  if (!fragment) {
    throw new Error(`no event ${eventName} in the supplied ABI`);
  }
  return JSON.stringify([JSON.parse(fragment.format("json"))]);
}

function readNode(params: {
  id: string;
  label: string;
  description: string;
  chainId: ChainId;
  contractAddress: string;
  abi: readonly string[];
  functionName: string;
  args: readonly unknown[];
  x: number;
}): WorkflowNode {
  return {
    id: params.id,
    type: "action",
    position: { x: params.x, y: 0 },
    data: {
      label: params.label,
      description: params.description,
      type: "action",
      status: "idle",
      config: {
        actionType: "web3/read-contract",
        network: String(params.chainId),
        contractAddress: params.contractAddress,
        abi: jsonAbiFragment(params.abi, params.functionName),
        abiFunction: params.functionName,
        functionArgs: JSON.stringify(params.args),
        failOnError: true,
      },
    },
  };
}

/**
 * A Condition node.
 *
 * Use `==` and never `===`. Contract reads come back as STRINGS, so `"18" ==
 * 18` is true and `"18" === 18` is false. A `===` comparison silently takes
 * the false branch and the run still reports success, which is the worst
 * possible failure mode for an automated strategy.
 */
function conditionNode(params: {
  id: string;
  label: string;
  description: string;
  expression: string;
  x: number;
}): WorkflowNode {
  return {
    id: params.id,
    type: "action",
    position: { x: params.x, y: 0 },
    data: {
      label: params.label,
      description: params.description,
      type: "action",
      status: "idle",
      config: { actionType: "Condition", condition: params.expression },
    },
  };
}

/** A state-changing call. `args` may contain `{{@node:Label.field}}` tokens. */
export function writeNode(params: {
  id: string;
  label: string;
  description: string;
  chainId: ChainId;
  contractAddress: string;
  abi: readonly string[];
  functionName: string;
  args: readonly unknown[];
  /** Wei of native currency to attach, for a payable call. */
  ethValue?: string;
  x: number;
}): WorkflowNode {
  const config: Record<string, unknown> = {
    actionType: "web3/write-contract",
    network: String(params.chainId),
    contractAddress: params.contractAddress,
    abi: jsonAbiFragment(params.abi, params.functionName),
    abiFunction: params.functionName,
    functionArgs: JSON.stringify(params.args),
    failOnError: true,
  };
  if (params.ethValue !== undefined) {
    config.ethValue = params.ethValue;
  }
  return {
    id: params.id,
    type: "action",
    position: { x: params.x, y: 0 },
    data: {
      label: params.label,
      description: params.description,
      type: "action",
      status: "idle",
      config,
    },
  };
}

function triggerNode(config: Record<string, unknown>): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      label: "Trigger",
      type: "trigger",
      status: "idle",
      // A trigger carries `triggerType`, never `actionType`.
      config,
    },
  };
}

/** Manual, Schedule, Webhook, Event, Block and Transfer are the six types. */
export type TriggerSpec =
  | { readonly kind: "manual" }
  | {
      readonly kind: "schedule";
      readonly cron: string;
      readonly timezone?: string;
    }
  | {
      readonly kind: "block";
      readonly chainId: ChainId;
      /** Required by the platform. Fire every N blocks. */
      readonly blockInterval?: number;
    }
  | {
      /**
       * Fire on a PoolManager event. This is the V4-native trigger: rather
       * than polling a pool on a timer, the workflow wakes on the swap itself.
       */
      readonly kind: "poolManagerEvent";
      readonly chainId: ChainId;
      readonly eventName: "Swap" | "Initialize" | "ModifyLiquidity";
    };

function buildTrigger(spec: TriggerSpec): WorkflowNode {
  if (spec.kind === "manual") {
    return triggerNode({ triggerType: "Manual" });
  }
  if (spec.kind === "schedule") {
    return triggerNode({
      triggerType: "Schedule",
      scheduleCron: spec.cron,
      scheduleTimezone: spec.timezone ?? "UTC",
    });
  }
  if (spec.kind === "poolManagerEvent") {
    const deployment = getDeployment(spec.chainId);
    return triggerNode({
      triggerType: "Event",
      network: String(spec.chainId),
      contractAddress: deployment.poolManager,
      contractABI: jsonEventAbi(POOL_MANAGER_EVENTS_ABI, spec.eventName),
      eventName: spec.eventName,
    });
  }
  return triggerNode({
    triggerType: "Block",
    network: String(spec.chainId),
    // Required by the platform. Omitting it leaves a trigger that never fires.
    blockInterval: String(spec.blockInterval ?? 1),
  });
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
): WorkflowEdge {
  return sourceHandle
    ? { id, source, target, type: "animated", sourceHandle }
    : { id, source, target, type: "animated" };
}

/**
 * Watch a V4 pool and act when its tick crosses a level.
 *
 * The graph is: trigger -> read getSlot0 by poolId -> Condition on the tick ->
 * (true) the action. This is the limit-order spine, and the same shape is what
 * a rebalance or a compound job gates on.
 *
 * The poolId is derived here rather than passed in, because deriving it from
 * the PoolKey is the thing that makes the workflow specific to one hooked
 * pool: the hook address is part of the key, so a hooked pool and the same
 * pair without a hook produce different ids and different workflows.
 */
export function buildTickCrossWorkflow(params: {
  name: string;
  description?: string;
  chainId: ChainId;
  poolKey: PoolKey;
  /** ">=" fires as the tick rises, "<=" as it falls. */
  comparison: ">=" | "<=";
  triggerTick: number;
  trigger: TriggerSpec;
  /** The node to run when the condition holds. */
  action: WorkflowNode;
}): WorkflowDefinition {
  const deployment = getDeployment(params.chainId);
  const poolId = derivePoolId(params.poolKey);

  const read = readNode({
    id: "read-slot0",
    label: "Read V4 Slot0",
    description: `StateView.getSlot0 for poolId ${poolId}`,
    chainId: params.chainId,
    contractAddress: deployment.stateView,
    abi: STATE_VIEW_ABI,
    functionName: "getSlot0",
    args: [poolId],
    x: 272,
  });

  const gate = conditionNode({
    id: "gate-tick",
    label: "Tick Crossed",
    description: `fires when the pool tick is ${params.comparison} ${params.triggerTick}`,
    expression: `{{@read-slot0:Read V4 Slot0.result.tick}} ${params.comparison} ${params.triggerTick}`,
    x: 544,
  });

  return {
    name: params.name,
    description:
      params.description ??
      `Uniswap V4 tick gate on ${deployment.name}, poolId ${poolId}`,
    nodes: [buildTrigger(params.trigger), read, gate, params.action],
    edges: [
      edge("e1", "trigger-1", "read-slot0"),
      edge("e2", "read-slot0", "gate-tick"),
      edge("e3", "gate-tick", params.action.id, "true"),
    ],
  };
}

/**
 * Watch a V4 position and act when it leaves its range.
 *
 * Reads the position's liquidity and the pool it sits in, including the hook,
 * then the pool's live tick. The Condition compares the tick against the range
 * the caller supplies, since the packed `info` word that holds the position's
 * own ticks cannot be unpacked inside a Condition expression.
 */
export function buildPositionDriftWorkflow(params: {
  name: string;
  description?: string;
  chainId: ChainId;
  tokenId: bigint;
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  trigger: TriggerSpec;
  action: WorkflowNode;
}): WorkflowDefinition {
  const deployment = getDeployment(params.chainId);
  const poolId = derivePoolId(params.poolKey);

  const liquidity = readNode({
    id: "read-liquidity",
    label: "Read Position Liquidity",
    description: `PositionManager.getPositionLiquidity for token ${params.tokenId}`,
    chainId: params.chainId,
    contractAddress: deployment.positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: "getPositionLiquidity",
    args: [params.tokenId.toString()],
    x: 272,
  });

  const slot0 = readNode({
    id: "read-slot0",
    label: "Read V4 Slot0",
    description: `StateView.getSlot0 for poolId ${poolId}`,
    chainId: params.chainId,
    contractAddress: deployment.stateView,
    abi: STATE_VIEW_ABI,
    functionName: "getSlot0",
    args: [poolId],
    x: 544,
  });

  const notEmpty = conditionNode({
    id: "gate-liquidity",
    label: "Position Has Liquidity",
    description: "skip a burnt or empty position before reading anything else",
    expression: `{{@read-liquidity:Read Position Liquidity.result}} > 0`,
    x: 816,
  });

  const drifted = conditionNode({
    id: "gate-range",
    label: "Out Of Range",
    description: `fires when the tick leaves [${params.tickLower}, ${params.tickUpper})`,
    expression: `{{@read-slot0:Read V4 Slot0.result.tick}} < ${params.tickLower} || {{@read-slot0:Read V4 Slot0.result.tick}} >= ${params.tickUpper}`,
    x: 1088,
  });

  return {
    name: params.name,
    description:
      params.description ??
      `Uniswap V4 position ${params.tokenId} drift watch on ${deployment.name}`,
    nodes: [
      buildTrigger(params.trigger),
      liquidity,
      slot0,
      notEmpty,
      drifted,
      params.action,
    ],
    edges: [
      edge("e1", "trigger-1", "read-liquidity"),
      edge("e2", "read-liquidity", "read-slot0"),
      edge("e3", "read-slot0", "gate-liquidity"),
      edge("e4", "gate-liquidity", "gate-range", "true"),
      edge("e5", "gate-range", params.action.id, "true"),
    ],
  };
}

/**
 * Watch the fee growth inside a position's range and act when it has moved
 * far enough to be worth a compounding transaction.
 *
 * getFeeGrowthInside is the read that makes this exact rather than a guess:
 * fees owed are liquidity times the growth delta over 2^128, so gating on the
 * accumulator is gating on money rather than on elapsed time.
 */
export function buildFeeGrowthWorkflow(params: {
  name: string;
  description?: string;
  chainId: ChainId;
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  /** Fire when feeGrowthInside0X128 passes this. */
  minFeeGrowthInside0X128: bigint;
  trigger: TriggerSpec;
  action: WorkflowNode;
}): WorkflowDefinition {
  const deployment = getDeployment(params.chainId);
  const poolId = derivePoolId(params.poolKey);

  const growth = readNode({
    id: "read-fee-growth",
    label: "Read Fee Growth Inside",
    description: `StateView.getFeeGrowthInside over [${params.tickLower}, ${params.tickUpper})`,
    chainId: params.chainId,
    contractAddress: deployment.stateView,
    abi: STATE_VIEW_ABI,
    functionName: "getFeeGrowthInside",
    args: [poolId, params.tickLower, params.tickUpper],
    x: 272,
  });

  const worthIt = conditionNode({
    id: "gate-fees",
    label: "Fees Worth Collecting",
    description: "gate on the accumulator, not on elapsed time",
    expression: `{{@read-fee-growth:Read Fee Growth Inside.result.feeGrowthInside0X128}} >= ${params.minFeeGrowthInside0X128.toString()}`,
    x: 544,
  });

  return {
    name: params.name,
    description:
      params.description ??
      `Uniswap V4 fee compounding on ${deployment.name}, poolId ${poolId}`,
    nodes: [buildTrigger(params.trigger), growth, worthIt, params.action],
    edges: [
      edge("e1", "trigger-1", "read-fee-growth"),
      edge("e2", "read-fee-growth", "gate-fees"),
      edge("e3", "gate-fees", params.action.id, "true"),
    ],
  };
}

/**
 * Act on every swap in one specific V4 pool.
 *
 * This is the trigger V4 makes possible and a polling loop cannot match. The
 * PoolManager emits Swap with the poolId as its first indexed topic, so a
 * workflow can wake on the swap itself instead of asking "has anything changed"
 * on a timer, and it sees the post-swap tick, price and liquidity in the event
 * payload without a single extra RPC call.
 *
 * One PoolManager serves every pool on the chain, so the trigger fires for all
 * of them and the first Condition narrows to ours by poolId. That filter is not
 * optional: without it the workflow acts on strangers' pools.
 */
export function buildSwapEventWorkflow(params: {
  name: string;
  description?: string;
  chainId: ChainId;
  poolKey: PoolKey;
  /** Extra gate on the post-swap state, as a Condition expression. */
  extraCondition?: string;
  action: WorkflowNode;
}): WorkflowDefinition {
  const deployment = getDeployment(params.chainId);
  const poolId = derivePoolId(params.poolKey);

  const mine = conditionNode({
    id: "gate-pool",
    label: "Our Pool",
    description: `narrow the PoolManager-wide Swap stream to poolId ${poolId}`,
    expression: `{{@trigger-1:Trigger.args.id}} == "${poolId}"`,
    x: 272,
  });

  const nodes: WorkflowNode[] = [
    buildTrigger({
      kind: "poolManagerEvent",
      chainId: params.chainId,
      eventName: "Swap",
    }),
    mine,
  ];
  const edges: WorkflowEdge[] = [edge("e1", "trigger-1", "gate-pool")];

  if (params.extraCondition) {
    const extra = conditionNode({
      id: "gate-state",
      label: "Post Swap State",
      description: "gate on the state the swap left behind",
      expression: params.extraCondition,
      x: 544,
    });
    nodes.push(extra);
    edges.push(edge("e2", "gate-pool", "gate-state", "true"));
    edges.push(edge("e3", "gate-state", params.action.id, "true"));
  } else {
    edges.push(edge("e2", "gate-pool", params.action.id, "true"));
  }

  nodes.push(params.action);
  return {
    name: params.name,
    description:
      params.description ??
      `Uniswap V4 swap-driven automation on ${deployment.name}, poolId ${poolId}`,
    nodes,
    edges,
  };
}
