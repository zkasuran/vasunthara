"use client";

import { useMemo, useState } from "react";
import { type PoolSnapshot, loadQuote } from "../../lib/observe";
import { describeError } from "../../lib/rpc";
import type { ChainId } from "../../lib/vasunthara/deployments";
import { formatInteger, formatTokenAmount } from "../../lib/vasunthara/format";
import {
  type Decision,
  type Guards,
  type LimitOrderFill,
  decideLimitOrder,
} from "../../lib/vasunthara/strategy";
import { Field, Mono, Note, Pill, Row, Spinner } from "./ui";

/**
 * The decision layer, run live.
 *
 * The point of this tab is that nothing here is a mock. These are the exported
 * functions from the package, given a real observation read a moment ago, and
 * they are pure: same observation and same config, same decision, every time.
 * That is why a refusal can be shown with the numbers that caused it.
 */
export function DecideTab({
  chainId,
  snapshot,
}: {
  chainId: ChainId;
  snapshot: PoolSnapshot | null;
}) {
  const [triggerOffset, setTriggerOffset] = useState("-400");
  const [sellCurrency0, setSellCurrency0] = useState(true);
  const [slippageBps, setSlippageBps] = useState("100");
  const [maxAgeSec, setMaxAgeSec] = useState("60");
  const [minLiquidity, setMinLiquidity] = useState("1000000000000000");
  const [maxLpFee, setMaxLpFee] = useState("3000");
  const [ageOverride, setAgeOverride] = useState(0);

  const [quoted, setQuoted] = useState<bigint | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  const guards: Guards = useMemo(
    () => ({
      maxObservationAgeSec: Number(maxAgeSec) || 0,
      minPoolLiquidity: safeBigint(minLiquidity),
      maxLpFeeHundredthsBip: Number(maxLpFee) || 0,
    }),
    [maxAgeSec, minLiquidity, maxLpFee],
  );

  const decision = useMemo((): Decision<LimitOrderFill> | null => {
    if (!snapshot) {
      return null;
    }
    const { observation } = snapshot;
    const triggerTick = observation.slot0.tick + (Number(triggerOffset) || 0);
    // `now` is supplied rather than read from a clock inside the library, which
    // is what lets the age slider below move time without touching the reading.
    const now = observation.observedAt + ageOverride;
    return decideLimitOrder(
      observation,
      {
        poolKey: observation.poolKey,
        sellCurrency0,
        triggerTick,
        amountIn: 10n ** 13n,
        slippageBps: Number(slippageBps) || 0,
        expiresAt: observation.observedAt + 3600,
        guards,
      },
      quoted ?? 0n,
      now,
    );
  }, [
    snapshot,
    triggerOffset,
    sellCurrency0,
    slippageBps,
    guards,
    quoted,
    ageOverride,
  ]);

  if (!snapshot) {
    return <Note tone="mute">Read a pool first, then decide against it.</Note>;
  }

  const { observation, token0, token1 } = snapshot;
  const inputToken = sellCurrency0 ? token0 : token1;
  const outputToken = sellCurrency0 ? token1 : token0;
  const triggerTick = observation.slot0.tick + (Number(triggerOffset) || 0);

  function runQuote() {
    setQuoting(true);
    setQuoteError(null);
    loadQuote(chainId, observation.poolKey, sellCurrency0, 10n ** 13n)
      .then((q) => setQuoted(q.amount))
      .catch((e: unknown) => setQuoteError(describeError(e)))
      .finally(() => setQuoting(false));
  }

  return (
    <div className="lab-cols">
      <div className="lab-panel">
        <div className="lab-panel-title">
          The order
          <span className="lab-panel-sub">a resting limit order</span>
        </div>

        <div className="lab-inline-actions">
          <button
            className="lab-mini"
            onClick={() => setSellCurrency0((v) => !v)}
            type="button"
          >
            sell {inputToken.symbol} for {outputToken.symbol}
          </button>
        </div>

        <Field
          hint={`Relative to the live tick ${observation.slot0.tick}. Negative puts the trigger behind the market, so the order fills.`}
          label="trigger tick, offset from live"
        >
          <input
            className="lab-input mono"
            onChange={(e) => setTriggerOffset(e.target.value)}
            value={triggerOffset}
          />
        </Field>
        <Row label="trigger tick">
          <Mono>{formatInteger(triggerTick)}</Mono>
        </Row>
        <Row label="live tick">
          <Mono>{formatInteger(observation.slot0.tick)}</Mono>
        </Row>
        <Note tone="mute">
          Price is currency1 per currency0 and equals 1.0001^tick, so selling
          currency0 waits for the tick to rise to the trigger and selling
          currency1 waits for it to fall. The library derives that direction
          from the side rather than accepting it, because a caller who supplies
          it can invert the order.
        </Note>

        <Field label="slippage, bps">
          <input
            className="lab-input mono"
            onChange={(e) => setSlippageBps(e.target.value)}
            value={slippageBps}
          />
        </Field>

        <div className="lab-inline-actions">
          <button
            className="btn btn-ghost lab-mini-btn"
            disabled={quoting}
            onClick={runQuote}
            type="button"
          >
            {quoting ? "Quoting…" : "Fetch a hook-aware quote"}
          </button>
          {quoted === null ? (
            <span className="lab-field-hint">
              no quote yet, so minAmountOut computes from 0
            </span>
          ) : (
            <Mono>
              {formatTokenAmount(quoted, outputToken.decimals, 8)}{" "}
              {outputToken.symbol}
            </Mono>
          )}
        </div>
        {quoteError ? <Note tone="bad">{quoteError}</Note> : null}
      </div>

      <div className="lab-panel">
        <div className="lab-panel-title">
          Guards
          <span className="lab-panel-sub">they run first, in a fixed order</span>
        </div>

        <Field label="maxObservationAgeSec">
          <input
            className="lab-input mono"
            onChange={(e) => setMaxAgeSec(e.target.value)}
            value={maxAgeSec}
          />
        </Field>
        <Field label="minPoolLiquidity">
          <input
            className="lab-input mono"
            onChange={(e) => setMinLiquidity(e.target.value)}
            value={minLiquidity}
          />
        </Field>
        <Field
          hint="A dynamic-fee hook can raise the fee between writing an order and filling it. This is the only check that catches it."
          label="maxLpFeeHundredthsBip"
        >
          <input
            className="lab-input mono"
            onChange={(e) => setMaxLpFee(e.target.value)}
            value={maxLpFee}
          />
        </Field>

        <Field
          hint="Moves the clock forward without re-reading the pool, which is exactly the situation the staleness guard exists for."
          label={`pretend the reading is ${ageOverride}s old`}
        >
          <input
            className="lab-range"
            max={300}
            min={0}
            onChange={(e) => setAgeOverride(Number(e.target.value))}
            step={10}
            type="range"
            value={ageOverride}
          />
        </Field>

        <Row label="live liquidity">
          <Mono>{formatInteger(observation.liquidity)}</Mono>
        </Row>
        <Row label="live lpFee">
          <Mono>{formatInteger(observation.slot0.lpFee)}</Mono>
        </Row>
      </div>

      <div className="lab-panel wide">
        <div className="lab-panel-title">
          Decision
          <span className="lab-panel-sub">
            pure function of the observation above
          </span>
        </div>
        {quoting ? <Spinner label="Quoting…" /> : null}
        {decision ? <DecisionView decision={decision} /> : null}
      </div>
    </div>
  );
}

