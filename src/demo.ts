// The end-to-end demo: observe a live Uniswap V4 pool, decide, dry run, then
// execute through KeeperHub and verify the receipt against the chain.
//
//   npm run demo                 read, decide and simulate. Sends nothing.
//   npm run demo -- --execute    also execute through KeeperHub.
//   npm run demo -- --chain 84532
//
// Default is the dry run, because a demo that spends by accident is a bad
// demo. Execution needs KEEPERHUB_ORG_KEY in the environment.

import { JsonRpcProvider } from "ethers";
import { type ChainId, getDeployment } from "./deployments.js";
import { KeeperHubClient } from "./keeperhub.js";
import { derivePoolId, type PoolKey } from "./pool-id.js";
import { VasuntharaReader } from "./reader.js";
import { checkSimulation, simulateSwap } from "./simulate.js";
import {
  decideLimitOrder,
  type Guards,
  type PoolObservation,
} from "./strategy.js";
import { planExactInputSwap, swapNode } from "./swap.js";
import { buildTickCrossWorkflow } from "./workflows.js";

/**
 * Live hooked pools, one per testnet, each confirmed to have a non-zero price
 * and liquidity and to quote without reverting.
 */
const DEMO_POOLS: Readonly<Record<number, PoolKey>> = {
  11155111: {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: "0x291fb6a3e55e0c2655dde79fc8f5b2f063a75669",
    fee: 0x80_00_00,
    tickSpacing: 60,
    hooks: "0x304da18bd8c71581c34d452cfbe697a07284c080",
  },
  84532: {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: "0x7cbb899240912641b7b9c525e2fe624d03d71ec0",
    fee: 0,
    tickSpacing: 60,
    hooks: "0x8d346f24278c5cd786309161aac0fc2bbe4c25dc",
  },
};

const AMOUNT_IN = 10n ** 13n; // 0.00001 ETH
const SLIPPAGE_BPS = 100;

