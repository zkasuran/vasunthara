import { Contract, type Provider } from "ethers";
import { isNativeCurrency } from "./vasunthara/swap";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
] as const;

export type TokenMeta = {
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
};

/**
 * Symbol and decimals for a pool currency.
 *
 * This matters for more than labelling. A tick encodes currency1 per currency0
 * in raw units, so an 18-decimal token quoted against a 6-decimal one prints a
 * price off by 10^12: the ETH/USDC pool reads 2.6e-9 raw and 2590 once the
 * decimals are applied. Showing the raw figure would look like a broken pool.
 *
 * Native ETH is the zero address in V4 and has no contract to ask, so it is
 * answered without a call. Tokens that do not implement the optional metadata
 * methods fall back to a short address and 18 decimals, which is a guess and is
 * labelled as one in the UI.
 */
export async function readTokenMeta(
  provider: Provider,
  address: string,
): Promise<TokenMeta> {
  if (isNativeCurrency(address)) {
    return { address, symbol: "ETH", decimals: 18 };
  }
  const token = new Contract(address, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([
    token.symbol().catch(() => `${address.slice(0, 6)}\u2026`),
    token.decimals().then(Number).catch(() => 18),
  ]);
  return { address, symbol: String(symbol), decimals: Number(decimals) };
}
