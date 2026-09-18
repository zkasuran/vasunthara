// Vasunthara - read the pool, rule the hook.
// The deterministic read layer for automating Uniswap V4 hook strategies.

export {
  POOL_MANAGER_EVENTS_ABI,
  POSITION_MANAGER_ABI,
  QUOTER_ABI,
  STATE_VIEW_ABI,
} from "./abis.js";
export {
  type ChainId,
  DEPLOYMENTS,
  getDeployment,
  KEEPERHUB_CHAINS,
  KEEPERHUB_TESTNETS,
  SUPPORTED_CHAINS,
  type V4Deployment,
} from "./deployments.js";
export {
  describeFee,
  explorerAddressUrl,
  explorerTxUrl,
  formatInteger,
  formatTokenAmount,
  hexEquals,
  shortHex,
  tickToPrice,
  tickToPriceAdjusted,
} from "./format.js";
export {
  type ExecutionResult,
  KeeperHubClient,
  KeeperHubError,
  type KeeperHubOptions,
  receiptLinks,
  type TransactionReceipt,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from "./keeperhub.js";
export {
  DYNAMIC_FEE_FLAG,
  derivePoolId,
  hasHook,
  isDynamicFee,
  type PoolKey,
} from "./pool-id.js";
export {
  type DecodedPositionInfo,
  decodePositionInfo,
  positionInfoIsEmpty,
  positionMatchesPool,
} from "./position-info.js";
export {
  type FeeGrowthGlobals,
  type FeeGrowthInside,
  type PoolPositionInfo,
  type PositionInfo,
  type QuoteResult,
  type Slot0,
  type TickLiquidity,
  VasuntharaReader,
} from "./reader.js";
export {
  checkSimulation,
  decodeBalanceDelta,
  resetCircuitBreakerNode,
  type SwapSimulation,
  sanityGate,
  simulateSwap,
  tripCircuitBreakerNode,
} from "./simulate.js";
export {
  alignTickDown,
  applySlippage,
  type CompoundAction,
  type CompoundConfig,
  centredRange,
  checkGuards,
  clampTick,
  type Decision,
  decideCompound,
  decideLimitOrder,
  decideRebalance,
  type Evidence,
  type FeeCheckpoint,
  type FeeGrowthInsideNow,
  feesOwed,
  type Guards,
  isInRange,
  type LimitOrderConfig,
  type LimitOrderFill,
  MAX_TICK,
  MIN_TICK,
  type PoolObservation,
  type PositionObservation,
  type RebalanceAction,
  type RebalanceConfig,
  type SkipCode,
  wrappingDelta,
} from "./strategy.js";
export {
  exactInputAmount,
  exactOutputAmount,
  isNativeCurrency,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  POOL_MODIFY_LIQUIDITY_TEST,
  POOL_SWAP_TEST,
  POOL_SWAP_TEST_ABI,
  planExactInputSwap,
  swapNode,
  swapPriceLimit,
  type V4SwapPlan,
} from "./swap.js";
export {
  decodeSwapLog,
  findAllSwapLogs,
  findPoolSwapLog,
  isSwapLog,
  type MinimalLog,
  SWAP_EVENT_TOPIC,
  type SwapEvent,
  type SwapReceiptVerification,
  type VerdictCode,
  verifySwapReceipt,
} from "./verify.js";
export {
  buildFeeGrowthWorkflow,
  buildPositionDriftWorkflow,
  buildSwapEventWorkflow,
  buildTickCrossWorkflow,
  jsonAbiFragment,
  jsonEventAbi,
  type TriggerSpec,
  writeNode,
} from "./workflows.js";
