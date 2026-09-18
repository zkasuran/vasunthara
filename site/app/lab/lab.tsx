"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { POOL_PRESETS } from "../../lib/presets";
import { type PoolSnapshot, loadPoolSnapshot } from "../../lib/observe";
import { describeError } from "../../lib/rpc";
import {
  type ChainId,
  SUPPORTED_CHAINS,
  getDeployment,
} from "../../lib/vasunthara/deployments";
import { describeFee, shortHex } from "../../lib/vasunthara/format";
import { type PoolKey, derivePoolId } from "../../lib/vasunthara/pool-id";
import { DecideTab } from "./decide";
import { PoolStateTab } from "./pool-state";
import { PositionsTab } from "./positions";
import { CopyButton, Field, Mono, Note, Pill, Row, Spinner } from "./ui";
import { VerifyTab } from "./verify";
import { WorkflowTab } from "./workflow";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DYNAMIC_FEE = 0x80_00_00;

const TABS = [
  { id: "state", label: "Pool state" },
  { id: "decide", label: "Decide" },
  { id: "workflow", label: "Workflow" },
  { id: "positions", label: "Positions" },
  { id: "verify", label: "Verify receipts" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Accept a plain number or a 0x hex literal, since fees are written both ways. */
function parseIntish(raw: string): number | null {
  const text = raw.trim();
  if (text === "") {
    return null;
  }
  const value = text.startsWith("0x") || text.startsWith("0X")
    ? Number.parseInt(text.slice(2), 16)
    : Number(text);
  return Number.isFinite(value) ? value : null;
}

export function Lab() {
  const [chainId, setChainId] = useState<ChainId>(POOL_PRESETS[0]!.chainId);
  const [poolKey, setPoolKey] = useState<PoolKey>(POOL_PRESETS[0]!.poolKey);
  const [presetId, setPresetId] = useState<string>(POOL_PRESETS[0]!.id);
  const [tab, setTab] = useState<TabId>("state");

  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to request a read. Reading is explicit rather than tied to every
  // keystroke, because these are public endpoints and a read per character is
  // both slow and rude.
  const [readNonce, setReadNonce] = useState(0);

  const derived = useMemo(() => {
    try {
      return { poolId: derivePoolId(poolKey), error: null as string | null };
    } catch (e) {
      return { poolId: null, error: describeError(e) };
    }
  }, [poolKey]);

  // The same key with the hook removed. Showing both ids at once is the whole
  // V4 identity lesson: the hook is inside the hash, so dropping it does not
  // give you "the same pool without a hook", it gives you a different pool.
  const idWithoutHook = useMemo(() => {
    if (poolKey.hooks === ZERO_ADDRESS) {
      return null;
    }
    try {
      return derivePoolId({ ...poolKey, hooks: ZERO_ADDRESS });
    } catch {
      return null;
    }
  }, [poolKey]);

  useEffect(() => {
    if (!derived.poolId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPoolSnapshot(chainId, poolKey)
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSnapshot(null);
          setError(describeError(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // poolKey and chainId are read through the nonce so that editing a field
    // does not fire a read until the reader asks for one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readNonce]);

  const applyPreset = useCallback((id: string) => {
    const preset = POOL_PRESETS.find((p) => p.id === id);
    if (!preset) {
      return;
    }
    setPresetId(preset.id);
    setChainId(preset.chainId);
    setPoolKey(preset.poolKey);
    setReadNonce((n) => n + 1);
  }, []);

  const patch = useCallback((part: Partial<PoolKey>) => {
    setPoolKey((prev) => ({ ...prev, ...part }));
    setPresetId("");
  }, []);

  const deployment = getDeployment(chainId);
  const preset = POOL_PRESETS.find((p) => p.id === presetId) ?? null;

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="lab-head-left">
          <span className="eyebrow">Live lab</span>
          <h2 className="section-title">Read a real V4 pool, right now</h2>
          <p className="section-sub">
            Everything below runs the published library in your browser against
            public RPC. No backend, no wallet, no key: this page can read and
            verify, and nothing else. Executing a swap needs a signer, and that
            lives in KeeperHub.
          </p>
        </div>
      </div>

      <div className="lab-presets">
        {POOL_PRESETS.map((p) => (
          <button
            className={`lab-preset ${p.id === presetId ? "on" : ""}`}
            key={p.id}
            onClick={() => applyPreset(p.id)}
            type="button"
          >
            <b>{p.label}</b>
            <span>{getDeployment(p.chainId).name}</span>
            {p.poolKey.hooks === ZERO_ADDRESS ? null : (
              <em className="lab-hooked">hooked</em>
            )}
          </button>
        ))}
      </div>
      {preset ? <Note tone="mute">{preset.note}</Note> : null}

      <div className="lab-grid">
        <div className="lab-panel">
          <div className="lab-panel-title">
            PoolKey
            <span className="lab-panel-sub">the pool's identity</span>
          </div>

          <Field label="Chain">
            <select
              className="lab-input"
              onChange={(e) => {
                setChainId(Number(e.target.value));
                setPresetId("");
              }}
              value={chainId}
            >
              {SUPPORTED_CHAINS.map((id) => (
                <option key={id} value={id}>
                  {getDeployment(id).name} ({id})
                </option>
              ))}
            </select>
          </Field>

          <Field
            hint="Native ETH is the zero address, and must sort first."
            label="currency0"
          >
            <input
              className="lab-input mono"
              onChange={(e) => patch({ currency0: e.target.value })}
              spellCheck={false}
              value={poolKey.currency0}
            />
          </Field>

          <Field label="currency1">
            <input
              className="lab-input mono"
              onChange={(e) => patch({ currency1: e.target.value })}
              spellCheck={false}
              value={poolKey.currency1}
            />
          </Field>

          <div className="lab-field-pair">
            <Field hint="Hundredths of a bip." label="fee">
              <input
                className="lab-input mono"
                onChange={(e) => {
                  const v = parseIntish(e.target.value);
                  if (v !== null) {
                    patch({ fee: v });
                  }
                }}
                spellCheck={false}
                value={poolKey.fee}
              />
            </Field>
            <Field label="tickSpacing">
              <input
                className="lab-input mono"
                onChange={(e) => {
                  const v = parseIntish(e.target.value);
                  if (v !== null) {
                    patch({ tickSpacing: v });
                  }
                }}
                spellCheck={false}
                value={poolKey.tickSpacing}
              />
            </Field>
          </div>
          <div className="lab-inline-actions">
            <button
              className="lab-mini"
              onClick={() => patch({ fee: DYNAMIC_FEE })}
              type="button"
            >
              set dynamic fee
            </button>
            <span className="lab-field-hint">{describeFee(poolKey.fee)}</span>
          </div>

          <Field
            hint="Part of the identity. Change it and you are looking at a different pool."
            label="hooks"
          >
            <input
              className="lab-input mono"
              onChange={(e) => patch({ hooks: e.target.value })}
              spellCheck={false}
              value={poolKey.hooks}
            />
          </Field>

          <button
            className="btn btn-primary lab-read"
            disabled={loading || !derived.poolId}
            onClick={() => setReadNonce((n) => n + 1)}
            type="button"
          >
            {loading ? "Reading…" : "Read this pool"}
          </button>
        </div>

        <div className="lab-panel">
          <div className="lab-panel-title">
            poolId
            <span className="lab-panel-sub">
              keccak256(abi.encode(PoolKey))
            </span>
          </div>

          {derived.poolId ? (
            <>
              <div className="lab-poolid">
                <Mono breakAll>{derived.poolId}</Mono>
              </div>
              <div className="lab-inline-actions">
                <CopyButton value={derived.poolId} />
                <Pill tone={poolKey.hooks === ZERO_ADDRESS ? "mute" : "accent"}>
                  {poolKey.hooks === ZERO_ADDRESS ? "no hook" : "hooked"}
                </Pill>
                <Pill tone={poolKey.fee === DYNAMIC_FEE ? "accent" : "mute"}>
                  {describeFee(poolKey.fee)}
                </Pill>
              </div>

              {idWithoutHook ? (
                <div className="lab-contrast">
                  <div className="lab-contrast-title">
                    The same pair and fee, with no hook
                  </div>
                  <Mono breakAll>{idWithoutHook}</Mono>
                  <p>
                    A different id, so a different pool, with its own price and
                    its own liquidity. The hook address is hashed into the
                    identity, which is why V4 automation cannot key off a pair
                    of token addresses.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <Note tone="bad">
              {derived.error}
              <p>
                V4 requires currency0 to sort numerically below currency1. An
                unsorted key hashes to an id that belongs to no pool, and every
                read against it returns zeros rather than an error, so the
                library refuses it here instead.
              </p>
            </Note>
          )}

          <div className="lab-lenses">
            <div className="lab-panel-sub">Lens contracts on {deployment.name}</div>
            <Row label="StateView">
              <Mono>{shortHex(deployment.stateView, 8, 6)}</Mono>
            </Row>
            <Row label="PositionManager">
              <Mono>{shortHex(deployment.positionManager, 8, 6)}</Mono>
            </Row>
            <Row label="V4Quoter">
              <Mono>{shortHex(deployment.quoter, 8, 6)}</Mono>
            </Row>
          </div>
        </div>
      </div>

      <div className="lab-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            aria-selected={tab === t.id}
            className={`lab-tab ${tab === t.id ? "on" : ""}`}
            key={t.id}
            onClick={() => setTab(t.id)}
            role="tab"
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="lab-tabbody">
        {error ? <Note tone="bad">{error}</Note> : null}
        {loading && !snapshot ? <Spinner label="Reading chain state…" /> : null}

        {tab === "state" ? (
          <PoolStateTab
            chainId={chainId}
            loading={loading}
            snapshot={snapshot}
          />
        ) : null}
        {tab === "decide" ? (
          <DecideTab chainId={chainId} snapshot={snapshot} />
        ) : null}
        {tab === "workflow" ? (
          <WorkflowTab chainId={chainId} snapshot={snapshot} />
        ) : null}
        {tab === "positions" ? <PositionsTab chainId={chainId} /> : null}
        {tab === "verify" ? <VerifyTab /> : null}
      </div>
    </div>
  );
}
