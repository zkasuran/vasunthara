// The execution half: turning a decision into a Uniswap V4 swap that a
// KeeperHub workflow can send.
//
// V4 writes do not work like V3. There is one PoolManager and it will not let
// an EOA call swap() directly: every state change goes through unlock() and a
// callback, so the caller must be a contract. That is why this module targets
// a router rather than the PoolManager.
//
// It uses PoolSwapTest, Uniswap's own periphery router from v4-core, which is
// deployed on all three testnets KeeperHub supports. Verified live 2026-09-18:
// the selector 0x2229d0b4 is present in the deployed bytecode on each chain,
// and each router's manager() returns exactly the PoolManager this library
// ships for that chain, so the router is provably bound to the right core.
//
// PoolSwapTest is a testnet router. On mainnet the equivalent path is the
// Universal Router with a V4_SWAP command (0x10) carrying an action plan of
// SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f), and the
// struct that plan encodes differs between v4-periphery releases, so it has to
// be read off the deployed router rather than assumed. That is left unshipped
// rather than guessed.

import { formatEther } from "ethers";
import type { ChainId } from "./deployments.js";
import type { WorkflowNode } from "./keeperhub.js";
import type { PoolKey } from "./pool-id.js";
import { writeNode } from "./workflows.js";

/**
 * Uniswap's PoolSwapTest router, per chain. Confirmed on chain: correct
 * bytecode, the swap selector present, and manager() pointing at this
 * library's PoolManager for the same chain.
 */
export const POOL_SWAP_TEST: Readonly<Record<ChainId, string>> = {
  11155111: "0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe",
  84532: "0x8B5bcC363ddE2614281aD875bad385E0A785D3B9",
  421614: "0xf3A39C86dbd13C45365E57FB90fe413371F65AF8",
};

/** Uniswap's PoolModifyLiquidityTest router, the liquidity-side counterpart. */
export const POOL_MODIFY_LIQUIDITY_TEST: Readonly<Record<ChainId, string>> = {
  11155111: "0x0C478023803a644c94c4CE1C1e7b9A087e411B0A",
  84532: "0x37429cD17Cb1454C34E7F50b09725202Fd533039",
  421614: "0x9A8ca723F5dcCb7926D00B71deC55c2fEa1F50f7",
};

export const POOL_SWAP_TEST_ABI = [
  "function swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, (bool takeClaims, bool settleUsingBurn) testSettings, bytes hookData) payable returns (int256 delta)",
] as const;

/** TickMath bounds, from Uniswap/v4-core src/libraries/TickMath.sol. */
export const MIN_SQRT_PRICE = 4_295_128_739n;
export const MAX_SQRT_PRICE =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

/**
 * The price bound to pass when the swap should run to completion rather than
 * stop early.
 *
 * A zeroForOne swap pushes the price DOWN, so its limit sits just above the
 * floor. The other direction pushes it UP, so its limit sits just below the
 * ceiling. Passing the wrong end is not a slippage bug, it halts the swap
 * immediately and the caller gets a zero fill that still costs gas.
 *
 * This is NOT slippage protection. The real bound is the minimum-out the
 * strategy computed from a hook-aware quote.
 */
export function swapPriceLimit(zeroForOne: boolean): bigint {
  return zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
}

/**
 * V4 encodes the direction of a swap in the SIGN of the amount: negative is
 * the desired input (exact in), positive is the desired output (exact out).
 * Source: Uniswap/v4-core src/types/PoolOperation.sol, SwapParams.
 *
 * Getting this backwards turns "spend 0.001 ETH" into "acquire 0.001 ETH",
 * which is a different trade that can consume the whole balance.
 */
export function exactInputAmount(amountIn: bigint): bigint {
  if (amountIn <= 0n) {
    throw new Error(`amountIn must be positive, got ${amountIn}`);
  }
  return -amountIn;
}

/** The exact-output form, for completeness. */
export function exactOutputAmount(amountOut: bigint): bigint {
  if (amountOut <= 0n) {
    throw new Error(`amountOut must be positive, got ${amountOut}`);
  }
  return amountOut;
}

/** True when the pool's currency0 is native ETH, which changes how it pays. */
export function isNativeCurrency(currency: string): boolean {
  return /^0x0{40}$/i.test(currency);
}

