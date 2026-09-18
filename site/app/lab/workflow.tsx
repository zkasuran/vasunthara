"use client";

import { useMemo, useState } from "react";
import type { PoolSnapshot } from "../../lib/observe";
import { describeError } from "../../lib/rpc";
import type { ChainId } from "../../lib/vasunthara/deployments";
import { formatInteger, shortHex } from "../../lib/vasunthara/format";
import type { WorkflowDefinition } from "../../lib/vasunthara/keeperhub";
import { POOL_SWAP_TEST, planExactInputSwap, swapNode } from "../../lib/vasunthara/swap";
import {
  buildSwapEventWorkflow,
  buildTickCrossWorkflow,
} from "../../lib/vasunthara/workflows";
import { CopyButton, Mono, Note, Pill, Row } from "./ui";

type Shape = "tick-cross" | "swap-event";

/**
 * The execution half, shown as the artifact that actually crosses the boundary.
 *
 * The library does not ask KeeperHub to understand Uniswap V4. It renders a
 * workflow graph out of generic `web3/read-contract` and `web3/write-contract`
 * nodes, with the V4 specifics carried in the ABI, the derived poolId and the
 * encoded arguments. That is why this works today against a platform whose
 * Uniswap support stops at V3.
 */
export function WorkflowTab({
  chainId,
  snapshot,
}: {
  chainId: ChainId;
  snapshot: PoolSnapshot | null;
}) {
  const [shape, setShape] = useState<Shape>("tick-cross");

  const built = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    try {
      const plan = planExactInputSwap({
        chainId,
        poolKey: snapshot.observation.poolKey,
        inputCurrency: snapshot.observation.poolKey.currency0,
        amountIn: 10n ** 13n,
      });
      const action = swapNode({
        id: "v4-swap",
        label: "V4 Swap",
        description: "exact-input swap through the hooked pool",
        plan,
        x: 816,
      });
      const workflow: WorkflowDefinition =
        shape === "tick-cross"
          ? buildTickCrossWorkflow({
              name: "v4-limit-order",
              description:
                "Read a hooked Uniswap V4 pool, gate on the tick, fill through the V4 router",
              chainId,
              poolKey: snapshot.observation.poolKey,
              comparison: ">=",
              triggerTick: snapshot.observation.slot0.tick - 400,
              trigger: { kind: "schedule", cron: "*/5 * * * *" },
              action,
            })
          : buildSwapEventWorkflow({
              name: "v4-swap-driven",
              description:
                "Wake on a swap in this exact pool and act on the post-swap tick",
              chainId,
              poolKey: snapshot.observation.poolKey,
              extraCondition: `{{@trigger-1:Trigger.args.tick}} <= ${snapshot.observation.slot0.tick}`,
              action,
            });
      return { plan, workflow, error: null as string | null };
    } catch (e) {
      return { plan: null, workflow: null, error: describeError(e) };
    }
  }, [chainId, snapshot, shape]);

  if (!snapshot) {
    return <Note tone="mute">Read a pool first. The graph is built from it.</Note>;
  }

  const routerAvailable = POOL_SWAP_TEST[chainId] !== undefined;

  return (
    <div className="lab-cols">
      <div className="lab-panel wide">
        <div className="lab-inline-actions">
          <button
            className={`lab-mini ${shape === "tick-cross" ? "on" : ""}`}
            onClick={() => setShape("tick-cross")}
            type="button"
          >
            tick crossing, on a schedule
          </button>
          <button
            className={`lab-mini ${shape === "swap-event" ? "on" : ""}`}
            onClick={() => setShape("swap-event")}
            type="button"
          >
            woken by the pool's own Swap event
          </button>
        </div>
        {shape === "swap-event" ? (
          <Note tone="accent">
            One PoolManager serves every pool on the chain and emits Swap with
            the poolId as its first indexed topic. So the first Condition in this
            graph narrows a chain-wide event stream to this one pool. That filter
            is not optional: without it the workflow acts on strangers' pools.
          </Note>
        ) : null}
      </div>

      {built?.error ? (
        <div className="lab-panel wide">
          <Note tone="warn">
            {built.error}
            <p>
              Uniswap's PoolSwapTest router is a testnet component, and this
              project ships it for the three testnets KeeperHub and V4 share:{" "}
              {Object.keys(POOL_SWAP_TEST).join(", ")}. The mainnet path is the
              Universal Router with a V4_SWAP command, whose action-plan struct
              changed between v4-periphery releases. It is left unshipped rather
              than guessed, because a wrong struct shifts the hookData offset and
              the router decodes garbage instead of reverting cleanly.
            </p>
          </Note>
        </div>
      ) : null}

      {built?.plan ? (
        <div className="lab-panel">
          <div className="lab-panel-title">
            The swap plan
            <span className="lab-panel-sub">what gets encoded</span>
          </div>
          <Row label="router">
            <Mono>{shortHex(built.plan.router, 8, 6)}</Mono>
          </Row>
          <Row label="zeroForOne">
            <Mono>{String(built.plan.zeroForOne)}</Mono>
          </Row>
          <Row
            hint="V4 puts the direction in the sign: negative is exact input."
            label="amountSpecified"
          >
            <Mono>{formatInteger(built.plan.amountSpecified)}</Mono>
          </Row>
          <Row
            hint="At the floor for zeroForOne, at the ceiling otherwise. The wrong end does not cost slippage, it halts the swap and returns a zero fill that still pays gas."
            label="sqrtPriceLimitX96"
          >
            <Mono breakAll>{built.plan.sqrtPriceLimitX96.toString()}</Mono>
          </Row>
          <Row
            hint="KeeperHub parses this with parseEther, so it is decimal ether and not wei."
            label="ethValue"
          >
            <Mono>{built.plan.ethValue} ETH</Mono>
          </Row>
          <Note tone="mute">
            Three of these five fields have a failure mode that costs a run
            rather than throwing: the sign, the price bound and the units of
            ethValue. They are computed by the library instead of being written
            by hand at the call site.
          </Note>
        </div>
      ) : null}

      {built?.workflow ? (
        <div className="lab-panel">
          <div className="lab-panel-title">
            Graph
            <span className="lab-panel-sub">
              {built.workflow.nodes.length} nodes,{" "}
              {built.workflow.edges.length} edges
            </span>
          </div>
          {built.workflow.nodes.map((node, i) => (
            <Row key={node.id} label={`${i + 1}. ${node.data.label}`}>
              <Pill tone={node.type === "trigger" ? "accent" : "mute"}>
                {String(
                  node.data.config.actionType ??
                    node.data.config.triggerType ??
                    node.type,
                )}
              </Pill>
            </Row>
          ))}
          <div className="lab-inline-actions">
            <Pill tone={routerAvailable ? "ok" : "warn"}>
              {routerAvailable ? "executable chain" : "read-only chain"}
            </Pill>
          </div>
        </div>
      ) : null}

      {built?.workflow ? (
        <div className="lab-panel wide">
          <div className="lab-panel-title">
            POST /api/workflows/create
            <span className="lab-panel-sub">
              the exact body, nothing redacted because nothing here is secret
            </span>
          </div>
          <div className="lab-inline-actions">
            <CopyButton
              label="Copy workflow JSON"
              value={JSON.stringify(built.workflow, jsonBigints, 2)}
            />
          </div>
          <pre className="lab-json">
            {JSON.stringify(built.workflow, jsonBigints, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** JSON cannot carry a bigint, and every one of these is an on-chain integer. */
function jsonBigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
