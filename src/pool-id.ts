import { AbiCoder, getAddress, keccak256, ZeroAddress } from "ethers";

/**
 * A Uniswap V4 pool key. The pool's identity: two currencies (sorted, native
 * ETH is the zero address), an LP fee, a tick spacing, and the hook contract.
 * The hook is part of the identity, so a hooked pool and the same pair with no
 * hook are two different pools.
 */
export type PoolKey = {
  currency0: string;
  currency1: string;
  /** LP fee in hundredths of a bip. 500 = 0.05%. 0x800000 = dynamic fee. */
  fee: number;
  tickSpacing: number;
  hooks: string;
};

/** The dynamic-fee sentinel a hook sets when it controls the fee. */
export const DYNAMIC_FEE_FLAG = 0x800000;

const coder = AbiCoder.defaultAbiCoder();

/**
 * Derive the poolId for a PoolKey: keccak256(abi.encode(PoolKey)), which is
 * exactly how PoolManager computes PoolId.toId(). This is the handle every
 * StateView read takes, so a workflow computes it once from the key and reuses
 * it.
 *
 * Currencies are checksummed and their sort order is validated: currency0 must
 * be numerically below currency1, or the resulting id points at a pool that
 * does not exist. Native ETH (zero address) always sorts first.
 */
export function derivePoolId(key: PoolKey): string {
  const c0 = normalizeCurrency(key.currency0);
  const c1 = normalizeCurrency(key.currency1);
  const hooks = getAddress(key.hooks);

  if (BigInt(c0) >= BigInt(c1)) {
    throw new Error(
      `PoolKey currencies must be sorted: currency0 (${c0}) must be numerically below currency1 (${c1})`,
    );
  }
  if (key.fee < 0 || key.fee > 0xff_ff_ff) {
    throw new Error(`fee must fit in uint24, got ${key.fee}`);
  }

  const encoded = coder.encode(
    ["address", "address", "uint24", "int24", "address"],
    [c0, c1, key.fee, key.tickSpacing, hooks],
  );
  return keccak256(encoded);
}

/** True when the pool's fee is hook-controlled (dynamic). */
export function isDynamicFee(fee: number): boolean {
  return fee === DYNAMIC_FEE_FLAG;
}

/** True when the pool has a hook attached (non-zero hooks address). */
export function hasHook(hooks: string): boolean {
  return getAddress(hooks) !== ZeroAddress;
}

function normalizeCurrency(value: string): string {
  // Native ETH is the zero address in V4; getAddress accepts it.
  return getAddress(value);
}