export type V4SwapPlan = {
  readonly chainId: ChainId;
  readonly router: string;
  readonly poolKey: PoolKey;
  readonly zeroForOne: boolean;
  readonly amountSpecified: bigint;
  readonly sqrtPriceLimitX96: bigint;
  readonly hookData: string;
  /** Native currency the call must carry, in wei. */
  readonly valueWei: bigint;
  /**
   * The same amount as a DECIMAL ETHER string, which is what KeeperHub's
   * `ethValue` field expects: its write-contract step calls
   * `ethers.parseEther(ethValue)`, so "0.00001" means 0.00001 ETH and passing
   * wei here would ask it to send ten trillion ETH.
   */
  readonly ethValue: string;
};

/**
 * Plan an exact-input swap through a specific hooked pool.
 *
 * The direction is derived from which currency is being spent rather than
 * taken from the caller, because a caller who supplies the direction can
 * invert it and sell the asset they meant to buy.
 */
export function planExactInputSwap(params: {
  chainId: ChainId;
  poolKey: PoolKey;
  /** The currency being spent. Must be one of the pool's two. */
  inputCurrency: string;
  amountIn: bigint;
  /** Forwarded to the hook exactly as an on-chain swap would. */
  hookData?: string;
}): V4SwapPlan {
  const router = POOL_SWAP_TEST[params.chainId];
  if (!router) {
    throw new Error(
      `no V4 swap router shipped for chain ${params.chainId}. Supported: ${Object.keys(POOL_SWAP_TEST).join(", ")}`,
    );
  }

  const c0 = params.poolKey.currency0.toLowerCase();
  const c1 = params.poolKey.currency1.toLowerCase();
  const input = params.inputCurrency.toLowerCase();

  let zeroForOne: boolean;
  if (input === c0) {
    zeroForOne = true;
  } else if (input === c1) {
    zeroForOne = false;
  } else {
    throw new Error(
      `inputCurrency ${params.inputCurrency} is not in this pool (${params.poolKey.currency0}, ${params.poolKey.currency1})`,
    );
  }

  // A native-ETH input is paid as msg.value. An ERC20 input is pulled by the
  // router, which needs an allowance set beforehand.
  const valueWei =
    isNativeCurrency(params.inputCurrency) && zeroForOne ? params.amountIn : 0n;

  return {
    chainId: params.chainId,
    router,
    poolKey: params.poolKey,
    zeroForOne,
    amountSpecified: exactInputAmount(params.amountIn),
    sqrtPriceLimitX96: swapPriceLimit(zeroForOne),
    hookData: params.hookData ?? "0x",
    valueWei,
    ethValue: formatEther(valueWei),
  };
}

/**
 * Render a plan as the KeeperHub node that executes it.
 *
 * Tuple arguments go as OBJECTS with named keys, not positional arrays.
 * KeeperHub validates each component by name, so an array argument is rejected
 * with "key.hooks: address is missing" even though the array is correctly
 * ordered and would encode fine with a plain ABI coder.
 *
 * takeClaims and settleUsingBurn are both false: settle in real tokens rather
 * than in ERC-6909 claim tokens, so the balance movement is visible on chain
 * as a transfer rather than only inside the PoolManager's accounting.
 */
export function swapNode(params: {
  id: string;
  label: string;
  description: string;
  plan: V4SwapPlan;
  x: number;
}): WorkflowNode {
  const { plan } = params;
  return writeNode({
    id: params.id,
    label: params.label,
    description: params.description,
    chainId: plan.chainId,
    contractAddress: plan.router,
    abi: POOL_SWAP_TEST_ABI,
    functionName: "swap",
    args: [
      {
        currency0: plan.poolKey.currency0,
        currency1: plan.poolKey.currency1,
        fee: plan.poolKey.fee,
        tickSpacing: plan.poolKey.tickSpacing,
        hooks: plan.poolKey.hooks,
      },
      {
        zeroForOne: plan.zeroForOne,
        amountSpecified: plan.amountSpecified.toString(),
        sqrtPriceLimitX96: plan.sqrtPriceLimitX96.toString(),
      },
      { takeClaims: false, settleUsingBurn: false },
      plan.hookData,
    ],
    ethValue: plan.ethValue,
    x: params.x,
  });
}
