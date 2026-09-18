<div align="center">

# Vasunthara

### Read the pool. Rule the hook.

**The deterministic read layer for automating Uniswap V4 hook strategies.**

Read live V4 pool state, position state and hook-aware quotes by `poolId`, across every chain V4 is deployed on, so an automation engine can drive limit orders, LP rebalancing and fee compounding without guessing.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Uniswap V4](https://img.shields.io/badge/Uniswap-V4-ff007a.svg)](https://docs.uniswap.org/contracts/v4/overview)
[![Chains](https://img.shields.io/badge/chains-7-8b5cf6.svg)](#chains)
[![ethers](https://img.shields.io/badge/ethers-v6-27ae60.svg)](https://docs.ethers.org/v6/)
[![Tests](https://img.shields.io/badge/tests-12%20passing-3fb950.svg)](#verification)

**[Landing page](https://vasunthara.vercel.app)** · **[Live proof](./docs/PROOF.md)** · **[KeeperHub plugin](./integrations/keeperhub)**

</div>

---

## Why a read layer is the product

Uniswap V4 replaces V3's per-pool contracts with a single `PoolManager` and moves per-pool logic into **hooks**: contracts attached to a pool that run before and after swap, add-liquidity and remove-liquidity.

A pool is identified not by an address but by a **`poolId`**, the `keccak256` of its `PoolKey`:

```
poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
```

Because the **`hooks` address is part of that key**, a hooked pool and an otherwise identical no-hook pool are two different pools.

So the first thing any deterministic V4 hook strategy needs, whether it is a limit order that fires when the tick crosses a level, an LP position that rebalances when it drifts out of range, or a fee-compounding job, is to **read live pool state and position state keyed by `poolId` and token id, including which hook a position sits behind.** That is exactly what Vasunthara provides.

## What it reads

Three canonical V4 lens contracts. Reads only: no signer, no gas, no writes.

| Contract | Reads | Powers |
| --- | --- | --- |
| **StateView** | `getSlot0` (price / tick / fee), `getLiquidity`, `getFeeGrowthGlobals`, `getTickLiquidity`, `getPositionInfo` | gate a limit order on the tick, an exit on liquidity draining, a compound on fee growth |
| **PositionManager** | `getPositionLiquidity`, `getPoolAndPositionInfo` (returns the `PoolKey`, **including its `hooks`**), `ownerOf`, `nextTokenId` | know which hooked pool and range a position sits in before rebalancing |
| **V4Quoter** | `quoteExactInputSingle`, `quoteExactOutputSingle` (**hook-aware**, `hookData` forwarded to the hook) | price a fill against the exact hooked pool it will execute in |

> Writes (`swap`, `modifyLiquidity`) go through the `PoolManager` unlock callback or the Universal Router with an encoded action plan, a separate calldata surface. Vasunthara is the read and quote foundation those actions are built on.

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

// 1. Derive a poolId from a PoolKey (the hook is part of the identity)
const poolId = derivePoolId({
  currency0: "0x0000000000000000000000000000000000000000", // native ETH
  currency1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  fee: 500,
  tickSpacing: 10,
  hooks: "0x0000000000000000000000000000000000000000",
});

// 2. Monitor the pool  ->  gate a limit order / rebalance on the tick
const { tick, sqrtPriceX96, lpFee } = await reader.getSlot0(poolId);

// 3. Inspect a position and the hook it sits behind  ->  rebalance / compound
const pos = await reader.getPoolAndPositionInfo(408_000n);
console.log(pos.poolKey.hooks, pos.hasHook, pos.dynamicFee);

// 4. Price a swap through a specific hooked pool  ->  a limit-order fill
const quote = await reader.quoteExactInputSingle(
  poolKey,
  true,        // zeroForOne
  10n ** 18n,  // 1 ETH
  "0x",        // hookData forwarded to the hook
);
console.log(quote.amount, quote.gasEstimate);
```

### A limit-order trigger, end to end

```ts
// Fire when ETH/USDC crosses tick -197000, priced against the hooked pool.
const poolId = derivePoolId(poolKey);
const { tick } = await reader.getSlot0(poolId);

if (tick >= -197_000) {
  const quote = await reader.quoteExactInputSingle(poolKey, true, amountIn, hookData);
  // hand `quote.amount` to your executor as the minimum-out for the fill
}
```

## Live proof

Vasunthara ships a proof CLI that reads **real** V4 state over public RPC:

```bash
npm run proof            # full sweep on Ethereum (chain 1)
npm run proof -- 8453    # Base
npm run proof -- all     # poolManager() liveness on all 7 chains
```

It prints live `getSlot0` / `getLiquidity` on the ETH/USDC pool, a hook-aware quote, and scans recent positions for **real hooked pools**, printing each one's hook address and liquidity. A captured run lives in [`docs/PROOF.md`](./docs/PROOF.md). For example, on mainnet:

```
StateView.poolManager() -> 0x000000000004444c5dc75cB358380D2e3dE08A90  (match)
getSlot0(ETH/USDC 0.05%) -> tick -198070, lpFee 500
quoteExactInputSingle(1 ETH -> USDC) -> ~2500 USDC
HOOKED position #408579 -> hook 0xbf98..BEC4, dynamic-fee, liquidity 289602464346483
```

## Chains

Vasunthara ships lens addresses for seven chains. V4 does **not** reuse one address across chains, so each is listed explicitly in [`src/deployments.ts`](./src/deployments.ts), sourced from the [Uniswap v4 deployments page](https://docs.uniswap.org/contracts/v4/deployments).

| Chain | ID | Chain | ID |
| --- | --- | --- | --- |
| Ethereum | 1 | Polygon | 137 |
| Base | 8453 | Unichain | 130 |
| Arbitrum One | 42161 | Ethereum Sepolia | 11155111 |
| Optimism | 10 | | |

## Verification

```bash
npm run typecheck   # tsc --noEmit           -> clean
npm test            # vitest                 -> 12 passing
npm run lint        # biome                  -> clean
npm run proof       # live reads over RPC
```

The tests are **deterministic** (no network): they pin the on-chain function selectors (`getSlot0` `0xc815641c`, `getPoolAndPositionInfo` `0x7ba03aad`, `quoteExactInputSingle` `0xaa9d21cb`), assert the ETH/USDC `poolId` derivation, and decode a recorded live `getSlot0` return.

## KeeperHub integration

[`integrations/keeperhub/`](./integrations/keeperhub) carries the same read layer as a **KeeperHub ABI-driven protocol plugin** (`slug: uniswap-v4`, three contracts, thirteen actions), so the reads become **no-code workflow actions** in KeeperHub's visual builder. See that directory's README.

## Landing page

A Vercel-deployable landing page with animated explanations of the project and usage lives in [`site/`](./site).

```bash
cd site
npm install
npm run dev      # http://localhost:3000
npm run build    # static export to site/out, ready for Vercel
```

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fzkasuran%2Fvasunthara&root-directory=site)

## License

Apache-2.0.

---

<div align="center">
<sub>AI assistance (Kiro) was used to develop this project. Design, review and on-chain verification are the author's.</sub>
</div>
