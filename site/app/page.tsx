import { Reveal } from "./reveal";

const REPO = "https://github.com/zkasuran/vasunthara";

const CONTRACTS = [
  {
    icon: "\u25CE",
    name: "StateView",
    desc: "Read price, tick, liquidity and fee growth for any pool by its poolId. The monitoring primitive a limit order or rebalance gates on.",
    reads: ["getSlot0", "getLiquidity", "getFeeGrowthGlobals", "getTickLiquidity"],
  },
  {
    icon: "\u25C8",
    name: "PositionManager",
    desc: "Read a position's liquidity and the full PoolKey it belongs to, including its hook. Know which hooked pool a position sits in before rebalancing.",
    reads: ["getPoolAndPositionInfo", "getPositionLiquidity", "ownerOf", "nextTokenId"],
  },
  {
    icon: "\u25C9",
    name: "V4Quoter",
    desc: "Simulate a swap through a specific hooked pool. hookData is forwarded to the hook exactly as an on-chain swap would, so the quote is real.",
    reads: ["quoteExactInputSingle", "quoteExactOutputSingle"],
  },
];

const CHAINS = [
  { name: "Ethereum", id: 1 },
  { name: "Base", id: 8453 },
  { name: "Arbitrum One", id: 42161 },
  { name: "Optimism", id: 10 },
  { name: "Polygon", id: 137 },
  { name: "Unichain", id: 130 },
  { name: "Ethereum Sepolia", id: 11155111 },
];

