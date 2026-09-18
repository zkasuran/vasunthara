"use client";

import { useCallback, useState } from "react";

export type Tone = "ok" | "warn" | "bad" | "mute" | "accent";

export function Pill({
  tone = "mute",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return <span className={`lab-pill ${tone}`}>{children}</span>;
}

/** A label and a value on one line, the shape most of this data wants. */
export function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="lab-row">
      <span className="lab-row-label" title={hint}>
        {label}
      </span>
      <span className="lab-row-value">{children}</span>
    </div>
  );
}

export function Mono({
  children,
  breakAll,
}: {
  children: React.ReactNode;
  breakAll?: boolean;
}) {
  return (
    <span className={breakAll ? "lab-mono break" : "lab-mono"}>{children}</span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="lab-field">
      <span className="lab-field-label">{label}</span>
      {children}
      {hint ? <span className="lab-field-hint">{hint}</span> : null}
    </label>
  );
}

export function Note({
  tone = "mute",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return <div className={`lab-note ${tone}`}>{children}</div>;
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    // clipboard is unavailable over plain http and in some embedded views, so
    // a failure has to leave the button honest rather than claim success.
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => setCopied(false));
  }, [value]);

  return (
    <button className="lab-copy" onClick={copy} type="button">
      {copied ? "Copied" : label}
    </button>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="lab-spinner" role="status">
      <span className="lab-spinner-dot" />
      {label}
    </span>
  );
}

/**
 * An explorer link. Opens in a new tab because the reader is mid-task, and
 * carries rel=noreferrer since the destination is a third party.
 */
export function ExplorerLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className="lab-link"
      href={href}
      rel="noreferrer noopener"
      target="_blank"
    >
      {children}
    </a>
  );
}
