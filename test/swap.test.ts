import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import type { PoolKey } from "../src/pool-id.js";
import {
  exactInputAmount,
  exactOutputAmount,
  isNativeCurrency,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  POOL_SWAP_TEST,
  POOL_SWAP_TEST_ABI,
  planExactInputSwap,
  swapNode,
  swapPriceLimit,
} from "../src/swap.js";

const SEPOLIA = 11_155_111;
const NATIVE = "0x0000000000000000000000000000000000000000";
const KHACN = "0x291fb6a3e55e0c2655dde79fc8f5b2f063a75669";

const POOL: PoolKey = {
  currency0: NATIVE,
  currency1: KHACN,
  fee: 0x80_00_00,
  tickSpacing: 60,
  hooks: "0x304da18bd8c71581c34d452cfbe697a07284c080",
};

describe("swap direction and amount encoding", () => {
  it("encodes exact input as a NEGATIVE amount, which V4 requires", () => {
    // v4-core PoolOperation.sol: "the desired input amount if negative
    // (exactIn), or the desired output amount if positive (exactOut)".
    expect(exactInputAmount(1000n)).toBe(-1000n);
    expect(exactOutputAmount(1000n)).toBe(1000n);
  });

  it("refuses a zero or negative amount rather than inverting the trade", () => {
    expect(() => exactInputAmount(0n)).toThrow(/must be positive/);
    expect(() => exactInputAmount(-1n)).toThrow(/must be positive/);
    expect(() => exactOutputAmount(0n)).toThrow(/must be positive/);
  });

  it("puts the price bound at the floor going down and the ceiling going up", () => {
    // The wrong end does not cost slippage, it halts the swap immediately and
    // returns a zero fill that still pays gas.
    expect(swapPriceLimit(true)).toBe(MIN_SQRT_PRICE + 1n);
    expect(swapPriceLimit(false)).toBe(MAX_SQRT_PRICE - 1n);
    expect(swapPriceLimit(true)).toBeLessThan(swapPriceLimit(false));
  });

  it("pins the TickMath bounds from v4-core", () => {
    expect(MIN_SQRT_PRICE).toBe(4_295_128_739n);
    expect(MAX_SQRT_PRICE).toBe(
      1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n,
    );
  });
});

describe("planExactInputSwap", () => {
  it("derives the direction from the currency being spent", () => {
    const zeroForOne = planExactInputSwap({
      chainId: SEPOLIA,
      poolKey: POOL,
      inputCurrency: NATIVE,
      amountIn: 10n ** 13n,
    });
    expect(zeroForOne.zeroForOne).toBe(true);

    const oneForZero = planExactInputSwap({
      chainId: SEPOLIA,
      poolKey: POOL,
      inputCurrency: KHACN,
      amountIn: 10n ** 13n,
    });
    expect(oneForZero.zeroForOne).toBe(false);
  });

  it("rejects a currency that is not in the pool", () => {
    expect(() =>
      planExactInputSwap({
        chainId: SEPOLIA,
        poolKey: POOL,
        inputCurrency: "0x00000000000000000000000000000000000000ff",
        amountIn: 1n,
      }),
    ).toThrow(/is not in this pool/);
  });

  it("refuses a chain with no shipped router rather than guessing one", () => {
    expect(() =>
      planExactInputSwap({
        chainId: 1,
        poolKey: POOL,
        inputCurrency: NATIVE,
        amountIn: 1n,
      }),
    ).toThrow(/no V4 swap router shipped for chain 1/);
  });

  it("expresses ethValue in DECIMAL ETHER, never wei", () => {
    // KeeperHub's write step calls ethers.parseEther(ethValue). Passing wei
    // would ask it to send ten trillion ETH.
    const plan = planExactInputSwap({
      chainId: SEPOLIA,
      poolKey: POOL,
      inputCurrency: NATIVE,
      amountIn: 10n ** 13n,
    });
    expect(plan.valueWei).toBe(10n ** 13n);
    expect(plan.ethValue).toBe("0.00001");
    expect(plan.ethValue).not.toBe(plan.valueWei.toString());
  });

  it("attaches no native value when paying in an ERC20", () => {
    const plan = planExactInputSwap({
      chainId: SEPOLIA,
      poolKey: POOL,
      inputCurrency: KHACN,
      amountIn: 10n ** 13n,
    });
    expect(plan.valueWei).toBe(0n);
    expect(plan.ethValue).toBe("0.0");
  });

  it("forwards hookData, defaulting to empty", () => {
    const base = planExactInputSwap({
      chainId: SEPOLIA,
      poolKey: POOL,
      inputCurrency: NATIVE,
      amountIn: 1n,
    });
    expect(base.hookData).toBe("0x");
    const withData = planExactInputSwap({
      chainId: SEPOLIA,
      poolKey: POOL,
      inputCurrency: NATIVE,
      amountIn: 1n,
      hookData: "0xdeadbeef",
    });
    expect(withData.hookData).toBe("0xdeadbeef");
  });

  it("recognises native currency", () => {
    expect(isNativeCurrency(NATIVE)).toBe(true);
    expect(isNativeCurrency(KHACN)).toBe(false);
  });
});

