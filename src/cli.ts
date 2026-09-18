#!/usr/bin/env tsx
import { JsonRpcProvider } from "ethers";
import {
  type ChainId,
  getDeployment,
  SUPPORTED_CHAINS,
} from "./deployments.js";
import { derivePoolId, type PoolKey } from "./pool-id.js";
import { VasuntharaReader } from "./reader.js";

// Live proof CLI for Vasunthara. Reads real Uniswap V4 state through the
// shipped lens addresses over public RPC. No keys, no signer, no writes.
//
// Usage:
//   tsx src/cli.ts                 # proof sweep on Ethereum (chain 1)
//   tsx src/cli.ts 8453            # proof sweep on Base
//   tsx src/cli.ts all             # poolManager() liveness on every chain

const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETH = "0x0000000000000000000000000000000000000000";

// The ETH/USDC 0.05% no-hook pool on mainnet: a deep, long-lived pool whose
// state is a stable proof target. Its key derives to the poolId asserted below.
const ETH_USDC_KEY: PoolKey = {
  currency0: ETH,
  currency1: USDC_MAINNET,
  fee: 500,
  tickSpacing: 10,
  hooks: ETH,
};

async function proveChain(chainId: ChainId): Promise<void> {
  const d = getDeployment(chainId);
  const provider = new JsonRpcProvider(d.rpcUrl);
  const reader = new VasuntharaReader(provider, chainId);

  console.log(`\n=== ${d.name} (chain ${chainId}) ===`);
  const pm = await reader.poolManager();
  console.log(`StateView.poolManager() -> ${pm}`);
  console.log(`  expected canonical PoolManager: ${d.poolManager}`);
  console.log(
    `  match: ${pm.toLowerCase() === d.poolManager.toLowerCase() ? "yes" : "NO"}`,
  );

  const nextId = await reader.nextTokenId();
  console.log(`PositionManager.nextTokenId() -> ${nextId}`);

  if (chainId === 1) {
    const poolId = derivePoolId(ETH_USDC_KEY);
    console.log(`\nETH/USDC 0.05% no-hook poolId -> ${poolId}`);
    const slot0 = await reader.getSlot0(poolId);
    console.log(
      `getSlot0 -> sqrtPriceX96 ${slot0.sqrtPriceX96}, tick ${slot0.tick}, protocolFee ${slot0.protocolFee}, lpFee ${slot0.lpFee}`,
    );
    console.log(`getLiquidity -> ${await reader.getLiquidity(poolId)}`);
    const fg = await reader.getFeeGrowthGlobals(poolId);
    console.log(
      `getFeeGrowthGlobals -> global0 ${fg.feeGrowthGlobal0}, global1 ${fg.feeGrowthGlobal1}`,
    );

    const quote = await reader.quoteExactInputSingle(
      ETH_USDC_KEY,
      true,
      10n ** 18n,
    );
    console.log(
      `quoteExactInputSingle(1 ETH -> USDC, hookData 0x) -> amountOut ${quote.amount} (~${(Number(quote.amount) / 1e6).toFixed(2)} USDC), gasEstimate ${quote.gasEstimate}`,
    );

    // Scan recent positions for a hooked one, to prove hook-aware reads.
    console.log("\nHook-aware position scan (most recent hooked positions):");
    let shown = 0;
    for (
      let id = Number(nextId) - 1;
      id > Number(nextId) - 60 && shown < 2;
      id--
    ) {
      try {
        const info = await reader.getPoolAndPositionInfo(BigInt(id));
        if (info.hasHook) {
          const liq = await reader.getPositionLiquidity(BigInt(id));
          console.log(
            `  position #${id}: hook ${info.poolKey.hooks}, currency1 ${info.poolKey.currency1}, fee ${info.poolKey.fee}${info.dynamicFee ? " (dynamic)" : ""}, liquidity ${liq}`,
          );
          shown++;
        }
      } catch {
        // skip burned/nonexistent ids
      }
    }
    if (shown === 0) {
      console.log("  (no hooked position found in the scanned window)");
    }
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "all") {
    for (const chainId of SUPPORTED_CHAINS) {
      try {
        const d = getDeployment(chainId);
        const provider = new JsonRpcProvider(d.rpcUrl);
        const reader = new VasuntharaReader(provider, chainId);
        const pm = await reader.poolManager();
        const ok = pm.toLowerCase() === d.poolManager.toLowerCase();
        console.log(
          `${d.name.padEnd(18)} (chain ${String(chainId).padEnd(9)}) poolManager() -> ${pm}  ${ok ? "[match]" : "[MISMATCH]"}`,
        );
      } catch (e) {
        console.log(`chain ${chainId}: ${(e as Error).message}`);
      }
    }
    return;
  }
  const chainId = arg ? Number(arg) : 1;
  await proveChain(chainId);
}

main().catch((e) => {
  console.error("proof failed:", (e as Error).message);
  process.exit(1);
});