const STATS = [
  { n: "7", l: "chains supported" },
  { n: "3", l: "V4 lens contracts" },
  { n: "12", l: "tests passing" },
  { n: "0", l: "gas to read" },
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
            <a href="#why">Why</a>
            <a href="#reads">What it reads</a>
            <a href="#usage">Usage</a>
            <a href="#chains">Chains</a>
            <a href={REPO}>GitHub</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="wrap hero">
        <span className="eyebrow">Uniswap V4 Hook Automation Router</span>
        <h1>Vasunthara</h1>
        <div className="tagline">Read the pool. Rule the hook.</div>
        <p className="lede">
          The deterministic read layer for automating Uniswap V4 hook
          strategies. Read live pool state, position state and hook-aware quotes
          by <code>poolId</code>, across every chain V4 is deployed on.
        </p>
        <div className="hero-cta">
          <a className="btn btn-primary" href="#usage">
            See how it works &nbsp;&rarr;
          </a>
          <a className="btn btn-ghost" href={REPO}>
            View on GitHub
          </a>
        </div>

        {/* poolId flow */}
        <div className="flow">
          <div className="flow-key">
            <div className="row">
              <span>currency0</span> <b>ETH</b>
            </div>
            <div className="row">
              <span>currency1</span> <b>USDC</b>
            </div>
            <div className="row">
              <span>fee</span> <b>500</b>
            </div>
            <div className="row">
              <span>tickSpacing</span> <b>10</b>
            </div>
            <div className="row hooks">
              <span>hooks</span> <b>0x00…</b>
            </div>
          </div>
          <div className="flow-arrow">&rarr;</div>
          <div className="flow-id">
            keccak256(abi.encode(PoolKey))
            <br />
            0x21c67e77…a82ca27
          </div>
        </div>

        <div className="chips">
          <span className="chip">
            <b>StateView</b> pool monitoring
          </span>
          <span className="chip">
            <b>PositionManager</b> hook-aware positions
          </span>
          <span className="chip">
            <b>V4Quoter</b> hooked quotes
          </span>
          <span className="chip">
            reads only &middot; <b>no gas</b>
          </span>
        </div>
      </header>

      {/* Why */}
      <section id="why" className="wrap">
        <div className="reveal">
          <span className="eyebrow">The insight</span>
          <h2 className="section-title">Automating V4 is a read problem first</h2>
          <p className="section-sub">
            V4 moves pool logic into hooks and identifies a pool by a{" "}
            <code>poolId</code>, the hash of its <code>PoolKey</code>. The hook
            address is part of that key, so a hooked pool and the same pair with
            no hook are two different pools. Before a strategy can fire a limit
            order, rebalance a position or compound fees, it has to read live
            pool and position state keyed by that <code>poolId</code>, including
            which hook a position sits behind. That is what Vasunthara does.
          </p>
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

      {/* What it reads */}
      <section id="reads" className="wrap">
        <div className="reveal">
          <span className="eyebrow">Three lens contracts</span>
          <h2 className="section-title">What it reads</h2>
          <p className="section-sub">
            Reads only, over the canonical V4 lens contracts. No signer, no gas,
            no writes.
          </p>
        </div>
        <div className="cards reveal">
          {CONTRACTS.map((c) => (
            <div className="card" key={c.name}>
              <span className="badge">{c.icon}</span>
              <h3>{c.name}</h3>
              <p>{c.desc}</p>
              <ul>
                {c.reads.map((r) => (
                  <li key={r}>{r}()</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Usage */}
      <section id="usage" className="wrap">
        <div className="reveal">
          <span className="eyebrow">Usage</span>
          <h2 className="section-title">Four calls, one strategy</h2>
          <p className="section-sub">
            Install <code>vasunthara</code> with <code>ethers</code> v6, then
            derive a poolId, monitor the pool, inspect the position, and price
            the fill against the exact hooked pool.
          </p>
        </div>
        <div className="code reveal">
          <div className="code-head">
            <span className="code-dot r" />
            <span className="code-dot y" />
            <span className="code-dot g" />
            <span className="code-file">limit-order.ts</span>
          </div>
          <pre>
            <code>
              {`import { JsonRpcProvider } from "ethers";
import { VasuntharaReader, derivePoolId } from "vasunthara";

const provider = new JsonRpcProvider("https://ethereum-rpc.publicnode.com");
const reader = new VasuntharaReader(provider, 1); // Ethereum

// 1. Derive a poolId (the hook is part of the identity)
const poolId = derivePoolId({
  currency0: "0x0000000000000000000000000000000000000000", // ETH
  currency1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  fee: 500, tickSpacing: 10,
  hooks: "0x0000000000000000000000000000000000000000",
});

// 2. Monitor the pool -> gate on the tick
const { tick } = await reader.getSlot0(poolId);

// 3. Inspect a position and its hook -> rebalance / compound
const pos = await reader.getPoolAndPositionInfo(408000n);
// pos.poolKey.hooks, pos.hasHook, pos.dynamicFee

// 4. Price a fill through the hooked pool
const quote = await reader.quoteExactInputSingle(
  poolKey, true, 10n ** 18n, "0x", // hookData -> hook
);`}
            </code>
          </pre>
        </div>
      </section>

      {/* Proof */}
      <section className="wrap">
        <div className="reveal">
          <span className="eyebrow">Live proof</span>
          <h2 className="section-title">Verified against real, hooked pools</h2>
          <p className="section-sub">
            <code>npm run proof</code> reads real V4 state over public RPC. Every
            figure below is live mainnet chain state, captured 2026-09-18.
          </p>
        </div>
        <div className="proof reveal">
          <div>
            <span className="mut">StateView.poolManager()</span> &rarr;{" "}
            0x000000000004444c5dc75cB358380D2e3dE08A90{" "}
            <span className="ok">[match]</span>
          </div>
          <div>
            <span className="mut">getSlot0(ETH/USDC 0.05%)</span> &rarr; tick{" "}
            <span className="hl">-198070</span>, lpFee 500
          </div>
          <div>
            <span className="mut">quoteExactInputSingle(1 ETH &rarr; USDC)</span>{" "}
            &rarr; <span className="hl">~2500 USDC</span>, gasEstimate 64111
          </div>
          <div>
            <span className="mut">position #408579</span> &rarr; hook{" "}
            <span className="hl">0xbf98…BEC4</span>, dynamic-fee, liquidity
            289602464346483
          </div>
          <div>
            <span className="mut">position #408571</span> &rarr; hook{" "}
            <span className="hl">0x0000113d…fcC0</span>, dynamic-fee,
            liquidity 129333415568258
          </div>
        </div>
      </section>

      {/* Chains */}
      <section id="chains" className="wrap">
        <div className="reveal">
          <span className="eyebrow">Multi-chain</span>
          <h2 className="section-title">Everywhere V4 lives</h2>
          <p className="section-sub">
            V4 does not reuse one address across chains, so Vasunthara ships each
            lens address explicitly, verified against the Uniswap deployments
            page.
          </p>
        </div>
        <div className="chains reveal">
          {CHAINS.map((c) => (
            <div className="chain-pill" key={c.id}>
              <span className="dot" style={{ width: 10, height: 10 }} />
              {c.name} <span className="id">#{c.id}</span>
            </div>
          ))}
        </div>
      </section>

      {/* KeeperHub */}
      <section className="wrap">
        <div className="cta reveal">
          <span className="eyebrow">No-code, too</span>
          <h2>Also a KeeperHub plugin</h2>
          <p>
            The same read layer ships as a KeeperHub ABI-driven protocol plugin,
            so these reads become drag-and-drop workflow actions in a visual
            builder. Three contracts, thirteen actions.
          </p>
          <div className="hero-cta">
            <a className="btn btn-ghost" href={`${REPO}/tree/main/integrations/keeperhub`}>
              KeeperHub integration
            </a>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="wrap">
        <div className="cta reveal">
          <h2>Read the pool. Rule the hook.</h2>
          <p>The first deterministic execution layer for V4 hook strategies.</p>
          <div className="hero-cta">
            <a className="btn btn-primary" href={REPO}>
              Get started on GitHub &nbsp;&rarr;
            </a>
            <a
              className="btn btn-ghost"
              href={`${REPO}/blob/main/docs/PROOF.md`}
            >
              Read the live proof
            </a>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-inner">
          <div>
            <b>Vasunthara</b> &middot; Apache-2.0 &middot; Read the pool, rule the
            hook.
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <a href={REPO}>GitHub</a>
            <a href="https://docs.uniswap.org/contracts/v4/overview">Uniswap V4</a>
            <a href={`${REPO}/blob/main/docs/PROOF.md`}>Proof</a>
          </div>
        </div>
      </footer>
    </>
  );
}
