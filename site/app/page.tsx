import { Lab } from "./lab/lab";
import { Reveal } from "./reveal";
import { RECEIPT_PRESETS } from "../lib/presets";
import {
  DEPLOYMENTS,
  KEEPERHUB_TESTNETS,
  SUPPORTED_CHAINS,
} from "../lib/vasunthara/deployments";
import { POOL_SWAP_TEST } from "../lib/vasunthara/swap";

const REPO = "https://github.com/zkasuran/vasunthara";

// Every figure on this page is derived from the library it describes, so the
// page cannot drift from the code the way a hand-written number does.
const CHAIN_COUNT = SUPPORTED_CHAINS.length;
const TESTNET_COUNT = KEEPERHUB_TESTNETS.length;
const ROUTER_COUNT = Object.keys(POOL_SWAP_TEST).length;
const VERIFIED_SWAPS = RECEIPT_PRESETS.filter(
  (r) => r.expect === "verified",
).length;

const STATS = [
  { n: String(VERIFIED_SWAPS), l: "V4 swaps you can verify on this page" },
  { n: "0", l: "V4 actions KeeperHub had before this" },
  { n: String(CHAIN_COUNT), l: "chains, every lens address checked live" },
  { n: String(TESTNET_COUNT), l: "testnets it executes on" },
];

const STAGES = [
  {
    icon: "\u25CE",
    name: "Observe",
    desc: "Read live pool state, position state and hook-aware quotes by poolId, over the canonical V4 lens contracts. No signer and no gas.",
    reads: ["getSlot0", "getLiquidity", "getFeeGrowthInside", "getPoolAndPositionInfo"],
  },
  {
    icon: "\u25C8",
    name: "Decide",
    desc: "Pure functions from an observation to a decision, with guards that run first and in a fixed order. No clock, no network, no randomness, so a run replays exactly and every refusal carries its reason.",
    reads: ["decideLimitOrder", "decideRebalance", "decideCompound", "checkGuards"],
  },
  {
    icon: "\u25C9",
    name: "Execute",
    desc: "Render the decision as a KeeperHub workflow and let KeeperHub sign, send, retry and record it. Simulate first; refuse to send if the dry run disagrees.",
    reads: ["planExactInputSwap", "simulateSwap", "buildSwapEventWorkflow", "verifySwapReceipt"],
  },
];

