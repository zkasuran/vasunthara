"use client";

import { useState } from "react";
import {
  RECEIPT_PRESETS,
  type ReceiptPreset,
  describeCounterparty,
} from "../../lib/presets";
import { describeError, providerFor } from "../../lib/rpc";
import { type ChainId, getDeployment } from "../../lib/vasunthara/deployments";
import {
  explorerTxUrl,
  formatInteger,
  formatTokenAmount,
  shortHex,
} from "../../lib/vasunthara/format";
import {
  type SwapReceiptVerification,
  type VerdictCode,
  verifySwapReceipt,
} from "../../lib/vasunthara/verify";
import { CopyButton, ExplorerLink, Field, Mono, Note, Pill, Row, Spinner } from "./ui";

const VERDICT_TONE: Record<VerdictCode, "ok" | "warn" | "bad"> = {
  verified: "ok",
  "receipt-not-found": "warn",
  reverted: "bad",
  "no-v4-swap": "warn",
  "pool-mismatch": "bad",
};

/**
 * Verify the evidence yourself.
 *
 * This tab exists because of a specific honesty problem. KeeperHub relays its
 * writes and sponsors the gas, so an explorer shows a KeeperHub relayer as
 * `from` and its executor contract as `to`. Neither is our wallet and neither is
 * Uniswap, which means the sender column cannot prove which pool was traded.
 *
 * What proves it is the Swap event the PoolManager emitted, matched against a
 * poolId derived from the PoolKey. That check runs here, in your browser,
 * against a public RPC. It never asks KeeperHub whether the run worked.
 */