function DecisionView({ decision }: { decision: Decision<LimitOrderFill> }) {
  return (
    <>
      <div className="lab-verdict">
        <Pill tone={decision.act ? "ok" : "warn"}>
          {decision.act ? "FILL" : `HOLD · ${decision.code}`}
        </Pill>
        <span className="lab-verdict-reason">{decision.reason}</span>
      </div>

      {decision.act ? (
        <Row label="minAmountOut">
          <Mono>{decision.action.minAmountOut.toString()}</Mono>
        </Row>
      ) : null}

      <div className="lab-panel-sub mt">
        Evidence, as the library emits it. Strings, so no figure loses precision
        on the way to a log line.
      </div>
      <pre className="lab-evidence">
        {Object.entries(decision.evidence)
          .map(([k, v]) => `${k.padEnd(18)} ${v}`)
          .join("\n")}
      </pre>

      {decision.act ? null : (
        <Note tone="mute">
          Every refusal carries a stable code you can alert on, and the numbers
          that produced it. Guards are checked before the strategy and in a
          fixed order, so the code is always the first reason that applied
          rather than whichever check happened to run.
        </Note>
      )}
    </>
  );
}

function safeBigint(text: string): bigint | undefined {
  try {
    const value = BigInt(text.trim());
    return value < 0n ? undefined : value;
  } catch {
    return undefined;
  }
}
