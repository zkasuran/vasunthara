// Uniswap V4 lens deployment addresses, from
// docs.uniswap.org/contracts/v4/deployments. V4 does NOT reuse one address
// across chains, so each is listed explicitly. Verified against the
// deployments page on 2026-09-18; StateView.poolManager() was called live on
// Ethereum, Base and Sepolia and returns the canonical PoolManager per chain.

export type ChainId = number;

export type V4Deployment = {
  readonly chainId: ChainId;
  readonly name: string;
  readonly poolManager: string;
  readonly stateView: string;
  readonly positionManager: string;
  readonly quoter: string;
  /** A public RPC with no key, used by the proof CLI. */
  readonly rpcUrl: string;
  /** Block explorer base for addresses. */
  readonly explorer: string;
};

export const DEPLOYMENTS: Readonly<Record<ChainId, V4Deployment>> = {
  1: {
    chainId: 1,
    name: "Ethereum",
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    stateView: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
    positionManager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    quoter: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io/address/",
  },
  8453: {
    chainId: 8453,
    name: "Base",
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    stateView: "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71",
    positionManager: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
    quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
    rpcUrl: "https://base-rpc.publicnode.com",
    explorer: "https://basescan.org/address/",
  },
  42161: {
    chainId: 42161,
    name: "Arbitrum One",
    poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
    stateView: "0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990",
    positionManager: "0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869",
    quoter: "0x3972C00f7ed4885e145823eb7C655375d275A1C5",
    rpcUrl: "https://arbitrum-one-rpc.publicnode.com",
    explorer: "https://arbiscan.io/address/",
  },
  10: {
    chainId: 10,
    name: "Optimism",
    poolManager: "0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3",
    stateView: "0xc18a3169788F4F75A170290584ECA6395C75Ecdb",
    positionManager: "0x3C3Ea4B57a46241e54610e5f022E5c45859A1017",
    quoter: "0x1f3131A13296FB91C90870043742C3CDBFF1A8d7",
    rpcUrl: "https://optimism-rpc.publicnode.com",
    explorer: "https://optimistic.etherscan.io/address/",
  },
  137: {
    chainId: 137,
    name: "Polygon",
    poolManager: "0x67366782805870060151383F4BbFF9daB53e5cD6",
    stateView: "0x5eA1bD7974c8A611cBAB0bDCAFcB1D9CC9b3BA5a",
    positionManager: "0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9",
    quoter: "0xb3d5c3Dfc3a7aEbFF71895A7191796BFFc2c81b9",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    explorer: "https://polygonscan.com/address/",
  },
  130: {
    chainId: 130,
    name: "Unichain",
    poolManager: "0x1F98400000000000000000000000000000000004",
    stateView: "0x86e8631A016F9068C3f085fAF484Ee3F5fDee8f2",
    positionManager: "0x4529A01c7A0410167c5740C487A8DE60232617bf",
    quoter: "0x333E3C607B141b18fF6de9f258db6e77fE7491E0",
    rpcUrl: "https://unichain-rpc.publicnode.com",
    explorer: "https://uniscan.xyz/address/",
  },
  11155111: {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    stateView: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
    positionManager: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
    quoter: "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io/address/",
  },
} as const;

export const SUPPORTED_CHAINS: readonly ChainId[] =
  Object.keys(DEPLOYMENTS).map(Number);

export function getDeployment(chainId: ChainId): V4Deployment {
  const d = DEPLOYMENTS[chainId];
  if (!d) {
    throw new Error(
      `Uniswap V4 is not configured for chain ${chainId}. Supported: ${SUPPORTED_CHAINS.join(", ")}`,
    );
  }
  return d;
}