export function VerifyTab() {
  const [chainId, setChainId] = useState<ChainId>(RECEIPT_PRESETS[0]!.chainId);
  const [hash, setHash] = useState(RECEIPT_PRESETS[0]!.hash);
  const [poolId, setPoolId] = useState(RECEIPT_PRESETS[0]!.poolId);
  const [active, setActive] = useState<ReceiptPreset | null>(
    RECEIPT_PRESETS[0]!,
  );
  const [result, setResult] = useState<SwapReceiptVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(preset: ReceiptPreset) {
    setActive(preset);
    setChainId(preset.chainId);
    setHash(preset.hash);
    setPoolId(preset.poolId);
    setResult(null);
    setError(null);
  }

  function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    verifySwapReceipt(providerFor(chainId), {
      hash: hash.trim(),
      chainId,
      poolId: poolId.trim(),
    })
      .then(setResult)
      .catch((e: unknown) => setError(describeError(e)))
      .finally(() => setBusy(false));
  }

  const deployment = getDeployment(chainId);

  return (
    <div className="lab-cols">
      <div className="lab-panel wide">
        <Note tone="mute">
          KeeperHub relays writes and sponsors the gas, so the explorer shows a
          KeeperHub relayer as <Mono>from</Mono> and its executor contract as{" "}
          <Mono>to</Mono>. Neither is our wallet and neither is Uniswap. That is
          not a caveat hiding a weak claim, it is how sponsored execution works,
          and it is why the proof is the emitted <Mono>Swap</Mono> event rather
          than the sender column.
        </Note>
      </div>

      <div className="lab-panel wide">
        <div className="lab-panel-title">
          Transactions this project executed
          <span className="lab-panel-sub">
            two that swapped V4, two that did not
          </span>
        </div>
        <div className="lab-receipts">
          {RECEIPT_PRESETS.map((p) => (
            <button
              className={`lab-receipt ${active?.hash === p.hash ? "on" : ""}`}
              key={p.hash}
              onClick={() => pick(p)}
              type="button"
            >
              <b>{p.label}</b>
              <span>{getDeployment(p.chainId).name}</span>
              <Pill tone={p.expect === "verified" ? "ok" : "warn"}>
                expects {p.expect}
              </Pill>
            </button>
          ))}
        </div>
        {active ? <Note tone="mute">{active.note}</Note> : null}
      </div>

      <div className="lab-panel">
        <div className="lab-panel-title">
          What to check
          <span className="lab-panel-sub">any transaction, any shipped chain</span>
        </div>
        <Field label="chain">
          <select
            className="lab-input"
            onChange={(e) => {
              setChainId(Number(e.target.value));
              setActive(null);
            }}
            value={chainId}
          >
            {[1, 10, 130, 137, 8453, 42_161, 11_155_111, 84_532, 421_614].map(
              (id) => (
                <option key={id} value={id}>
                  {getDeployment(id).name} ({id})
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="transaction hash">
          <input
            className="lab-input mono"
            onChange={(e) => {
              setHash(e.target.value);
              setActive(null);
            }}
            spellCheck={false}
            value={hash}
          />
        </Field>
        <Field
          hint="The pool you believe was traded. Normally derived from a PoolKey rather than pasted."
          label="expected poolId"
        >
          <input
            className="lab-input mono"
            onChange={(e) => {
              setPoolId(e.target.value);
              setActive(null);
            }}
            spellCheck={false}
            value={poolId}
          />
        </Field>
        <button
          className="btn btn-primary lab-read"
          disabled={busy}
          onClick={run}
          type="button"
        >
          {busy ? "Checking the chain…" : "Verify on chain"}
        </button>
        <Row label="PoolManager checked">
          <Mono>{shortHex(deployment.poolManager, 8, 6)}</Mono>
        </Row>
      </div>

      <div className="lab-panel">
        <div className="lab-panel-title">
          Verdict
          <span className="lab-panel-sub">read from a public RPC</span>
        </div>
        {busy ? <Spinner label="Fetching the receipt…" /> : null}
        {error ? <Note tone="bad">{error}</Note> : null}
        {!(result || busy || error) ? (
          <Note tone="mute">Nothing checked yet.</Note>
        ) : null}

        {result ? (
          <>
            <div className="lab-verdict">
              <Pill tone={VERDICT_TONE[result.verdict]}>{result.verdict}</Pill>
              {active && active.expect === result.verdict ? (
                <Pill tone="ok">as documented</Pill>
              ) : null}
            </div>
            <p className="lab-verdict-reason">{result.summary}</p>

            <Row label="block">
              <Mono>
                {result.blockNumber === null
                  ? "n/a"
                  : formatInteger(result.blockNumber)}
              </Mono>
            </Row>
            <Row label="gas used">
              <Mono>
                {result.gasUsed === null ? "n/a" : formatInteger(result.gasUsed)}
              </Mono>
            </Row>
            <Row label="logs">
              <Mono>{result.logCount}</Mono>
            </Row>
            <Row label="from">
              <Mono>
                {result.from ? shortHex(result.from, 8, 6) : "n/a"}
                {describeCounterparty(result.from) ? (
                  <em className="lab-annot">
                    {" "}
                    {describeCounterparty(result.from)}
                  </em>
                ) : null}
              </Mono>
            </Row>
            <Row label="to">
              <Mono>
                {result.to ? shortHex(result.to, 8, 6) : "n/a"}
                {describeCounterparty(result.to) ? (
                  <em className="lab-annot">
                    {" "}
                    {describeCounterparty(result.to)}
                  </em>
                ) : null}
              </Mono>
            </Row>

            <div className="lab-inline-actions">
              <ExplorerLink href={explorerTxUrl(chainId, hash.trim())}>
                See it on the explorer
              </ExplorerLink>
              <CopyButton label="Copy hash" value={hash.trim()} />
            </div>
          </>
        ) : null}
      </div>

      {result?.swap ? (
        <div className="lab-panel wide">
          <div className="lab-panel-title">
            The Swap event, decoded from the receipt
            <span className="lab-panel-sub">
              this is the proof, not the sender column
            </span>
          </div>
          <Row label="poolId in the log">
            <Mono breakAll>{result.swap.poolId}</Mono>
          </Row>
          <Row label="matches expected">
            <Pill tone="ok">yes</Pill>
          </Row>
          <Row label="sender">
            <Mono>{shortHex(result.swap.sender, 8, 6)}</Mono>
          </Row>
          <Row
            hint="Signed from the pool's point of view: negative is what the pool received."
            label="amount0"
          >
            <Mono>
              {formatInteger(result.swap.amount0)}{" "}
              <em className="lab-annot">
                ({formatTokenAmount(result.swap.amount0, 18, 8)} in 18-decimal
                units)
              </em>
            </Mono>
          </Row>
          <Row label="amount1">
            <Mono>{formatInteger(result.swap.amount1)}</Mono>
          </Row>
          <Row label="tick after">
            <Mono>{formatInteger(result.swap.tick)}</Mono>
          </Row>
          <Row label="liquidity">
            <Mono>{formatInteger(result.swap.liquidity)}</Mono>
          </Row>
          <Row label="fee charged">
            <Mono>{formatInteger(result.swap.fee)}</Mono>
          </Row>
          <Note tone="ok">
            Value moved through this exact Uniswap V4 pool, and KeeperHub sent
            the transaction that moved it.
          </Note>
        </div>
      ) : null}

      {result && result.otherSwaps.length > 0 ? (
        <div className="lab-panel wide">
          <div className="lab-panel-title">
            It swapped a different pool
            <span className="lab-panel-sub">
              which is why the address filter alone is not enough
            </span>
          </div>
          {result.otherSwaps.map((s) => (
            <Row key={s.poolId} label="poolId">
              <Mono breakAll>{s.poolId}</Mono>
            </Row>
          ))}
        </div>
      ) : null}
    </div>
  );
}
