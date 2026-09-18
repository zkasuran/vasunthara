# Vasunthara

**Read the pool. Rule the hook.**

Vasunthara is the deterministic read layer for automating Uniswap V4 hook
strategies. It reads live V4 pool state, position state and hook-aware quotes by
`poolId`, across every chain V4 is deployed on, so an automation engine can drive
limit orders, LP rebalancing and fee compounding without guessing.

## Why a read layer is the product

Uniswap V4 replaces V3's per-pool contracts with a single `PoolManager` and moves
per-pool logic into **hooks**: contracts attached to a pool that run before and
after swap, add-liquidity and remove-liquidity. A pool is identified not by an
address but by a `poolId`, the `keccak256` of its `PoolKey`
(`currency0, currency1, fee, tickSpacing, hooks`). Because the hooks address is
part of that key, a hooked pool and an otherwise identical no-hook pool are two
different pools.

So the first thing any deterministic V4 hook strategy needs, whether it is a
limit order that fires when the tick crosses a level, an LP position that
rebalances when it drifts out of range, or a fee-compounding job, is to read live
pool state and position state keyed by `poolId` and token id, including which
hook a position sits behind. That is exactly what Vasunthara provides.

## What it reads

Three canonical V4 lens contracts, reads only (no signer, no gas, no writes):

| Contract | Reads | Used for |
| --- | --- | --- |
| **StateView** | `getSlot0` (price/tick/fee), `getLiquidity`, `getFeeGrowthGlobals`, `getTickLiquidity`, `getPositionInfo` | gate a limit order on the tick, an exit on liquidity draining, a compound on fee growth |
| **PositionManager** | `getPositionLiquidity`, `getPoolAndPositionInfo` (returns the `PoolKey`, including its `hooks`), `ownerOf`, `nextTokenId` | know which hooked pool and range a position sits in before rebalancing |
| **V4Quoter** | `quoteExactInputSingle`, `quoteExactOutputSingle` (hook-aware, `hookData` forwarded to the hook) | price a fill against the exact hooked pool it will execute in |

Writes (`swap`, `modifyLiquidity`) go through the `PoolManager` unlock callback or
the Universal Router with an encoded action plan, a separate calldata surface;
this library is the read and quote foundation those actions are built on.

## Install

```bash
npm install vasunthara ethers
```

`ethers` v6 is a peer dependency.

## Usage

```ts
import { JsonRpcProvider } from "ethers";
import { VasuntharaReader, derivePoolId } from "vasunthara";

const provider = new JsonRpcProvider("https://ethereum-rpc.publicnode.com");
const reader = new VasuntharaReader(provider, 1); // Ethereum

// Derive a poolId from a PoolKey (the hook is part of the identity).
const poolId = derivePoolId({
  currency0: "0x0000000000000000000000000000000000000000", // native ETH
  currency1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  fee: 500,
  tickSpacing: 10,
  hooks: "0x0000000000000000000000000000000000000000",
});

// Monitor the pool.
const slot0 = await reader.getSlot0(poolId);
console.log(slot0.tick, slot0.sqrtPriceX96, slot0.lpFee);

// Inspect a position and the hook it sits behind.
const pos = await reader.getPoolAndPositionInfo(408_000n);
console.log(pos.poolKey.hooks, pos.hasHook, pos.dynamicFee);

// Price a swap through a specific hooked pool.
const quote = await reader.quoteExactInputSingle(
  { currency0: "0x0000000000000000000000000000000000000000", currency1: "0xA0b8...eB48", fee: 500, tickSpacing: 10, hooks: "0x0000000000000000000000000000000000000000" },
  true,          // zeroForOne
  10n ** 18n,    // 1 ETH
  "0x",          // hookData forwarded to the hook
);
console.log(quote.amount, quote.gasEstimate);
```

## Live proof

The library ships a proof CLI that reads real V4 state over public RPC:

```bash
npm run proof            # full sweep on Ethereum (chain 1)
npm run proof -- 8453    # Base
npm run proof -- all     # poolManager() liveness on all 7 chains
```

It prints live `getSlot0` / `getLiquidity` on the ETH/USDC pool, a hook-aware
quote, and scans recent positions for **real hooked pools**, printing each one's
hook address and liquidity.

## Chains

Ethereum (1), Base (8453), Arbitrum One (42161), Optimism (10), Polygon (137),
Unichain (130), Ethereum Sepolia (11155111). V4 does not reuse one address across
chains, so each lens address is listed explicitly in `src/deployments.ts` and
sourced from the Uniswap v4 deployments page.

## Verification

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest: ABI selectors, poolId derivation, live-response decode
npm run proof       # live reads over public RPC
```

The tests are deterministic (no network): they pin the on-chain function
selectors (`getSlot0` `0xc815641c`, `getPoolAndPositionInfo` `0x7ba03aad`,
`quoteExactInputSingle` `0xaa9d21cb`), assert the ETH/USDC `poolId` derivation,
and decode a recorded live `getSlot0` return.

## KeeperHub integration

`integrations/keeperhub/` carries the same read layer as a KeeperHub ABI-driven
protocol plugin (`slug: uniswap-v4`), so the reads become no-code workflow
actions in KeeperHub's visual builder. See that directory's README.

## License

Apache-2.0.

---

AI assistance (Kiro) was used to develop this project. Design, review and
on-chain verification are the author's.
