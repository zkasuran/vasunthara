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
