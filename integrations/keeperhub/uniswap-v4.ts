import { defineAbiProtocol } from "@/lib/protocol-registry";
import type { ProtocolTestData } from "@/lib/test-data/types";
import positionManagerAbi from "./abis/uniswap-v4-position-manager.json";
import quoterAbi from "./abis/uniswap-v4-quoter.json";
import stateViewAbi from "./abis/uniswap-v4-stateview.json";

// Uniswap V4 Hook Automation Router.
//
// V4 replaces V3's per-pool contracts with a single PoolManager holding all
// pools, and moves per-pool logic into hooks: contracts attached to a pool at
// deploy time that run before/after swap, add-liquidity and remove-liquidity.
// A pool is identified not by an address but by a poolId - the keccak256 of
// its PoolKey (currency0, currency1, fee, tickSpacing, hooks). The hooks
// address is part of that key, so a hooked pool and an otherwise-identical
// no-hook pool are two distinct pools with two distinct ids.
//
// That design means an automation layer for V4 hook strategies is a read
// layer first: to fire a limit order, rebalance an LP range or compound fees
// deterministically, a workflow must first read live pool state (price, tick,
// liquidity, fee growth) and live position state (liquidity, the pool a
// position belongs to) keyed by poolId / tokenId. This protocol exposes
// exactly those reads, plus the hook-aware Quoter, over the canonical V4
// lens contracts:
//
//   StateView       - price/tick/liquidity/fee-growth for a poolId. The
//                     monitoring primitive: gate a workflow on tick crossing a
//                     threshold (limit order), on liquidity draining (exit),
//                     or on fee growth (compound).
//   PositionManager - the ERC-721 that owns V4 liquidity. Read a position's
//                     liquidity and the PoolKey it belongs to, so a rebalance
//                     or compound workflow knows what it is acting on.
//   V4Quoter        - simulate a swap through a specific pool INCLUDING its
//                     hook (hookData is a first-class input), so a limit-order
//                     fill or rebalance swap can be priced against the exact
//                     hooked pool it will execute in.
//
// Read-only by design. V4 state-changing calls (swap, modifyLiquidity) are not
// made against these contracts directly: they go through the PoolManager's
// unlock callback or the Universal Router with an encoded action plan, which
// is a distinct calldata-encoding surface (see the Universal Router V4 swap
// encoder in plugins/robinhood/steps/v4-swap-encoding.ts for the shape). The
// reads here are what an automation strategy is built on, and they are the
// part that must be correct first. protocols/coinbase-cbeth.ts and
// protocols/pyth.ts are the read-only precedents.
//
// poolId derivation: a workflow computes poolId = keccak256(abi.encode(
// currency0, currency1, fee, tickSpacing, hooks)) with the data plugin's
// encode + hash steps, then feeds it to the StateView reads below. The
// no-hook ETH/USDC 0.05% pool used in the tests derives to
// 0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27.
//
// Verified live over public RPC on 2026-09-18:
//   mainnet StateView.getSlot0(ETH/USDC 0.05%) -> sqrtPriceX96
//   3959048026709477221707753, tick -198092, lpFee 500; getLiquidity ->
//   1047885409136324697. mainnet PositionManager.nextTokenId() -> 408575,
//   getPoolAndPositionInfo(408000) decodes to a real PoolKey. mainnet
//   V4Quoter.quoteExactInputSingle(1 ETH -> USDC, selector 0xaa9d21cb) ->
//   a live USDC amountOut around 2497-2504 as the pool price moves,
//   gasEstimate ~41734. Sepolia StateView.poolManager() ->
//   0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 (matches the deployment table).

const V4_DOCS = "https://docs.uniswap.org/contracts/v4/overview";
const STATE_VIEW_DOCS =
  "https://docs.uniswap.org/contracts/v4/reference/periphery/lens/StateView";
const POSM_DOCS =
  "https://docs.uniswap.org/contracts/v4/reference/periphery/PositionManager";
const QUOTER_DOCS =
  "https://docs.uniswap.org/contracts/v4/reference/periphery/lens/V4Quoter";

