import type { ChainId } from "./vasunthara/deployments";
import type { PoolKey } from "./vasunthara/pool-id";

export type PoolPreset = {
  readonly id: string;
  readonly chainId: ChainId;
  readonly label: string;
  /** Why this pool is worth looking at. */
  readonly note: string;
  readonly poolKey: PoolKey;
};

const NATIVE = "0x0000000000000000000000000000000000000000";
const NO_HOOK = "0x0000000000000000000000000000000000000000";

/**
 * Pools to start from. Every one was read live on 2026-09-18 and returned a
 * non-zero sqrtPriceX96 and non-zero liquidity, so the lab has something real
 * to show before anyone types anything. The poolId is never stored: it is
 * derived from the PoolKey in the browser, which is the point being made.
 */
export const POOL_PRESETS: readonly PoolPreset[] = [
  {
    id: "sepolia-hooked",
    chainId: 11_155_111,
    label: "ETH / KHACN",
    note: "The pool this project executed a real swap through. Hooked, dynamic fee, on the chain KeeperHub and V4 share.",
    poolKey: {
      currency0: NATIVE,
      currency1: "0x291fb6a3e55e0c2655dde79fc8f5b2f063a75669",
      fee: 0x80_00_00,
      tickSpacing: 60,
      hooks: "0x304da18bd8c71581c34d452cfbe697a07284c080",
    },
  },
  {
    id: "mainnet-eth-usdc",
    chainId: 1,
    label: "ETH / USDC",
    note: "Ethereum mainnet, 0.05%, no hook. The reference case: same reads, no hook in the key.",
    poolKey: {
      currency0: NATIVE,
      currency1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      fee: 500,
      tickSpacing: 10,
      hooks: NO_HOOK,
    },
  },
  {
    id: "mainnet-hooked-stable",
    chainId: 1,
    label: "USDC / USDG",
    note: "A mainnet pool whose fee is set by a hook rather than by the key. Tick spacing 1.",
    poolKey: {
      currency0: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      currency1: "0xe343167631d89B6Ffc58B88d6b7fB0228795491D",
      fee: 0x80_00_00,
      tickSpacing: 1,
      hooks: "0x0000113dCf4ADd69999Fad8F20F2b63F979bfcC0",
    },
  },
  {
    id: "base-eth-usdc",
    chainId: 8453,
    label: "ETH / USDC",
    note: "Base mainnet, 0.05%. Different chain, different lens addresses, identical code path.",
    poolKey: {
      currency0: NATIVE,
      currency1: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      fee: 500,
      tickSpacing: 10,
      hooks: NO_HOOK,
    },
  },
  {
    id: "base-sepolia-hooked",
    chainId: 84_532,
    label: "ETH / test token",
    note: "Base Sepolia, hooked with a static fee. The deeper of the two testnet pools.",
    poolKey: {
      currency0: NATIVE,
      currency1: "0x7cbb899240912641b7b9c525e2fe624d03d71ec0",
      fee: 0,
      tickSpacing: 60,
      hooks: "0x8d346f24278c5cd786309161aac0fc2bbe4c25dc",
    },
  },
];

export type ReceiptPreset = {
  readonly hash: string;
  readonly chainId: ChainId;
  /** The pool the transaction is expected to have swapped. */
  readonly poolId: string;
  readonly label: string;
  readonly note: string;
  /** The KeeperHub workflow that produced it, where known. */
  readonly workflow?: string;
  /** What verifying this is expected to conclude. */
  readonly expect: "verified" | "no-v4-swap";
};

const SEPOLIA_DEMO_POOL =
  "0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c";

/**
 * Transactions KeeperHub executed, with the verdict each one should produce.
 *
 * The last three are here deliberately. They are real KeeperHub writes from
 * this project that were not V4 swaps, and the verifier returns `no-v4-swap`
 * for them. A checker that only ever agrees is not a checker, so the negative
 * cases ship alongside the positive ones.
 */
export const RECEIPT_PRESETS: readonly ReceiptPreset[] = [
  {
    hash: "0xd5bf7a3a08d96916f794c7b8d06b2a0fa5815cef0d6e617907669c8b6f10f88e",
    chainId: 11_155_111,
    poolId: SEPOLIA_DEMO_POOL,
    label: "Limit order filled",
    note: "The tick gate held, so the order filled. 0.00001 ETH in, KHACN out, and the fill matched the pre-flight simulation to the wei.",
    workflow: "zejfyrgcdewjh37bvgzpx",
    expect: "verified",
  },
  {
    hash: "0x5fcdb28d1fee08c7888213f5eef1135e82d917fdb1d279cab141e1aff6a6e5c1",
    chainId: 11_155_111,
    poolId: SEPOLIA_DEMO_POOL,
    label: "The same thing from one command",
    note: "Produced by `npm run demo -- --execute`: observe, decide, dry run, execute, verify.",
    workflow: "3ze3pkuq5ca3jfivl81nr",
    expect: "verified",
  },
  {
    hash: "0xdc11bf10405ffdb2bcbfbe5b2232845ee582ac3dcab487eb8027b85faa7f943e",
    chainId: 11_155_111,
    poolId: SEPOLIA_DEMO_POOL,
    label: "A KeeperHub write that was not a swap",
    note: "Succeeded on chain, but emitted no V4 Swap. The verifier says so rather than counting it as proof.",
    expect: "no-v4-swap",
  },
  {
    hash: "0xa5b9e7c3fecf2eaaa2ec76cc0169b8f4e1e4ee5939442ff55576af4c38404318",
    chainId: 84_532,
    poolId:
      "0x33f9cee7127e20027c2fa4b3cf8fe6518e44743cff3b0d823d6356f27b3db74b",
    label: "Base Sepolia, no swap",
    note: "A successful write on another chain that never touched the PoolManager.",
    expect: "no-v4-swap",
  },
];

/** KeeperHub's relayers, so the sender column can be named rather than guessed. */
export const KEEPERHUB_RELAYERS: Readonly<Record<string, string>> = {
  "0x809d8252aa4f9b8f7d9be7213855b289fe7d0444": "KeeperHub relayer (Sepolia)",
  "0x6331eb4571de9284f7e9ead98ac7b0661a091e99": "KeeperHub relayer (Base Sepolia)",
  "0x5af5194b4b0909eb978e3cf1e25333852277f07d": "KeeperHub executor contract",
};

export function describeCounterparty(address: string | null): string | null {
  if (!address) {
    return null;
  }
  return KEEPERHUB_RELAYERS[address.toLowerCase()] ?? null;
}