const GUARDS: Guards = {
  maxObservationAgeSec: 120,
  minPoolLiquidity: 1n,
  maxLpFeeHundredthsBip: 100_000,
};

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Export it before running with --execute.`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const chainArg = args.indexOf("--chain");
  const chainId: ChainId =
    chainArg >= 0 ? Number(args[chainArg + 1]) : 11_155_111;

  const poolKey = DEMO_POOLS[chainId];
  if (!poolKey) {
    throw new Error(
      `no demo pool for chain ${chainId}. Available: ${Object.keys(DEMO_POOLS).join(", ")}`,
    );
  }
  const deployment = getDeployment(chainId);
  const poolId = derivePoolId(poolKey);

  heading("1. The pool");
  console.log(`chain        ${deployment.name} (${chainId})`);
  console.log(`poolId       ${poolId}`);
  console.log(`hook         ${poolKey.hooks}`);
  console.log(
    `fee          ${poolKey.fee === 0x80_00_00 ? "dynamic (hook controlled)" : poolKey.fee}`,
  );
  console.log(`StateView    ${deployment.stateView}`);
  console.log(
    "\nThe hook address is part of the PoolKey, so this id belongs to",
  );
  console.log("this hooked pool and to no other.");

  heading("2. Observe, live over public RPC");
  const provider = new JsonRpcProvider(deployment.rpcUrl);
  const reader = new VasuntharaReader(provider, chainId);
  const [slot0, liquidity, blockNumber] = await Promise.all([
    reader.getSlot0(poolId),
    reader.getLiquidity(poolId),
    provider.getBlockNumber(),
  ]);
  const observedAt = Math.floor(Date.now() / 1000);

  console.log(`block        ${blockNumber}`);
  console.log(`tick         ${slot0.tick}`);
  console.log(`sqrtPriceX96 ${slot0.sqrtPriceX96}`);
  console.log(`lpFee        ${slot0.lpFee}`);
  console.log(`liquidity    ${liquidity}`);

  const quote = await reader.quoteExactInputSingle(poolKey, true, AMOUNT_IN);
  console.log(
    `\nhook-aware quote for ${AMOUNT_IN} wei in: ${quote.amount} out`,
  );
  console.log(`(the quoter forwards hookData, so this is the hooked price)`);

  heading("3. Decide");
  const observation: PoolObservation = {
    poolId,
    poolKey,
    slot0,
    liquidity,
    blockNumber,
    observedAt,
  };
  // A level just below the live tick, so the order is one the pool has reached.
  const triggerTick = slot0.tick - 400;
  const decision = decideLimitOrder(
    observation,
    {
      poolKey,
      sellCurrency0: true,
      triggerTick,
      amountIn: AMOUNT_IN,
      slippageBps: SLIPPAGE_BPS,
      expiresAt: observedAt + 3600,
      guards: GUARDS,
    },
    quote.amount,
    observedAt,
  );

  console.log(`order        sell currency0 when tick >= ${triggerTick}`);
  console.log(`live tick    ${slot0.tick}`);
  console.log(
    `decision     ${decision.act ? "FILL" : `HOLD (${decision.code})`}`,
  );
  console.log(`reason       ${decision.reason}`);
  if (!decision.act) {
    console.log("\nNothing to execute. This is the refusal path, working.");
    return;
  }
  console.log(
    `minAmountOut ${decision.action.minAmountOut} (${SLIPPAGE_BPS} bps below the quote)`,
  );

  heading("4. Dry run, nothing signed");
  const plan = planExactInputSwap({
    chainId,
    poolKey,
    inputCurrency: poolKey.currency0,
    amountIn: AMOUNT_IN,
  });
  console.log(`router       ${plan.router}`);
  console.log(`zeroForOne   ${plan.zeroForOne}`);
  console.log(`amountSpec   ${plan.amountSpecified} (negative = exact input)`);
  console.log(`priceLimit   ${plan.sqrtPriceLimitX96}`);
  console.log(`ethValue     ${plan.ethValue} ETH`);

  const wallet = process.env.KEEPERHUB_WALLET ?? deployment.poolManager;
  const simulation = await simulateSwap(provider, plan, wallet);
  console.log(`\nsimulated in  ${simulation.amountIn}`);
  console.log(`simulated out ${simulation.amountOut}`);
  console.log(`gas estimate  ${simulation.gasEstimate}`);

  const problem = checkSimulation(
    simulation,
    decision.action.minAmountOut,
    AMOUNT_IN,
  );
  console.log(`floor check   ${problem ?? "PASS"}`);
  if (problem) {
    console.log("\nRefusing to send. The dry run is what caught this.");
    return;
  }

  if (!execute) {
    heading("5. Execute");
    console.log("Skipped. Re-run with --execute to send it through KeeperHub.");
    return;
  }

  heading("5. Execute through KeeperHub");
  const client = new KeeperHubClient({
    apiKey: requireEnv("KEEPERHUB_ORG_KEY"),
  });
  const workflow = buildTickCrossWorkflow({
    name: "vasunthara-demo-limit-order",
    description:
      "Vasunthara demo: read a hooked Uniswap V4 pool, gate on the tick, fill through the V4 router",
    chainId,
    poolKey,
    comparison: ">=",
    triggerTick,
    trigger: { kind: "manual" },
    action: swapNode({
      id: "v4-swap",
      label: "V4 Swap",
      description: "exact-input swap through the hooked pool",
      plan,
      x: 816,
    }),
  });

  const workflowId = await client.createWorkflow(workflow);
  console.log(`workflow     ${workflowId}`);
  const result = await client.run(
    workflowId,
    {},
    `vasunthara-demo-${blockNumber}`,
  );
  console.log(`execution    ${result.executionId}`);
  console.log(`status       ${result.status}`);
  if (result.error) {
    console.log(`error        ${result.error}`);
  }

  for (const receipt of result.transactionHashes) {
    console.log(`\ntx           ${receipt.hash}`);
    console.log(`block        ${receipt.blockNumber}`);
    console.log(`gas used     ${receipt.gasUsed}`);
    console.log(`receipt      ${receipt.receiptStatus}`);
    console.log(
      `explorer     ${deployment.explorer.replace("/address/", "/tx/")}${receipt.hash}`,
    );
  }

  heading("6. Verify against the chain, not against KeeperHub");
  for (const receipt of result.transactionHashes) {
    const confirmed = await provider.getTransactionReceipt(receipt.hash);
    console.log(
      `status       ${confirmed?.status === 1 ? "success" : "FAILED"}`,
    );
    console.log(
      `from         ${confirmed?.from}   (a KeeperHub relayer, not our wallet)`,
    );
    console.log(`logs         ${confirmed?.logs.length}`);
    const swapLog = confirmed?.logs.find(
      (log) =>
        log.address.toLowerCase() === deployment.poolManager.toLowerCase() &&
        log.topics[1]?.toLowerCase() === poolId.toLowerCase(),
    );
    console.log(
      `V4 Swap      ${swapLog ? `found, poolId matches: ${swapLog.topics[1]}` : "NOT FOUND"}`,
    );
  }

  const after = await reader.getSlot0(poolId);
  console.log(`\ntick         ${slot0.tick} -> ${after.tick}`);
  console.log(
    "The pool moved. Value went through Uniswap V4, sent by KeeperHub.",
  );
}

main().catch((error: unknown) => {
  console.error(
    `\ndemo failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
