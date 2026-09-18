<div align="center">

# Vasunthara

### Read the pool. Rule the hook.

**The Uniswap V4 execution layer for KeeperHub.**

Watch live V4 pool and position state by `poolId`, decide deterministically, then execute the swap through KeeperHub, with a receipt you can check on chain.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Uniswap V4](https://img.shields.io/badge/Uniswap-V4-ff007a.svg)](https://developers.uniswap.org/docs/protocols/v4/deployments)
[![KeeperHub](https://img.shields.io/badge/KeeperHub-execution-6366f1.svg)](https://keeperhub.com)
[![Chains](https://img.shields.io/badge/chains-9-8b5cf6.svg)](#chains)
[![Tests](https://img.shields.io/badge/tests-94%20passing-3fb950.svg)](#verification)

**[Landing page](https://vasunthara.vercel.app)** · **[Receipts](./docs/RECEIPTS.md)** · **[Live reads](./docs/PROOF.md)** · **[KeeperHub plugin](./integrations/keeperhub)**

</div>

---

## The gap

KeeperHub automates **47 integrations and 522 actions** across 24 chains. Ask its own catalogue what it knows about Uniswap and you get eleven actions, every one of them labelled, described and categorised **"Uniswap V3"**.

```bash
curl -H "Authorization: Bearer $KEEPERHUB_ORG_KEY" \
  'https://app.keeperhub.com/api/mcp/schemas?includeChains=false' \
  | jq -r '.actions | keys[] | select(startswith("uniswap/"))'
```

No `PoolManager`. No `poolId`. No hooks. Uniswap V4 has been live on nine chains for a year and the execution layer for onchain agents cannot see it.

Vasunthara closes that gap.

## What it does

```
        Uniswap V4                    Vasunthara                      KeeperHub
   ┌──────────────────┐        ┌──────────────────────┐        ┌──────────────────┐
   │ PoolManager      │        │                      │        │                  │
   │ StateView        │──read──▶  observe by poolId   │        │  Schedule        │
   │ PositionManager  │        │         │            │        │  Block           │
   │ V4Quoter         │        │         ▼            │◀trigger│  Swap event      │
   │                  │        │  decide, with guards │        │                  │
   │                  │        │         │            │        │  Condition       │
   │                  │        │         ▼            │        │  Circuit breaker │
   │ PoolSwapTest     │◀─send──│  plan the calldata   │──────▶ │  web3/write      │
   └──────────────────┘        └──────────────────────┘        └──────────────────┘
                                                                       │
                                                                  receipt, verified
```

Three stages, each usable on its own:

1. **Observe.** Read live pool state, position state and hook-aware quotes by `poolId` across every chain V4 ships on.
2. **Decide.** Pure functions from an observation to a decision, with guards that run first and in a fixed order. No clock, no network, no randomness, so a run replays exactly and every refusal carries its reason.
3. **Execute.** Render the decision as a KeeperHub workflow node and let KeeperHub sign, send, retry and record it.

## Proof: a limit order filled through V4

Transaction [`0xd5bf7a3a…f10f88e`](https://sepolia.etherscan.io/tx/0xd5bf7a3a08d96916f794c7b8d06b2a0fa5815cef0d6e617907669c8b6f10f88e) on Ethereum Sepolia, block 11730753, receipt `0x1`.

KeeperHub read `StateView.getSlot0` for a **hooked, dynamic-fee** pool and got tick `-4608`. The gate `-4608 >= -5000` held, so the order filled. The PoolManager then emitted `Swap` for that exact `poolId`:

```
poolId    0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c
amount0   -10000000000000      0.00001 ETH in
amount1    6276834406909       KHACN out
tick      -4608  ->  -4648
```

Those are the same numbers an `eth_call` simulation returned before anything was sent, to the wei.

**One thing to be clear about.** KeeperHub relays writes and sponsors the gas, so the explorer shows a KeeperHub relayer as `from` and its executor contract as `to`, never our wallet and never Uniswap. The proof that a specific V4 pool was traded is the emitted `Swap` event, not the sender column. [`docs/RECEIPTS.md`](./docs/RECEIPTS.md) shows how to check it yourself.

## Why a read layer comes first

V4 replaces V3's per-pool contracts with one `PoolManager` and moves pool logic into **hooks**. A pool is identified not by an address but by a **`poolId`**:

```
poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
```

The **`hooks` address is part of that key**, so a hooked pool and an otherwise identical pool with no hook are two different pools with two different ids. Any V4 automation is therefore a read problem before it is an execution problem. A workflow that hardcodes a pool address is automating nothing.

| Contract | Reads | Powers |
| --- | --- | --- |
| **StateView** | `getSlot0`, `getLiquidity`, `getFeeGrowthGlobals`, `getFeeGrowthInside`, `getTickLiquidity`, `getPositionInfo` | gate a limit order on the tick, an exit on liquidity draining, a compound on fees actually owed |
| **PositionManager** | `getPositionLiquidity`, `getPoolAndPositionInfo` (returns the `PoolKey`, **hook included**), `ownerOf`, `nextTokenId` | know which hooked pool and range a position sits in before rebalancing |
| **V4Quoter** | `quoteExactInputSingle`, `quoteExactOutputSingle` (**hook-aware**, `hookData` forwarded) | price a fill against the exact hooked pool it will execute in |

## The three strategies

Each is a pure function. Each ships as a KeeperHub workflow builder.

**Limit order.** Fires when the tick crosses a level. Price is currency1 per currency0 and equals `1.0001^tick`, so selling currency0 waits for the tick to rise to the trigger and selling currency1 waits for it to fall. Getting that backwards silently inverts the order, so it is derived rather than supplied.

**LP rebalance.** Fires when a position leaves its range by more than a tolerance. The tolerance is hysteresis, not fussiness: without it a tick resting on the boundary rebalances every block and pays fees to stand still.

**Fee compounding.** Gates on fees actually owed, using Uniswap's own formula:

```
owed = liquidity * (feeGrowthInsideNow - feeGrowthInsideLast) / 2^128
```

That subtraction **wraps**. Fee growth accumulators are unsigned and are allowed to overflow, so a plain subtraction goes negative across a wrap and reads as "no fees earned" at exactly the moment the most were earned. Vasunthara takes the delta mod 2^256. A test proves the naive version fails.

## Guards, which run before any strategy

The expensive failures in automated DeFi are rarely wrong maths. They are acting on a reading that was already stale, on a pool too thin to fill or through a hook that moved the fee after the order was written.

```ts
const guards = {
  maxObservationAgeSec: 60,      // reject a stale reading or one from the future
  minPoolLiquidity: 10n ** 15n,  // refuse a pool too thin to fill
  maxLpFeeHundredthsBip: 3000,   // refuse a dynamic-fee hook that raised the fee
};
```

Guards run first and in a fixed order, so a skip always carries the first reason that applied rather than whichever check happened to run. Every decision carries a stable `code` and the numbers behind it:

```ts
{ act: false, code: "stale-observation",
  reason: "observation is 120s old, limit is 60s",
  evidence: { poolId: "0xddbb…", tick: "-4608", ageSec: "120", … } }
```

## Usage

```bash
npm install vasunthara ethers
```

### Watch a pool

```ts
import { JsonRpcProvider } from "ethers";
import { VasuntharaReader, derivePoolId } from "vasunthara";

const reader = new VasuntharaReader(
  new JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com"),
  11155111,
);

const poolId = derivePoolId(poolKey);          // the hook is part of the identity
const { tick, lpFee } = await reader.getSlot0(poolId);
```

### Decide

```ts
import { decideLimitOrder } from "vasunthara";

const decision = decideLimitOrder(observation, config, quotedAmountOut, now);
if (!decision.act) {
  console.log(decision.code, decision.reason, decision.evidence);
}
```

### Execute through KeeperHub

```ts
import {
  KeeperHubClient, buildTickCrossWorkflow, planExactInputSwap, swapNode,
} from "vasunthara";

const plan = planExactInputSwap({
  chainId: 11155111,
  poolKey,
  inputCurrency: poolKey.currency0,
  amountIn: 10n ** 13n,
});

const workflow = buildTickCrossWorkflow({
  name: "v4-limit-order",
  chainId: 11155111,
  poolKey,
  comparison: ">=",
  triggerTick: -5000,
  trigger: { kind: "schedule", cron: "*/5 * * * *" },
  action: swapNode({ id: "v4-swap", label: "V4 Swap", description: "fill", plan, x: 816 }),
});

const client = new KeeperHubClient({ apiKey: process.env.KEEPERHUB_ORG_KEY });
const id = await client.createWorkflow(workflow);
const result = await client.run(id, {}, "limit-order-001");

console.log(result.transactionHashes);   // verified receipts, with block and gas
```

### Wake on the swap instead of polling

One `PoolManager` serves every pool on a chain and emits `Swap` with the `poolId` as its first indexed topic. So a workflow can wake on the swap itself and read the post-swap tick, price and liquidity out of the event with no extra RPC call:

```ts
buildSwapEventWorkflow({
  name: "v4-swap-driven",
  chainId: 11155111,
  poolKey,
  extraCondition: "{{@trigger-1:Trigger.args.tick}} <= -5000",
  action: swapNode({ /* … */ }),
});
```

The first Condition narrows the PoolManager-wide stream to one pool. That filter is not optional. A test pins it: without it the workflow acts on strangers' pools.

## Run it

```bash
npm install
npm run demo                  # observe, decide, dry run. Sends nothing.
npm run demo -- --execute     # also execute through KeeperHub
npm run demo -- --chain 84532 # Base Sepolia
```

The dry run is the default, because a demo that spends by accident is a bad
demo. `--execute` needs `KEEPERHUB_ORG_KEY` in the environment. It prints
the transaction hash, then re-fetches the receipt from a public RPC and checks
that the PoolManager emitted `Swap` for the expected `poolId`.

## Chains

Nine chains, every lens address verified live. On each one StateView, PositionManager and V4Quoter all return the same `poolManager()`, the address the Uniswap deployments page lists.

| Chain | ID | | Chain | ID |
| --- | --- | --- | --- | --- |
| Ethereum | 1 | | Unichain | 130 |
| Base | 8453 | | Polygon | 137 |
| Arbitrum One | 42161 | | Ethereum Sepolia | 11155111 |
| Optimism | 10 | | Base Sepolia | 84532 |
| | | | Arbitrum Sepolia | 421614 |

The three testnets are where both KeeperHub and V4 operate, so they are where this executes. `KEEPERHUB_CHAINS` and `KEEPERHUB_TESTNETS` are exported, because the intersection is a fact about the code rather than a line in a README.

Unichain Sepolia is deliberately absent. KeeperHub does not carry the chain, Uniswap's docs page and the `Uniswap/contracts` repo publish two different V4 deployments for it. Neither has had a pool initialised in the last 1.5M blocks. A test pins its absence.

## Verification

```bash
npm run typecheck   # tsc --noEmit                -> clean
npm test            # vitest                      -> 94 passing
npm run lint        # biome                       -> clean, 20 files
npm run proof       # live reads over public RPC
npm run proof -- all
```

Tests are deterministic and need no network. They pin the on-chain selectors (`getSlot0` `0xc815641c`, `getPoolAndPositionInfo` `0x7ba03aad`, `quoteExactInputSingle` `0xaa9d21cb`, `PoolSwapTest.swap` `0x2229d0b4`), the `Swap` event topic (`0x40e9cecb…d7112f`) against real logs, the `poolId` derivation plus the arithmetic that is easy to get wrong.

Read biome's `Checked N files` count rather than its exit code. It silently skips paths, so a clean run can mean nothing was read.

## KeeperHub plugin

[`integrations/keeperhub/`](./integrations/keeperhub) carries the same read layer as a KeeperHub ABI-driven protocol (`slug: uniswap-v4`, three contracts, thirteen actions), so the reads become no-code actions in the visual builder for everyone, not just for this project.

## Landing page

An animated explainer lives in [`site/`](./site) and deploys to Vercel as a static export.

## License

Apache-2.0.

---

<div align="center">
<sub>AI assistance was used to develop this project. The design, the review and every on-chain verification are the author's. Contract addresses, ABI selectors, event topics and opcode values in this repository were read from primary sources and then confirmed against deployed bytecode before shipping.</sub>
</div>