const POOL_ID_TIP =
  "V4 pool identifier: keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). Compute it once from the pool's PoolKey (the Data plugin's ABI Encode + Hash steps do this) and reuse it across reads. The hooks address is part of the key, so a hooked pool has a different id than the same pair with no hook.";

const TOKEN_ID_TIP =
  "The ERC-721 token id of a V4 liquidity position, minted by the PositionManager. Each position is one NFT; its id is emitted in the mint transaction and is the handle for reading or modifying that position.";

// The ETH/USDC 0.05% no-hook pool on mainnet, verified live 2026-09-18. A
// long-lived, deep pool, so getSlot0/getLiquidity return nonzero chain
// invariants the coverage runner can assert without provisioning anything.
const MAINNET_ETH_USDC_POOL_ID =
  "0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27";

// A live mainnet position id below nextTokenId (408575 on 2026-09-18), owned
// and carrying a real PoolKey. Position reads are ownership- and
// history-independent, so this is a stable read target.
const MAINNET_POSITION_ID = "408000";

const TEST_DATA: ProtocolTestData = {
  "1": {
    setup: {
      minNativeHuman: "0",
      requiredTokens: [],
      approvals: [],
    },
    actions: {
      "get-slot0": { poolId: MAINNET_ETH_USDC_POOL_ID },
      "get-liquidity": { poolId: MAINNET_ETH_USDC_POOL_ID },
      "get-fee-growth-globals": { poolId: MAINNET_ETH_USDC_POOL_ID },
      "get-tick-liquidity": {
        poolId: MAINNET_ETH_USDC_POOL_ID,
        tick: "-198100",
      },
      "get-position-info": {
        poolId: MAINNET_ETH_USDC_POOL_ID,
        positionId: MAINNET_ETH_USDC_POOL_ID,
      },
      "sv-pool-manager": {},
      "get-position-liquidity": { tokenId: MAINNET_POSITION_ID },
      "get-pool-and-position-info": { tokenId: MAINNET_POSITION_ID },
      "position-owner-of": { tokenId: MAINNET_POSITION_ID },
      "next-token-id": {},
      "pm-pool-manager": {},
    },
    // The two Quoter actions take a nested PoolKey struct input. The coverage
    // builder binds scalar and flattened-tuple inputs but has no path for a
    // struct value nested inside a flattened tuple, so they are skipped here.
    // Both are live and correct through the UI and the read step: verified
    // over eth_call 2026-09-18, quoteExactInputSingle(1 ETH -> USDC on the
    // no-hook 0.05% pool, selector 0xaa9d21cb) returned a live USDC amountOut
    // (around 2497-2504 as the pool price moves). The unit test in
    // tests/unit/protocol-uniswap-v4.test.ts pins the Quoter ABI and its
    // hook-aware input shape instead.
    skipped: {
      "quote-exact-input":
        "Quoter input is a nested PoolKey struct; the coverage builder binds scalars and flattened tuples only. Verified live via eth_call and pinned by the unit test.",
      "quote-exact-output":
        "Quoter input is a nested PoolKey struct; the coverage builder binds scalars and flattened tuples only. Verified live via eth_call and pinned by the unit test.",
    },
    // Chain invariants on the deep ETH/USDC 0.05% pool: a live pool has a
    // nonzero sqrt price and nonzero liquidity, and nextTokenId is six figures.
    // A zero here means the read decoded garbage. No expectation on
    // get-position-info (a pool-level positionId returns empty) or the
    // Quoter (amountOut moves with price), which are liveness-only.
    expectations: {
      "get-slot0": [{ field: "sqrtPriceX96", nonZero: true }],
      "get-liquidity": [{ field: "liquidity", nonZero: true }],
      "next-token-id": [{ nonZero: true }],
      "get-position-liquidity": [{ nonZero: true }],
    },
  },
};

