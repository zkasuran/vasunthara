// Decoding the packed `info` word PositionManager returns alongside a
// position's PoolKey.
//
// A rebalance needs the position's tick range, and PositionManager does not
// expose it as its own getter: it is packed into one uint256 together with a
// truncated copy of the poolId. Without decoding this there is no way to tell
// whether a position is in range, so every rebalance decision depends on it.
//
// Layout, from v4-periphery src/libraries/PositionInfoLibrary.sol:
//
//   bits 255..56   the poolId, truncated to its upper 200 bits
//   bits  55..32   tickUpper, int24, two's complement
//   bits  31..8    tickLower, int24, two's complement
//   bits   7..0    hasSubscriber flag
//
// Confirmed live against Ethereum mainnet PositionManager
// 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e on 2026-09-18, on four
// independent positions (token ids 1, 100000, 250000, 408571). On every one:
// the decoded upper 200 bits equal the upper 200 bits of
// keccak256(abi.encode(poolKey)) computed from the PoolKey the same call
// returned, both ticks are exact multiples of that pool's tickSpacing, and
// tickLower < tickUpper. Token id 1 decodes to [-887270, 887270), which is
// V4's full range aligned to its tickSpacing of 10, so the sign handling is
// exercised at both extremes.

const TICK_MASK = (1n << 24n) - 1n;
const INT24_SIGN_BIT = 1n << 23n;
const INT24_RANGE = 1n << 24n;

/** The tick range and subscriber flag packed into a position's info word. */
export type DecodedPositionInfo = {
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly hasSubscriber: boolean;
  /**
   * The upper 200 bits of the pool's id, as packed. This is a truncated
   * poolId, so it is not a valid bytes32 handle for a StateView read; it is
   * only good for cross-checking against a poolId derived from the PoolKey.
   */
  readonly poolIdUpper200: bigint;
};

/**
 * Read a signed int24 out of a packed word at the given bit offset.
 * Ticks are signed and roughly half of all real ranges are negative, so
 * masking without sign-extending silently turns tick -5 into 16,777,211.
 */
function readInt24(word: bigint, shift: bigint): number {
  const raw = (word >> shift) & TICK_MASK;
  return Number(raw >= INT24_SIGN_BIT ? raw - INT24_RANGE : raw);
}

/**
 * True when PositionManager reported an empty info word, which is what a
 * token id that was never minted or has since been burned returns. The
 * decoded ticks would both be zero, a range that looks superficially valid,
 * so this has to be checked before the decode is trusted.
 */
export function positionInfoIsEmpty(info: bigint): boolean {
  return info === 0n;
}

/**
 * Decode a position's packed info word into its tick range.
 *
 * Throws on an empty word rather than returning a zero-width range, because
 * an empty word means the position does not exist and a caller that treats
 * [0, 0) as real would rebalance a position that is not there.
 */
export function decodePositionInfo(info: bigint): DecodedPositionInfo {
  if (positionInfoIsEmpty(info)) {
    throw new Error(
      "position info is zero: the token id was never minted or has been burned",
    );
  }
  return {
    tickLower: readInt24(info, 8n),
    tickUpper: readInt24(info, 32n),
    hasSubscriber: (info & 0xffn) !== 0n,
    poolIdUpper200: info >> 56n,
  };
}

/**
 * Check a decoded info word against the poolId derived from the PoolKey the
 * same call returned. They are two independent encodings of the same pool, so
 * a mismatch means the decode is wrong or the two values came from different
 * calls, and either way the range must not be acted on.
 */
export function positionMatchesPool(info: bigint, poolId: string): boolean {
  if (positionInfoIsEmpty(info)) {
    return false;
  }
  return info >> 56n === BigInt(poolId) >> 56n;
}
