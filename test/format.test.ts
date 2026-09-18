import { describe, expect, it } from "vitest";
import {
  describeFee,
  explorerAddressUrl,
  explorerTxUrl,
  formatInteger,
  formatTokenAmount,
  hexEquals,
  shortHex,
  tickToPrice,
  tickToPriceAdjusted,
} from "../src/format.js";
import { DYNAMIC_FEE_FLAG } from "../src/pool-id.js";

describe("tickToPrice", () => {
  it("is 1 at tick 0", () => {
    expect(tickToPrice(0)).toBe(1);
  });

  it("is one basis point up per tick", () => {
    expect(tickToPrice(1)).toBeCloseTo(1.0001, 10);
  });

  it("rises with the tick, which is the orientation a limit order depends on", () => {
    // Price is currency1 per currency0, so currency0 gets more expensive as
    // the tick rises. A strategy that assumes the opposite sells on the wrong
    // side of the market.
    expect(tickToPrice(-4648)).toBeLessThan(tickToPrice(-4608));
  });

  it("survives both tick extremes without overflowing to zero or infinity", () => {
    expect(tickToPrice(887_272)).toBeGreaterThan(0);
    expect(Number.isFinite(tickToPrice(887_272))).toBe(true);
    expect(tickToPrice(-887_272)).toBeGreaterThan(0);
  });
});

describe("tickToPriceAdjusted", () => {
  it("scales by the decimals difference", () => {
    // An 18-decimal token against a 6-decimal one shifts the price by 10^12,
    // which is the difference between a plausible number and a nonsense one.
    expect(tickToPriceAdjusted(0, 18, 6)).toBeCloseTo(1e12, 0);
    expect(tickToPriceAdjusted(0, 6, 18)).toBeCloseTo(1e-12, 20);
  });

  it("equals the raw price when both tokens share decimals", () => {
    expect(tickToPriceAdjusted(500, 18, 18)).toBeCloseTo(tickToPrice(500), 10);
  });
});

describe("describeFee", () => {
  it("names the dynamic-fee sentinel instead of dividing it", () => {
    // 0x800000 as a rate would print 838.8608%.
    expect(describeFee(DYNAMIC_FEE_FLAG)).toBe("dynamic (hook controlled)");
  });

  it("renders static fees as percentages", () => {
    expect(describeFee(500)).toBe("0.05%");
    expect(describeFee(3000)).toBe("0.3%");
    expect(describeFee(30_000)).toBe("3%");
    expect(describeFee(45)).toBe("0.0045%");
    expect(describeFee(0)).toBe("0%");
  });
});

describe("formatTokenAmount", () => {
  it("formats an 18-decimal amount", () => {
    expect(formatTokenAmount(10n ** 18n)).toBe("1");
    expect(formatTokenAmount(10n ** 13n)).toBe("0.00001");
  });

  it("groups the whole part", () => {
    expect(formatTokenAmount(1_234_567n * 10n ** 18n)).toBe("1,234,567");
  });

  it("keeps the sign on a negative balance delta", () => {
    // V4 reports deltas signed, and a fill's input side is negative.
    expect(formatTokenAmount(-10_000_000_000_000n)).toBe("-0.00001");
  });

  it("truncates rather than rounding up past the requested precision", () => {
    expect(formatTokenAmount(6_276_834_406_909n, 18, 6)).toBe("0.000006");
  });

  it("respects a non-18 decimals", () => {
    expect(formatTokenAmount(2_500_000_000n, 6)).toBe("2,500");
  });
});

describe("formatInteger", () => {
  it("groups large liquidity figures", () => {
    expect(formatInteger(4_022_000_000_000_000n)).toBe("4,022,000,000,000,000");
  });

  it("keeps a negative sign outside the grouping", () => {
    expect(formatInteger(-1_234_567n)).toBe("-1,234,567");
  });
});

describe("shortHex", () => {
  it("abbreviates a poolId while keeping both ends", () => {
    const poolId =
      "0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c";
    expect(shortHex(poolId)).toBe("0xddbb5b\u20264e8c");
  });

  it("leaves a value that is already short alone", () => {
    expect(shortHex("0x1234")).toBe("0x1234");
  });
});

describe("hexEquals", () => {
  it("ignores case, which RPCs mix freely", () => {
    expect(hexEquals("0xABCdef", "0xabcDEF")).toBe(true);
    expect(hexEquals("0xabc", "0xabd")).toBe(false);
  });
});

describe("explorer links", () => {
  it("builds an address link", () => {
    expect(explorerAddressUrl(11_155_111, "0xabc")).toBe(
      "https://sepolia.etherscan.io/address/0xabc",
    );
  });

  it("swaps the address path for the transaction path", () => {
    // The deployment table stores the address form only, so the tx form is
    // derived. Getting this wrong produces a link that 404s on every chain.
    expect(explorerTxUrl(11_155_111, "0xdead")).toBe(
      "https://sepolia.etherscan.io/tx/0xdead",
    );
    expect(explorerTxUrl(8453, "0xdead")).toBe(
      "https://basescan.org/tx/0xdead",
    );
    expect(explorerTxUrl(130, "0xdead")).toBe("https://uniscan.xyz/tx/0xdead");
  });

  it("covers every shipped chain", () => {
    for (const chainId of [
      1, 10, 130, 137, 8453, 42_161, 11_155_111, 84_532, 421_614,
    ]) {
      expect(explorerTxUrl(chainId, "0xdead")).toMatch(
        /^https:\/\/.+\/tx\/0xdead$/,
      );
    }
  });
});