// StateView, PositionManager and V4Quoter addresses per chain, from
// docs.uniswap.org/contracts/v4/deployments. V4 does not use one address
// across chains, so each is listed explicitly.
const STATE_VIEW_ADDRESSES = {
  "1": "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  "8453": "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
  "42161": "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
  "10": "0xc18a3169788f4f75a170290584eca6395c75ecdb",
  "137": "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a",
  "130": "0x86e8631a016f9068c3f085faf484ee3f5fdee8f2",
  "11155111": "0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c",
};

const POSITION_MANAGER_ADDRESSES = {
  "1": "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
  "8453": "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
  "42161": "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
  "10": "0x3c3ea4b57a46241e54610e5f022e5c45859a1017",
  "137": "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9",
  "130": "0x4529a01c7a0410167c5740c487a8de60232617bf",
  "11155111": "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
};

const QUOTER_ADDRESSES = {
  "1": "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
  "8453": "0x0d5e0f971ed27fbff6c2837bf31316121532048d",
  "42161": "0x3972c00f7ed4885e145823eb7c655375d275a1c5",
  "10": "0x1f3131a13296fb91c90870043742c3cdbff1a8d7",
  "137": "0xb3d5c3dfc3a7aebff71895a7191796bffc2c81b9",
  "130": "0x333e3c607b141b18ff6de9f258db6e77fe7491e0",
  "11155111": "0x61b3f2011a92d183c7dbadbda940a7555ccf9227",
};

// The Quoter functions are `nonpayable` in v4-periphery (they use the
// revert-as-return idiom: the swap is simulated inside the PoolManager unlock
// and the amounts are thrown back as revert data), but every client invokes
// them through eth_call. Marking them `view` in the ABI above classifies these
// actions as reads (no credentials, no gas, no transaction), the same
// deliberate divergence protocols/uniswap-v3.ts makes for its QuoterV2. See
// that file's note for the rationale.

