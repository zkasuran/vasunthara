# Live proof capture (2026-09-18T09:37Z)

Output of `npm run proof` (chain 1) and `npm run proof -- all`, reading real
Uniswap V4 state over public RPC through the shipped lens addresses.

**This is a capture, taken 2026-09-18.** Pool state moves, so the figures below
are a record of one moment rather than a current reading. Two things have changed
since, both worth stating rather than quietly editing a pasted capture:

- **Position #408579 has been burned.** `getPoolAndPositionInfo` now returns a
  zero PoolKey and a zero `info` word for it. That call does not revert, so a
  reader that does not check for an empty word would report range `[0, 0)` as
  real. The library returns `exists: false` for exactly this case, and a test
  pins it.
- The ETH/USDC tick and the quote have moved with the market.

For a reading that is current rather than captured, the
[live lab](https://vasunthara.vercel.app) performs these same reads in the
browser when you open it.

```

=== Ethereum (chain 1) ===
StateView.poolManager() -> 0x000000000004444c5dc75cB358380D2e3dE08A90
  expected canonical PoolManager: 0x000000000004444c5dc75cB358380D2e3dE08A90
  match: yes
PositionManager.nextTokenId() -> 408604

ETH/USDC 0.05% no-hook poolId -> 0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27
getSlot0 -> sqrtPriceX96 3963604230159869435309698, tick -198069, protocolFee 512125, lpFee 500
getLiquidity -> 1040359073077463346
getFeeGrowthGlobals -> global0 434402999819647202017658040925068205836950, global1 1062854311758515544315344782901208
quoteExactInputSingle(1 ETH -> USDC, hookData 0x) -> amountOut 2501088214 (~2501.09 USDC), gasEstimate 42631

Hook-aware position scan (most recent hooked positions):
  position #408579: hook 0xbf9828455cdc5F02771536e3EcB3c0F931EABEC4, currency1 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, fee 8388608 (dynamic), liquidity 289602464346483
  position #408571: hook 0x0000113dCf4ADd69999Fad8F20F2b63F979bfcC0, currency1 0xe343167631d89B6Ffc58B88d6b7fB0228795491D, fee 8388608 (dynamic), liquidity 129333415568258

Ethereum           (chain 1        ) poolManager() -> 0x000000000004444c5dc75cB358380D2e3dE08A90  [match]
Optimism           (chain 10       ) poolManager() -> 0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3  [match]
Unichain           (chain 130      ) poolManager() -> 0x1F98400000000000000000000000000000000004  [match]
Polygon            (chain 137      ) poolManager() -> 0x67366782805870060151383F4BbFF9daB53e5cD6  [match]
Base               (chain 8453     ) poolManager() -> 0x498581fF718922c3f8e6A244956aF099B2652b2b  [match]
Arbitrum One       (chain 42161    ) poolManager() -> 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32  [match]
Ethereum Sepolia   (chain 11155111 ) poolManager() -> 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543  [match]
```
