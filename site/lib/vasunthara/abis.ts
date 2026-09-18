// GENERATED FILE. Do not edit.
//
// Copied verbatim from src/abis.ts by scripts/sync-site-lib.mjs.
// Change the original and run `npm run sync:site` from the repository root.
// `npm run check:site` fails when this copy drifts from src/.
//
// This exists because Vercel builds the site with site/ as its root directory
// and cannot reach src/ without a project setting a fresh clone would lack.

// Uniswap V4 lens ABIs, matching the deployed bytecode. Verified live over
// public RPC on 2026-09-18: getSlot0 selector 0xc815641c,
// getPoolAndPositionInfo 0x7ba03aad, quoteExactInputSingle 0xaa9d21cb,
// getFeeGrowthInside 0x53e9c1fb, getPositionInfo 0x97fd7b42.
//
// StateView, PositionManager and V4Quoter are the read/quote surface. Writes
// (swap, modifyLiquidity) go through the PoolManager unlock callback or the
// Universal Router with an encoded action plan, a separate calldata surface.

export const STATE_VIEW_ABI = [
  "function poolManager() view returns (address)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  "function getFeeGrowthGlobals(bytes32 poolId) view returns (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1)",
  "function getTickLiquidity(bytes32 poolId, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)",
  "function getPositionInfo(bytes32 poolId, bytes32 positionId) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)",
] as const;

export const POSITION_MANAGER_ABI = [
  "function poolManager() view returns (address)",
  "function nextTokenId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address owner)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 info)",
] as const;

// The Quoter functions are nonpayable in v4-periphery (revert-as-return
// simulation) but every client invokes them via eth_call, so they are treated
// as reads here.
export const QUOTER_ABI = [
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountIn, uint256 gasEstimate)",
] as const;

// The PoolManager events, from Uniswap/v4-core IPoolManager.sol. `PoolId` is a
// user-defined value type over bytes32, so it appears as bytes32 in the ABI.
//
// These are what an event-driven strategy subscribes to. Because `id` is the
// first indexed parameter, a log filter on topic1 narrows to a single pool,
// hook included.
//
// Verified live on Ethereum Sepolia 2026-09-18: the Swap topic0 computed from
// this signature is
// 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f and it
// matches real PoolManager Swap logs at block 11530713 and later.
export const POOL_MANAGER_EVENTS_ABI = [
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
] as const;