export default defineAbiProtocol({
  name: "Uniswap V4",
  slug: "uniswap-v4",
  testData: TEST_DATA,
  description:
    "Uniswap V4 hook automation router - read pool state (price, tick, liquidity, fee growth) by poolId, read liquidity positions, and get hook-aware swap quotes. The deterministic read layer for automating V4 hook strategies: limit orders, LP rebalancing and fee compounding.",
  website: "https://uniswap.org",
  icon: "/protocols/uniswap.png",

  contracts: {
    stateView: {
      label: "Uniswap V4 StateView",
      abi: JSON.stringify(stateViewAbi),
      addresses: STATE_VIEW_ADDRESSES,
      overrides: {
        getSlot0: {
          slug: "get-slot0",
          label: "Get Pool State (Slot0)",
          description:
            "Read a V4 pool's current price, tick and fee from its poolId. The core monitoring read: gate a limit-order or rebalance workflow on the tick crossing a threshold.",
          docUrl: STATE_VIEW_DOCS,
          inputs: {
            poolId: {
              label: "Pool ID",
              helpTip: POOL_ID_TIP,
              docUrl: V4_DOCS,
            },
          },
          outputs: {
            sqrtPriceX96: { label: "Sqrt Price (X96)" },
            tick: { label: "Current Tick" },
            protocolFee: { label: "Protocol Fee" },
            lpFee: { label: "LP Fee" },
          },
        },
        getLiquidity: {
          slug: "get-liquidity",
          label: "Get Pool Liquidity",
          description:
            "Read the total in-range liquidity of a V4 pool by poolId. Watch for liquidity draining to trigger an exit or rebalance.",
          docUrl: STATE_VIEW_DOCS,
          inputs: {
            poolId: { label: "Pool ID", helpTip: POOL_ID_TIP, docUrl: V4_DOCS },
          },
          outputs: {
            liquidity: { label: "Total Liquidity" },
          },
        },
        getFeeGrowthGlobals: {
          slug: "get-fee-growth-globals",
          label: "Get Fee Growth Globals",
          description:
            "Read a V4 pool's global fee growth accumulators for both currencies. Rising fee growth is the signal to compound accrued fees.",
          docUrl: STATE_VIEW_DOCS,
          inputs: {
            poolId: { label: "Pool ID", helpTip: POOL_ID_TIP, docUrl: V4_DOCS },
          },
          outputs: {
            feeGrowthGlobal0: { label: "Fee Growth Global 0 (X128)" },
            feeGrowthGlobal1: { label: "Fee Growth Global 1 (X128)" },
          },
        },
        getTickLiquidity: {
          slug: "get-tick-liquidity",
          label: "Get Tick Liquidity",
          description:
            "Read the gross and net liquidity at a specific tick in a V4 pool. Used to size a rebalance range or detect a liquidity wall.",
          docUrl: STATE_VIEW_DOCS,
          inputs: {
            poolId: { label: "Pool ID", helpTip: POOL_ID_TIP, docUrl: V4_DOCS },
            tick: {
              label: "Tick",
              helpTip:
                "The tick index to read liquidity at. Must be a multiple of the pool's tickSpacing.",
            },
          },
          outputs: {
            liquidityGross: { label: "Liquidity Gross" },
            liquidityNet: { label: "Liquidity Net" },
          },
        },
        getPositionInfo: {
          slug: "get-position-info",
          label: "Get Pool Position Info",
          description:
            "Read a position's liquidity and fee-growth-inside snapshot within a pool, keyed by poolId and the position key (owner, tickLower, tickUpper, salt hashed). Use it to compute uncollected fees for a compound decision.",
          docUrl: STATE_VIEW_DOCS,
          inputs: {
            poolId: { label: "Pool ID", helpTip: POOL_ID_TIP, docUrl: V4_DOCS },
            positionId: {
              label: "Position Key",
              helpTip:
                "keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt)) - the pool-internal position key, distinct from the PositionManager NFT token id.",
            },
          },
          outputs: {
            liquidity: { label: "Liquidity" },
            feeGrowthInside0LastX128: { label: "Fee Growth Inside 0 (X128)" },
            feeGrowthInside1LastX128: { label: "Fee Growth Inside 1 (X128)" },
          },
        },
        poolManager: {
          slug: "sv-pool-manager",
          label: "Get PoolManager (via StateView)",
          description:
            "Read the singleton PoolManager address this StateView reads from. Confirms the lens is wired to the canonical V4 core on this chain.",
          docUrl: STATE_VIEW_DOCS,
          outputs: {
            result: { name: "poolManager", label: "PoolManager Address" },
          },
        },
      },
    },
    positionManager: {
      label: "Uniswap V4 PositionManager",
      abi: JSON.stringify(positionManagerAbi),
      addresses: POSITION_MANAGER_ADDRESSES,
      overrides: {
        getPositionLiquidity: {
          slug: "get-position-liquidity",
          label: "Get Position Liquidity",
          description:
            "Read the liquidity of a V4 liquidity position by its NFT token id. The value a rebalance or exit workflow acts on.",
          docUrl: POSM_DOCS,
          inputs: {
            tokenId: {
              label: "Position Token ID",
              helpTip: TOKEN_ID_TIP,
              docUrl: V4_DOCS,
            },
          },
          outputs: {
            liquidity: { label: "Position Liquidity" },
          },
        },
        getPoolAndPositionInfo: {
          slug: "get-pool-and-position-info",
          label: "Get Pool and Position Info",
          description:
            "Read the PoolKey a position belongs to (including its hooks address) plus the packed position info word, by NFT token id. Tells a workflow which hooked pool and tick range a position sits in before it rebalances.",
          docUrl: POSM_DOCS,
          inputs: {
            tokenId: {
              label: "Position Token ID",
              helpTip: TOKEN_ID_TIP,
              docUrl: V4_DOCS,
            },
          },
          outputs: {
            poolKey: {
              label: "Pool Key (currency0, currency1, fee, tickSpacing, hooks)",
            },
            info: { label: "Packed Position Info" },
          },
        },
        ownerOf: {
          slug: "position-owner-of",
          label: "Get Position Owner",
          description:
            "Read the owner address of a V4 liquidity position NFT by token id.",
          docUrl: POSM_DOCS,
          inputs: {
            tokenId: {
              label: "Position Token ID",
              helpTip: TOKEN_ID_TIP,
              docUrl: V4_DOCS,
            },
          },
          outputs: {
            owner: { label: "Owner Address" },
          },
        },
        nextTokenId: {
          slug: "next-token-id",
          label: "Get Next Position Token ID",
          description:
            "Read the token id the next minted position will receive. Equals the count of positions ever minted plus one; a monotonically increasing chain invariant.",
          docUrl: POSM_DOCS,
          outputs: {
            result: { name: "nextTokenId", label: "Next Token ID" },
          },
        },
        poolManager: {
          slug: "pm-pool-manager",
          label: "Get PoolManager (via PositionManager)",
          description:
            "Read the singleton PoolManager address this PositionManager mints into.",
          docUrl: POSM_DOCS,
          outputs: {
            result: { name: "poolManager", label: "PoolManager Address" },
          },
        },
      },
    },
    quoter: {
      label: "Uniswap V4 Quoter",
      abi: JSON.stringify(quoterAbi),
      addresses: QUOTER_ADDRESSES,
      overrides: {
        quoteExactInputSingle: {
          slug: "quote-exact-input",
          label: "Quote Exact Input (Hook-Aware)",
          description:
            "Simulate a single-hop exact-input swap through a specific V4 pool, including its hook. The PoolKey (currency0, currency1, fee, tickSpacing, hooks) selects the exact pool, and hookData is forwarded to the hook exactly as an on-chain swap would, so the quote reflects the hooked pool a limit-order or rebalance swap will execute in.",
          docUrl: QUOTER_DOCS,
          inputs: {
            poolKey: {
              label: "Pool Key (currency0, currency1, fee, tickSpacing, hooks)",
              helpTip:
                "The pool to quote against. currency0 is the lower-sorted token (zero address for native ETH); fee is in hundredths of a bip (500 = 0.05%); hooks is the pool's hook contract or the zero address. The hook is part of the pool identity, so the quote is specific to this hooked pool.",
              docUrl: V4_DOCS,
            },
            zeroForOne: {
              label: "Zero For One",
              helpTip:
                "true swaps currency0 for currency1; false swaps currency1 for currency0.",
            },
            exactAmount: { label: "Exact Input Amount (wei)" },
            hookData: {
              label: "Hook Data",
              helpTip:
                "Arbitrary bytes forwarded to the pool's hook. 0x for pools with no hook or hooks that ignore it.",
              docUrl: V4_DOCS,
            },
          },
          outputs: {
            amountOut: { label: "Amount Out (wei)" },
            gasEstimate: { label: "Gas Estimate" },
          },
        },
        quoteExactOutputSingle: {
          slug: "quote-exact-output",
          label: "Quote Exact Output (Hook-Aware)",
          description:
            "Simulate a single-hop exact-output swap through a specific V4 pool, including its hook, to find the input required for a target output.",
          docUrl: QUOTER_DOCS,
          inputs: {
            poolKey: {
              label: "Pool Key (currency0, currency1, fee, tickSpacing, hooks)",
              helpTip:
                "The pool to quote against. currency0 is the lower-sorted token (zero address for native ETH); fee is in hundredths of a bip (500 = 0.05%); hooks is the pool's hook contract or the zero address.",
              docUrl: V4_DOCS,
            },
            zeroForOne: {
              label: "Zero For One",
              helpTip:
                "true swaps currency0 for currency1; false swaps currency1 for currency0.",
            },
            exactAmount: { label: "Exact Output Amount (wei)" },
            hookData: {
              label: "Hook Data",
              helpTip:
                "Arbitrary bytes forwarded to the pool's hook. 0x if none.",
              docUrl: V4_DOCS,
            },
          },
          outputs: {
            amountIn: { label: "Amount In (wei)" },
            gasEstimate: { label: "Gas Estimate" },
          },
        },
      },
    },
  },
});
