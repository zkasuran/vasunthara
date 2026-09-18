// Vasunthara - read the pool, rule the hook.
// The deterministic read layer for automating Uniswap V4 hook strategies.

export {
  POSITION_MANAGER_ABI,
  QUOTER_ABI,
  STATE_VIEW_ABI,
} from "./abis.js";
export {
  type ChainId,
  DEPLOYMENTS,
  getDeployment,
  SUPPORTED_CHAINS,
  type V4Deployment,
} from "./deployments.js";
export {
  DYNAMIC_FEE_FLAG,
  derivePoolId,
  hasHook,
  isDynamicFee,
  type PoolKey,
} from "./pool-id.js";
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
