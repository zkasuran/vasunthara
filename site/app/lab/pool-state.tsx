"use client";

import { useState } from "react";
import { type PoolSnapshot, loadQuote } from "../../lib/observe";
import { describeError } from "../../lib/rpc";
import { type ChainId, getDeployment } from "../../lib/vasunthara/deployments";
import {
  describeFee,
  explorerAddressUrl,
  formatInteger,
  formatTokenAmount,
  hexEquals,
  shortHex,
} from "../../lib/vasunthara/format";
import type { QuoteResult } from "../../lib/vasunthara/reader";
import { ExplorerLink, Mono, Note, Pill, Row, Spinner } from "./ui";

export function PoolStateTab({
  chainId,
  snapshot,
  loading,
}: {
  chainId: ChainId;
  snapshot: PoolSnapshot | null;
  loading: boolean;
}) {
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [amount, setAmount] = useState("0.00001");
  const [zeroForOne, setZeroForOne] = useState(true);

  if (!snapshot) {
    return loading ? null : (
      <Note tone="mute">
        Pick a pool above and read it. Nothing is cached, so every figure is
        fetched when you ask for it.
      </Note>
    );
  }

  const { observation, token0, token1, feeGrowth } = snapshot;
  const { slot0 } = observation;
  const deployment = getDeployment(chainId);
  const managerMatches = hexEquals(snapshot.poolManager, deployment.poolManager);

  const inputToken = zeroForOne ? token0 : token1;
  const outputToken = zeroForOne ? token1 : token0;

  function runQuote() {
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    let units: bigint;
    try {
      units = parseDecimal(amount, inputToken.decimals);
    } catch (e) {
      setQuoteError(describeError(e));
      setQuoting(false);
      return;
    }
    loadQuote(chainId, observation.poolKey, zeroForOne, units)
      .then(setQuote)
      .catch((e: unknown) => setQuoteError(describeError(e)))
      .finally(() => setQuoting(false));
  }

  if (!snapshot.exists) {
    return (
      <Note tone="bad">
        This pool has never been initialised on {deployment.name}.
        <p>
          StateView returned a zero price rather than reverting, because it
          reads storage that was never written. That is the failure mode worth
          knowing about: a workflow that does not check for it treats price zero
          as a real price and acts on it.
        </p>
      </Note>
    );
  }

  return (
    <div className="lab-cols">
      <div className="lab-panel">
        <div className="lab-panel-title">
          StateView
          <span className="lab-panel-sub">
            block {formatInteger(observation.blockNumber)}
          </span>
        </div>

        <Row label="pair">
          <Mono>
            {token0.symbol} / {token1.symbol}
          </Mono>
        </Row>
        <Rowhint label="price">
          <Mono>
            {snapshot.price.toLocaleString(undefined, {
              maximumSignificantDigits: 8,
            })}{" "}
            {token1.symbol} per {token0.symbol}
          </Mono>
        </Rowhint>
        <Row label="tick">
          <Mono>{formatInteger(slot0.tick)}</Mono>
        </Row>
        <Row label="sqrtPriceX96">
          <Mono breakAll>{slot0.sqrtPriceX96.toString()}</Mono>
        </Row>
        <Row label="liquidity">
          <Mono>{formatInteger(observation.liquidity)}</Mono>
        </Row>
        <Row label="lpFee, live">
          <Mono>{describeFee(slot0.lpFee)}</Mono>
        </Row>
        <Row label="fee in the key">
          <Mono>{describeFee(observation.poolKey.fee)}</Mono>
        </Row>
        <Row label="protocolFee">
          <Mono>{slot0.protocolFee}</Mono>
        </Row>

        {observation.poolKey.fee === 0x80_00_00 ? (
          <Note tone="accent">
            The key says dynamic, so the fee is whatever the hook set for this
            block: {describeFee(slot0.lpFee)}. An order written against the fee
            in the key can fill at a different one, which is what the
            fee-above-cap guard exists to catch.
          </Note>
        ) : null}
      </div>

      <div className="lab-panel">
        <div className="lab-panel-title">
          Fee growth
          <span className="lab-panel-sub">what a compounding job gates on</span>
        </div>
        <Row label="global0">
          <Mono breakAll>{feeGrowth.feeGrowthGlobal0.toString()}</Mono>
        </Row>
        <Row label="global1">
          <Mono breakAll>{feeGrowth.feeGrowthGlobal1.toString()}</Mono>
        </Row>
        <Note tone="mute">
          These are X128 accumulators and they are allowed to overflow. Fees
          owed is the difference between two readings, so the subtraction has to
          wrap: done naively it goes negative and reads as no fees earned at the
          moment the most were earned.
        </Note>

        <div className="lab-panel-title mt">
          Lens check
          <span className="lab-panel-sub">read live, not asserted</span>
        </div>
        <Row label="StateView.poolManager()">
          <Mono>{shortHex(snapshot.poolManager, 8, 6)}</Mono>
        </Row>
        <Row label="shipped PoolManager">
          <Mono>{shortHex(deployment.poolManager, 8, 6)}</Mono>
        </Row>
        <Row label="match">
          <Pill tone={managerMatches ? "ok" : "bad"}>
            {managerMatches ? "yes" : "NO"}
          </Pill>
        </Row>
        <div className="lab-inline-actions">
          <ExplorerLink
            href={explorerAddressUrl(chainId, deployment.stateView)}
          >
            StateView on the explorer
          </ExplorerLink>
        </div>
      </div>

      <div className="lab-panel wide">
        <div className="lab-panel-title">
          V4Quoter
          <span className="lab-panel-sub">
            hook-aware: hookData is forwarded exactly as a real swap would
          </span>
        </div>

        <div className="lab-quote-controls">
          <button
            className="lab-mini"
            onClick={() => setZeroForOne((v) => !v)}
            type="button"
          >
            {inputToken.symbol} &rarr; {outputToken.symbol}
          </button>
          <input
            className="lab-input mono narrow"
            onChange={(e) => setAmount(e.target.value)}
            spellCheck={false}
            value={amount}
          />
          <span className="lab-field-hint">{inputToken.symbol} in</span>
          <button
            className="btn btn-ghost lab-mini-btn"
            disabled={quoting}
            onClick={runQuote}
            type="button"
          >
            {quoting ? "Quoting…" : "Quote it"}
          </button>
        </div>

        {quoting ? <Spinner label="Simulating through the hook…" /> : null}
        {quoteError ? (
          <Note tone="bad">
            {quoteError}
            <p>
              A quoter revert is a real answer. A hook can refuse to price a
              swap, and a strategy that treats that as a transient error will
              retry forever instead of skipping with a reason.
            </p>
          </Note>
        ) : null}

        {quote ? (
          <>
            <Row label="amount out">
              <Mono>
                {formatTokenAmount(quote.amount, outputToken.decimals, 8)}{" "}
                {outputToken.symbol}
              </Mono>
            </Row>
            <Row label="raw">
              <Mono breakAll>{quote.amount.toString()}</Mono>
            </Row>
            <Row label="gasEstimate">
              <Mono>{formatInteger(quote.gasEstimate)}</Mono>
            </Row>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A decimal string to base units, rejecting more precision than the token has. */
function parseDecimal(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(`"${text}" is not a decimal amount`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `this token has ${decimals} decimals, so ${fraction.length} fractional digits cannot be represented`,
    );
  }
  const padded = fraction.padEnd(decimals, "0");
  const units = BigInt(`${whole}${padded}`);
  if (units <= 0n) {
    throw new Error("amount must be greater than zero");
  }
  return units;
}

/** Row with a tooltip explaining the decimals adjustment. */
function Rowhint({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Row
      hint="1.0001^tick, scaled by the two tokens' decimals. Without that scaling an 18/6 pair prints a price off by 10^12."
      label={label}
    >
      {children}
    </Row>
  );
}
