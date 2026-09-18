"use client";

import { useState } from "react";
import {
  type PositionSnapshot,
  loadNextTokenId,
  loadPoolSnapshot,
  loadPosition,
} from "../../lib/observe";
import { describeError } from "../../lib/rpc";
import { type ChainId, getDeployment } from "../../lib/vasunthara/deployments";
import {
  describeFee,
  formatInteger,
  shortHex,
} from "../../lib/vasunthara/format";
import {
  type Decision,
  type RebalanceAction,
  decideRebalance,
  isInRange,
} from "../../lib/vasunthara/strategy";
import { Field, Mono, Note, Pill, Row, Spinner } from "./ui";

/**
 * Positions, and the decode that makes a rebalance possible.
 *
 * PositionManager does not expose a position's tick range as its own getter: it
 * packs the range into one uint256 alongside a truncated copy of the poolId.
 * Without unpacking that there is no way to ask whether a position is in range,
 * so this read is the precondition for every rebalance decision.
 */
export function PositionsTab({ chainId }: { chainId: ChainId }) {
  const [tokenId, setTokenId] = useState("1");
  const [position, setPosition] = useState<PositionSnapshot | null>(null);
  const [decision, setDecision] = useState<Decision<RebalanceAction> | null>(
    null,
  );
  const [liveTick, setLiveTick] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextId, setNextId] = useState<bigint | null>(null);

  const deployment = getDeployment(chainId);

  function read() {
    let id: bigint;
    try {
      id = BigInt(tokenId.trim());
    } catch {
      setError(`"${tokenId}" is not a token id`);
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    setPosition(null);
    setDecision(null);
    setLiveTick(null);

    loadPosition(chainId, id)
      .then(async (found) => {
        if (!found) {
          setStatus(
            "PositionManager returned an empty info word: this token id was never minted on this chain, or it has been burned. The call did not revert, it answered with zeros.",
          );
          return;
        }
        setPosition(found);

        // Now read the pool the position actually sits in, which the position
        // itself told us, and put the two together into a rebalance decision.
        const snapshot = await loadPoolSnapshot(chainId, found.poolKey);
        setLiveTick(snapshot.observation.slot0.tick);
        setDecision(
          decideRebalance(
            snapshot.observation,
            {
              tokenId: found.tokenId,
              poolKey: found.poolKey,
              liquidity: found.liquidity,
              tickLower: found.tickLower,
              tickUpper: found.tickUpper,
            },
            {
              driftToleranceTicks: found.poolKey.tickSpacing * 2,
              guards: { maxObservationAgeSec: 120, minPoolLiquidity: 1n },
            },
            snapshot.observation.observedAt,
          ),
        );
      })
      .catch((e: unknown) => setError(describeError(e)))
      .finally(() => setLoading(false));
  }

  function probe() {
    loadNextTokenId(chainId)
      .then(setNextId)
      .catch((e: unknown) => setError(describeError(e)));
  }

  return (
    <div className="lab-cols">
      <div className="lab-panel">
        <div className="lab-panel-title">
          Position NFT
          <span className="lab-panel-sub">on {deployment.name}</span>
        </div>
        <Field
          hint="Try 1, 100000 or 250000 on Ethereum mainnet. Ids are per chain."
          label="tokenId"
        >
          <input
            className="lab-input mono"
            onChange={(e) => setTokenId(e.target.value)}
            value={tokenId}
          />
        </Field>
        <div className="lab-inline-actions">
          <button
            className="btn btn-ghost lab-mini-btn"
            disabled={loading}
            onClick={read}
            type="button"
          >
            {loading ? "Reading…" : "Read position"}
          </button>
          <button className="lab-mini" onClick={probe} type="button">
            nextTokenId
          </button>
          {nextId === null ? null : (
            <Mono>
              {formatInteger(nextId)} minted so far
            </Mono>
          )}
        </div>
        {error ? <Note tone="bad">{error}</Note> : null}
        {status ? <Note tone="warn">{status}</Note> : null}
      </div>

      {position ? (
        <div className="lab-panel">
          <div className="lab-panel-title">
            Decoded
            <span className="lab-panel-sub">out of the packed info word</span>
          </div>
          <Row label="tickLower">
            <Mono>{formatInteger(position.tickLower)}</Mono>
          </Row>
          <Row label="tickUpper">
            <Mono>{formatInteger(position.tickUpper)}</Mono>
          </Row>
          <Row label="width">
            <Mono>
              {formatInteger(position.tickUpper - position.tickLower)} ticks
            </Mono>
          </Row>
          <Row label="liquidity">
            <Mono>{formatInteger(position.liquidity)}</Mono>
          </Row>
          <Row label="owner">
            <Mono>
              {position.owner ? shortHex(position.owner, 8, 6) : "unknown"}
            </Mono>
          </Row>
          <Note tone="mute">
            Both ticks are exact multiples of this pool's tickSpacing of{" "}
            {position.poolKey.tickSpacing}, which is the check that says the
            decode is right: V4 only allows initialised ticks on the spacing
            grid.
          </Note>
        </div>
      ) : null}

      {position ? (
        <div className="lab-panel">
          <div className="lab-panel-title">
            Its pool
            <span className="lab-panel-sub">
              the position tells you, including the hook
            </span>
          </div>
          <Row label="poolId">
            <Mono breakAll>{shortHex(position.poolId, 10, 8)}</Mono>
          </Row>
          <Row label="currency0">
            <Mono>{shortHex(position.poolKey.currency0, 8, 6)}</Mono>
          </Row>
          <Row label="currency1">
            <Mono>{shortHex(position.poolKey.currency1, 8, 6)}</Mono>
          </Row>
          <Row label="fee">
            <Mono>{describeFee(position.poolKey.fee)}</Mono>
          </Row>
          <Row label="hooks">
            <Mono>{shortHex(position.poolKey.hooks, 8, 6)}</Mono>
          </Row>
          <div className="lab-inline-actions">
            <Pill tone={position.hasHook ? "accent" : "mute"}>
              {position.hasHook ? "hooked" : "no hook"}
            </Pill>
            <Pill tone={position.dynamicFee ? "accent" : "mute"}>
              {position.dynamicFee ? "dynamic fee" : "static fee"}
            </Pill>
          </div>
        </div>
      ) : null}

      {position && decision && liveTick !== null ? (
        <div className="lab-panel wide">
          <div className="lab-panel-title">
            Rebalance decision
            <span className="lab-panel-sub">
              live tick {formatInteger(liveTick)} against [
              {formatInteger(position.tickLower)},{" "}
              {formatInteger(position.tickUpper)})
            </span>
          </div>
          <div className="lab-verdict">
            <Pill tone={decision.act ? "ok" : "warn"}>
              {decision.act ? "REBALANCE" : `HOLD · ${decision.code}`}
            </Pill>
            <span className="lab-verdict-reason">{decision.reason}</span>
          </div>
          <Row label="in range">
            <Pill
              tone={
                isInRange(liveTick, position.tickLower, position.tickUpper)
                  ? "ok"
                  : "warn"
              }
            >
              {isInRange(liveTick, position.tickLower, position.tickUpper)
                ? "yes"
                : "no"}
            </Pill>
          </Row>
          {decision.act ? (
            <Row label="new range">
              <Mono>
                [{formatInteger(decision.action.toTickLower)},{" "}
                {formatInteger(decision.action.toTickUpper)})
              </Mono>
            </Row>
          ) : null}
          <pre className="lab-evidence">
            {Object.entries(decision.evidence)
              .map(([k, v]) => `${k.padEnd(18)} ${v}`)
              .join("\n")}
          </pre>
          <Note tone="mute">
            The drift tolerance here is two tick spacings. That hysteresis is not
            fussiness: without it a tick resting on the boundary rebalances every
            block and pays fees to stand still.
          </Note>
        </div>
      ) : null}

      {loading ? <Spinner label="Reading position and its pool…" /> : null}
    </div>
  );
}