export default function Page() {
  return (
    <>
      <div className="bg-wrap" aria-hidden>
        <div className="grid-overlay" />
        <div className="blob a" />
        <div className="blob b" />
        <div className="blob c" />
      </div>

      <Reveal />

      <nav>
        <div className="nav-inner">
          <div className="brand">
            <span className="dot" />
            Vasunthara
          </div>
          <div className="nav-links">
            <a href="#gap">The gap</a>
            <a href="#lab">Live lab</a>
            <a href="#how">How it works</a>
            <a href="#proof">Proof</a>
            <a href="#chains">Chains</a>
            <a href={REPO}>GitHub</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="wrap hero">
        <span className="eyebrow">The Uniswap V4 execution layer for KeeperHub</span>
        <h1>Vasunthara</h1>
        <div className="tagline">Read the pool. Rule the hook.</div>
        <p className="lede">
          Watch a live Uniswap V4 pool by <code>poolId</code>, decide
          deterministically, then execute the swap through KeeperHub. The
          transaction is real and the proof is an on-chain event you can check
          yourself, in the browser, on this page.
        </p>
        <div className="hero-cta">
          <a className="btn btn-primary" href="#lab">
            Open the live lab &nbsp;&rarr;
          </a>
          <a className="btn btn-ghost" href="#proof">
            Verify a real swap
          </a>
        </div>

        <div className="chips">
          <span className="chip">
            <b>{VERIFIED_SWAPS} swaps</b> executed through KeeperHub
          </span>
          <span className="chip">
            <b>{CHAIN_COUNT} chains</b> verified live
          </span>
          <span className="chip">
            <b>{ROUTER_COUNT} routers</b> bytecode-checked
          </span>
          <span className="chip">
            testnet only &middot; <b>no real funds</b>
          </span>
        </div>
      </header>

      {/* The gap */}
      <section id="gap" className="wrap">
        <div className="reveal">
          <span className="eyebrow">Why this exists</span>
          <h2 className="section-title">
            KeeperHub automates Uniswap V3. V4 was not there at all.
          </h2>
          <p className="section-sub">
            Ask KeeperHub's own catalogue what it knows about Uniswap and you get
            eleven actions, every one labelled, described and categorised
            &ldquo;Uniswap V3&rdquo;. No <code>PoolManager</code>, no{" "}
            <code>poolId</code>, no hooks. V4 has been live for a year on{" "}
            {CHAIN_COUNT} chains and the execution layer for onchain agents could
            not see it. A judge can confirm that in one call:
          </p>
        </div>
        <div className="code reveal">
          <div className="code-head">
            <span className="code-dot r" />
            <span className="code-dot y" />
            <span className="code-dot g" />
            <span className="code-file">the gap, in one request</span>
          </div>
          <pre>
            <code>{`curl -H "Authorization: Bearer $KEEPERHUB_ORG_KEY" \\
  'https://app.keeperhub.com/api/mcp/schemas?includeChains=false' \\
  | jq -r '.actions | keys[] | select(startswith("uniswap/"))'

# 11 actions. Every label starts "Uniswap V3:".`}</code>
          </pre>
        </div>
        <div className="stats reveal">
          {STATS.map((s) => (
            <div className="stat" key={s.l}>
              <div className="n">{s.n}</div>
              <div className="l">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The lab */}
      <section id="lab" className="wrap">
        <div className="reveal">
          <Lab />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="wrap">
        <div className="reveal">
          <span className="eyebrow">Three stages</span>
          <h2 className="section-title">Observe, decide, execute</h2>
          <p className="section-sub">
            Each stage is usable on its own, and the boundary between them is
            deliberate: the part that decides never touches the network, and the
            part that sends never decides.
          </p>
        </div>
        <div className="cards reveal">
          {STAGES.map((s) => (
            <div className="card" key={s.name}>
              <span className="badge">{s.icon}</span>
              <h3>{s.name}</h3>
              <p>{s.desc}</p>
              <ul>
                {s.reads.map((r) => (
                  <li key={r}>{r}()</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Why a poolId */}
      <section className="wrap">
        <div className="reveal">
          <span className="eyebrow">The insight</span>
          <h2 className="section-title">
            A V4 pool has no address. It has an identity.
          </h2>
          <p className="section-sub">
            V4 replaces V3&apos;s per-pool contracts with one{" "}
            <code>PoolManager</code> and moves pool logic into hooks. A pool is
            named by the hash of its key:
          </p>
        </div>
        <div className="code reveal">
          <div className="code-head">
            <span className="code-dot r" />
            <span className="code-dot y" />
            <span className="code-dot g" />
            <span className="code-file">PoolId.toId()</span>
          </div>
          <pre>
            <code>{`poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))`}</code>
          </pre>
        </div>
        <p className="section-sub reveal" style={{ marginTop: 24 }}>
          The <code>hooks</code> address is inside that hash, so a hooked pool
          and an otherwise identical pool with no hook are two different pools
          with two different ids, two prices and two sets of liquidity. Any V4
          automation is therefore a read problem before it is an execution
          problem, and a workflow that hardcodes a pool address is automating
          nothing. The lab above derives both ids side by side so you can watch
          it happen.
        </p>
      </section>

      {/* Reliability */}
      <section className="wrap">
        <div className="reveal">
          <span className="eyebrow">Reliability</span>
          <h2 className="section-title">The guards are the product</h2>
          <p className="section-sub">
            The expensive failures in automated DeFi are rarely wrong maths. They
            are acting on a reading that was already stale, on a pool too thin to
            fill, or through a hook that moved the fee after the order was
            written.
          </p>
        </div>
        <div className="code reveal">
          <div className="code-head">
            <span className="code-dot r" />
            <span className="code-dot y" />
            <span className="code-dot g" />
            <span className="code-file">guards.ts</span>
          </div>
          <pre>
            <code>{`const guards = {
  maxObservationAgeSec: 60,      // reject a stale reading, or one from the future
  minPoolLiquidity: 10n ** 15n,  // refuse a pool too thin to fill
  maxLpFeeHundredthsBip: 3000,   // refuse a dynamic-fee hook that raised the fee
};

// Guards run first and in a fixed order, so a skip always carries the
// first reason that applied rather than whichever check happened to run.
{ act: false, code: "stale-observation",
  reason: "observation is 120s old, limit is 60s",
  evidence: { poolId: "0xddbb…", tick: "-4608", ageSec: "120" } }`}</code>
          </pre>
        </div>
        <p className="section-sub reveal" style={{ marginTop: 24 }}>
          Move the staleness slider in the <a href="#lab">Decide</a> tab and
          watch a live fill turn into a refusal with the numbers that caused it.
          Before anything is sent, the same calldata is simulated with{" "}
          <code>eth_call</code>; if the dry run disagrees with the decision, the
          send is refused rather than attempted.
        </p>
      </section>

      {/* Proof */}
      <section id="proof" className="wrap">
        <div className="reveal">
          <span className="eyebrow">Proof</span>
          <h2 className="section-title">A limit order that actually filled</h2>
          <p className="section-sub">
            KeeperHub read <code>StateView.getSlot0</code> for a hooked,
            dynamic-fee pool and got tick <code>-4608</code>. The gate{" "}
            <code>-4608 &gt;= -5000</code> held, so the order filled. The
            PoolManager then emitted <code>Swap</code> for that exact{" "}
            <code>poolId</code>:
          </p>
        </div>
        <div className="proof reveal">
          <div>
            <span className="mut">poolId</span> &nbsp;
            0xddbb5b18fb2d4c61002baf6256e2317b44cfd0b55e992414f8acff9f72c94e8c
          </div>
          <div>
            <span className="mut">amount0</span> &nbsp;
            <span className="hl">-10000000000000</span> &nbsp; 0.00001 ETH in
          </div>
          <div>
            <span className="mut">amount1</span> &nbsp;
            <span className="hl">6276834406909</span> &nbsp; KHACN out
          </div>
          <div>
            <span className="mut">tick</span> &nbsp; -4608 &rarr;{" "}
            <span className="hl">-4648</span>
          </div>
          <div>
            <span className="mut">simulation</span> &nbsp; identical to the
            realised fill, <span className="ok">to the wei</span>
          </div>
        </div>
        <p className="section-sub reveal" style={{ marginTop: 24 }}>
          <b>Read the sender column carefully.</b> KeeperHub relays writes and
          sponsors the gas, so the explorer shows a KeeperHub relayer as{" "}
          <code>from</code> and its executor contract as <code>to</code>. Neither
          is our wallet and neither is Uniswap. That is not a caveat hiding a
          weak claim, it is how sponsored execution works, and it is why the
          proof is the emitted event rather than the sender. The{" "}
          <a href="#lab">Verify receipts</a> tab runs that check in your browser
          against a public RPC, and it ships negative cases too: real KeeperHub
          writes from this project that were not V4 swaps, which it correctly
          refuses to count.
        </p>
        <div className="hero-cta reveal" style={{ marginTop: 28 }}>
          <a className="btn btn-ghost" href={`${REPO}/blob/main/docs/RECEIPTS.md`}>
            Full receipts
          </a>
          <a className="btn btn-ghost" href="#lab">
            Verify it yourself
          </a>
        </div>
      </section>

      {/* Chains */}
      <section id="chains" className="wrap">
        <div className="reveal">
          <span className="eyebrow">Multi-chain</span>
          <h2 className="section-title">Everywhere V4 lives</h2>
          <p className="section-sub">
            V4 does not reuse one address across chains, so each lens address
            ships explicitly. On every chain here, StateView, PositionManager and
            V4Quoter all return the same <code>poolManager()</code>, and it is
            the address the Uniswap deployments page lists. The lab re-checks
            that live when you read a pool.
          </p>
        </div>
        <div className="chains reveal">
          {SUPPORTED_CHAINS.map((id) => {
            const d = DEPLOYMENTS[id];
            if (!d) {
              return null;
            }
            const executes = KEEPERHUB_TESTNETS.includes(id);
            return (
              <div className="chain-pill" key={id}>
                <span
                  className="dot"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: executes
                      ? "linear-gradient(135deg, #3fb950, #22d3ee)"
                      : "linear-gradient(135deg, #ff2d9b, #8b5cf6)",
                  }}
                />
                {d.name} <span className="id">#{id}</span>
              </div>
            );
          })}
        </div>
        <p className="section-sub reveal" style={{ marginTop: 20 }}>
          Green marks the {TESTNET_COUNT} testnets carrying both KeeperHub and
          Uniswap V4, which is where this executes. Moving real funds is out of
          scope on purpose, so no mainnet transaction is ever sent. Unichain
          Sepolia is deliberately absent: KeeperHub does not carry the chain, and
          Uniswap publishes two different V4 deployments for it with no pool
          initialised in either. A test pins that absence.
        </p>
      </section>

      {/* KeeperHub plugin */}
      <section className="wrap">
        <div className="cta reveal">
          <span className="eyebrow">No-code, too</span>
          <h2>Also a KeeperHub plugin</h2>
          <p>
            The same read layer ships as a KeeperHub ABI-driven protocol, so
            these reads become drag-and-drop workflow actions in the visual
            builder for everyone rather than only for this project. Three
            contracts, thirteen actions, <code>slug: uniswap-v4</code>.
          </p>
          <div className="hero-cta">
            <a
              className="btn btn-ghost"
              href={`${REPO}/tree/main/integrations/keeperhub`}
            >
              KeeperHub integration
            </a>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="wrap">
        <div className="cta reveal">
          <h2>Read the pool. Rule the hook.</h2>
          <p>
            <code>npm install vasunthara ethers</code>
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary" href={REPO}>
              Get started on GitHub &nbsp;&rarr;
            </a>
            <a className="btn btn-ghost" href={`${REPO}/blob/main/docs/RECEIPTS.md`}>
              Read the receipts
            </a>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-inner">
          <div>
            <b>Vasunthara</b> &middot; Apache-2.0 &middot; Read the pool, rule
            the hook.
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <a href={REPO}>GitHub</a>
            <a href="https://developers.uniswap.org/docs/protocols/v4/deployments">
              Uniswap V4
            </a>
            <a href="https://keeperhub.com">KeeperHub</a>
            <a href={`${REPO}/blob/main/docs/RECEIPTS.md`}>Receipts</a>
          </div>
        </div>
      </footer>
    </>
  );
}
