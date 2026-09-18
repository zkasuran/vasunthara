# Receipts

Every transaction below was executed by **KeeperHub**, against **Uniswap V4**,
on a public testnet. Each one is re-verified here against a public RPC rather
than against KeeperHub's own report, because a platform confirming its own work
is not independent evidence.

Captured 2026-09-18.

---

## Read the sender column carefully

KeeperHub relays writes and sponsors the gas, so **the explorer never shows our
wallet as `from`**. On the transaction below, `from` is KeeperHub's relayer
`0x809d8252aa4f9b8f7d9be7213855b289fe7d0444` and `to` is its executor contract
`0x5af5194b4b0909eb978e3cf1e25333852277f07d`. Neither is our wallet. Neither
is Uniswap V4.

That is not a caveat hiding a weak claim, it is how sponsored execution works.
It is why the proof here is the **emitted `Swap` event on the PoolManager**
plus KeeperHub's own `executedCall` record, not the sender column. The event is
what ties the transaction to a specific Uniswap V4 pool.

---

## A limit order filled through Uniswap V4

**Transaction** [`0xd5bf7a3a08d96916f794c7b8d06b2a0fa5815cef0d6e617907669c8b6f10f88e`](https://sepolia.etherscan.io/tx/0xd5bf7a3a08d96916f794c7b8d06b2a0fa5815cef0d6e617907669c8b6f10f88e)

| | |
| --- | --- |
| Chain | Ethereum Sepolia (11155111) |
| Block | 11730753 |
| Receipt status | `0x1` success |
| Gas used | 160,400 |
| Sponsored | yes, EIP-7702 relayed |
| KeeperHub workflow | `zejfyrgcdewjh37bvgzpx` |

### The pool

The workflow targets one specific **hooked, dynamic-fee** pool. The poolId is
derived by Vasunthara from the PoolKey rather than pasted in. The hook address
is part of that key:

```
poolId      0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c
currency0   0x0000000000000000000000000000000000000000   native ETH
currency1   0x291fb6a3e55e0c2655dde79fc8f5b2f063a75669   KHACN
fee         0x800000                                      dynamic, hook controlled
tickSpacing 60
hooks       0x304da18bd8c71581c34d452cfbe697a07284c080   beforeSwap
```

### What the run did, node by node

| Node | Result |
| --- | --- |
| Trigger | fired |
| Read V4 Slot0 | `StateView.getSlot0(poolId)` returned tick `-4608`, sqrtPriceX96 `62925900728336853999920795843` |
| Tick Crossed | `-4608 >= -5000` evaluated `true`, so the order filled |
| V4 Swap | `PoolSwapTest.swap(...)` on `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe` |

### The Swap event, decoded from the receipt

Read from the PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` on a
public RPC, not from KeeperHub:

```
topic0        0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f
poolId        0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c   <- ours
sender        0x9b6b46e2c869aa39918db7f52f5557fe577b6eee
amount0       -10000000000000      we paid 0.00001 ETH
amount1        6276834406909       we received KHACN
sqrtPriceX96   62802255264272773889591473167
liquidity      4022000000000000
tick after    -4648
fee            3000
```

**Value moved.** The pool took 0.00001 ETH and paid out 6,276,834,406,909 KHACN.
The swap moved the pool's tick from `-4608` to `-4648`.

### The fill matched the simulation exactly

Before sending anything, the same calldata was simulated with `eth_call` from
the executing wallet. The simulation returned a BalanceDelta of
`amount0 -10000000000000, amount1 6276834406909`.

The realised swap returned **the same numbers, to the wei**. The estimate was
133,327 gas against 160,400 used, the difference being the relay wrapper the
simulation does not model.

### Reproduce the verification

```bash
cast receipt 0xd5bf7a3a08d96916f794c7b8d06b2a0fa5815cef0d6e617907669c8b6f10f88e \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

Look for a log from `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` whose first
topic is the Swap hash above and whose second topic is the poolId.

---

## The same thing, as one reproducible command

`npm run demo -- --execute` runs the whole pipeline and prints every step:
observe the live pool, decide, dry run, execute, then verify the receipt
against the chain rather than against KeeperHub.

**Transaction** [`0x5fcdb28d1fee08c7888213f5eef1135e82d917fdb1d279cab141e1aff6a6e5c1`](https://sepolia.etherscan.io/tx/0x5fcdb28d1fee08c7888213f5eef1135e82d917fdb1d279cab141e1aff6a6e5c1)

| | |
| --- | --- |
| Chain | Ethereum Sepolia (11155111) |
| Block | 11730849 |
| Receipt status | success |
| Gas used | 142,531 |
| KeeperHub workflow | `3ze3pkuq5ca3jfivl81nr` |
| KeeperHub execution | `p0bpwl3of0loy4wu9hy7e` |

The demo's own verification step, printed at the end of that run:

```
status       success
from         0x809D8252aa4f9b8F7D9bE7213855b289fe7D0444   (a KeeperHub relayer, not our wallet)
logs         3
V4 Swap      found, poolId matches: 0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c

tick         -4648 -> -4687
```

Run it without `--execute` first. The default is a dry run that reads, decides
and simulates without signing anything, because a demo that spends by accident
is a bad demo.

---

## Reading V4 state through KeeperHub

**Workflow** `imrvaffxear02tfxnow6w`

The read half on its own, with the gate deliberately set to an unreachable tick
so it would hold. KeeperHub called `StateView.getSlot0` on Ethereum Sepolia and
returned:

```
tick          -4608
sqrtPriceX96   62925900728336853999920795843
protocolFee    0
lpFee          0
```

which matches a direct `cast call` against the same StateView at the same time.
The `Tick Crossed` gate then evaluated `false` and the run stopped before the
action, which is the refusal path working.

---

## Contracts this depends on, each checked on chain

| Chain | PoolManager | PoolSwapTest |
| --- | --- | --- |
| Ethereum Sepolia (11155111) | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe` |
| Base Sepolia (84532) | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` | `0x8B5bcC363ddE2614281aD875bad385E0A785D3B9` |
| Arbitrum Sepolia (421614) | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` | `0xf3A39C86dbd13C45365E57FB90fe413371F65AF8` |

On every chain: StateView, PositionManager and V4Quoter all return the same
`poolManager()`, the one listed above. Each PoolSwapTest carries the
`swap` selector `0x2229d0b4` in its deployed bytecode and its `manager()`
returns that chain's PoolManager, so the router is provably bound to the right
core rather than merely being an address someone published.

```bash
npm run proof -- all      # poolManager liveness across every shipped chain
```

---

## Testnet only

Everything here runs on a testnet. No real funds move. Uniswap V4 and KeeperHub
both operate on Ethereum, Optimism, Polygon, Base and Arbitrum mainnet. The
same code paths address those chains. This project does not send mainnet
transactions.

`PoolSwapTest` is Uniswap's own router from `v4-core` and is a testnet
component. The mainnet equivalent is the Universal Router with a `V4_SWAP`
command (`0x10`) carrying an action plan of `SWAP_EXACT_IN_SINGLE` (`0x06`),
`SETTLE_ALL` (`0x0c`) and `TAKE_ALL` (`0x0f`). The struct that plan encodes has
changed between v4-periphery releases, so it has to be read off the deployed
router rather than assumed. It is left unshipped rather than guessed.