describe("the shipped routers", () => {
  it("covers exactly the three testnets that carry both V4 and KeeperHub", () => {
    expect(
      Object.keys(POOL_SWAP_TEST)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([84_532, 421_614, 11_155_111]);
  });

  it("encodes to the selector present in the deployed bytecode", () => {
    const iface = new Interface(POOL_SWAP_TEST_ABI as unknown as string[]);
    const data = iface.encodeFunctionData("swap", [
      [POOL.currency0, POOL.currency1, POOL.fee, POOL.tickSpacing, POOL.hooks],
      [true, -1n, MIN_SQRT_PRICE + 1n],
      [false, false],
      "0x",
    ]);
    // Confirmed present in the deployed PoolSwapTest on all three testnets.
    expect(data.slice(0, 10)).toBe("0x2229d0b4");
  });
});

describe("swapNode", () => {
  const plan = planExactInputSwap({
    chainId: SEPOLIA,
    poolKey: POOL,
    inputCurrency: NATIVE,
    amountIn: 10n ** 13n,
  });
  const node = swapNode({
    id: "v4-swap",
    label: "V4 Swap",
    description: "d",
    plan,
    x: 0,
  });

  it("targets the router, not the PoolManager", () => {
    // V4 will not let an EOA call PoolManager.swap: writes go through
    // unlock() and a callback, so the caller has to be a contract.
    expect(node.data.config.contractAddress).toBe(POOL_SWAP_TEST[SEPOLIA]);
  });

  it("passes tuples as NAMED OBJECTS, not positional arrays", () => {
    // KeeperHub validates each tuple component by name and rejects a
    // correctly-ordered array with "key.hooks: address is missing".
    const args = JSON.parse(node.data.config.functionArgs as string);
    expect(Array.isArray(args[0])).toBe(false);
    expect(args[0].hooks).toBe(POOL.hooks);
    expect(args[0].currency0).toBe(NATIVE);
    expect(args[1].zeroForOne).toBe(true);
    expect(args[1].amountSpecified).toBe("-10000000000000");
    expect(args[2]).toEqual({ takeClaims: false, settleUsingBurn: false });
    expect(args[3]).toBe("0x");
  });

  it("settles in real tokens rather than ERC-6909 claims", () => {
    const args = JSON.parse(node.data.config.functionArgs as string);
    expect(args[2].takeClaims).toBe(false);
    expect(args[2].settleUsingBurn).toBe(false);
  });

  it("carries the payable amount as decimal ether", () => {
    expect(node.data.config.ethValue).toBe("0.00001");
  });
});
