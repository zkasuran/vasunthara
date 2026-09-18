// Presentation helpers.
//
// These live in the library rather than in the site because the same figures
// are rendered by the CLI, the demo and the web lab, and a tick printed one way
// in one place and another way elsewhere is how a reader loses confidence in
// all of them. They are pure and have no opinion about where the output goes.

import { formatUnits } from "ethers";
import { type ChainId, getDeployment } from "./deployments.js";
import { isDynamicFee } from "./pool-id.js";

/**
 * The price a tick encodes: currency1 per currency0, before either token's
 * decimals are taken into account. V4 defines price as 1.0001^tick, so this is
 * exact arithmetic expressed in floating point, good for display and not for
 * sizing a trade.
 */
export function tickToPrice(tick: number): number {
  return 1.0001 ** tick;
}

/**
 * The same price scaled for the two tokens' decimals, which is what a human
 * reads as "USDC per ETH". Without this a pair whose decimals differ, such as
 * ETH at 18 and USDC at 6, prints a price off by a factor of 10^12.
 */
export function tickToPriceAdjusted(
  tick: number,
  decimals0: number,
  decimals1: number,
): number {
  return 1.0001 ** tick * 10 ** (decimals0 - decimals1);
}

/**
 * An LP fee in hundredths of a bip, as a percentage. The dynamic-fee sentinel
 * is not a rate at all, so it is named rather than divided: printing 0x800000
 * as 838.8608% would be nonsense.
 */
export function describeFee(fee: number): string {
  if (isDynamicFee(fee)) {
    return "dynamic (hook controlled)";
  }
  const percent = (fee / 10_000)
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `${percent}%`;
}

/** Group a digit string into thousands, so long liquidity figures are legible. */
function withThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A token amount at a given precision, grouped and with trailing zeros
 * dropped. Handles negative amounts because V4's balance deltas are signed.
 */
export function formatTokenAmount(
  amount: bigint,
  decimals = 18,
  maxFractionDigits = 6,
): string {
  const negative = amount < 0n;
  const text = formatUnits(negative ? -amount : amount, decimals);
  const [whole = "0", fraction = ""] = text.split(".");
  const kept = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  const body = kept ? `${withThousands(whole)}.${kept}` : withThousands(whole);
  return negative ? `-${body}` : body;
}

/** A large integer with thousands separators, for liquidity and gas. */
export function formatInteger(value: bigint | number): string {
  const text = value.toString();
  return text.startsWith("-")
    ? `-${withThousands(text.slice(1))}`
    : withThousands(text);
}

/**
 * Abbreviate a hex value for display, keeping enough of both ends that two
 * different ids cannot collide visually. `lead` and `tail` count hex digits,
 * not including the 0x prefix.
 */
export function shortHex(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 2) {
    return value;
  }
  return `${value.slice(0, lead + 2)}\u2026${value.slice(-tail)}`;
}

/** Case-insensitive comparison of two hex values, which RPCs mix freely. */
export function hexEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Block explorer link for an address on a chain. */
export function explorerAddressUrl(chainId: ChainId, address: string): string {
  return `${getDeployment(chainId).explorer}${address}`;
}

/**
 * Block explorer link for a transaction. The deployment table stores the
 * address form, and every explorer this library targets serves transactions at
 * the sibling `/tx/` path.
 */
export function explorerTxUrl(chainId: ChainId, hash: string): string {
  const base = getDeployment(chainId).explorer.replace(/address\/$/, "tx/");
  return `${base}${hash}`;
}
