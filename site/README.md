# Vasunthara live lab

The web app for [Vasunthara](../). Not a brochure: it runs the library itself in
the browser against public JSON-RPC endpoints, with no backend, no wallet and no
key.

What it does:

- Derives a `poolId` from a `PoolKey` as you type, alongside the id the same pair
  produces with the hook removed.
- Reads live pool state through `StateView`, and prices a swap through
  `V4Quoter` with `hookData` forwarded the way a real swap would.
- Runs the real exported strategy functions against that live observation, and
  shows the evidence behind a refusal as well as a fill.
- Unpacks a position's tick range out of PositionManager's packed `info` word,
  then decides a rebalance against that position's own pool.
- Verifies the project's on-chain receipts: it fetches a transaction from a
  public RPC, finds the `Swap` log on the PoolManager and matches it against a
  derived `poolId`. It never asks KeeperHub whether the run worked.

The page can read and verify, and nothing else. Executing a swap needs a signer,
and that lives in KeeperHub, so there is no secret here to leak.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build      # static export to ./out
```

## Where the library comes from

`lib/vasunthara/` is generated, not written. It is a verbatim copy of the
browser-safe modules in `../src`, produced by `npm run sync:site` in the
repository root, and `npm run check:site` fails if the two drift.

The copy exists because Vercel builds this site with `site/` as the project root
directory, and reaching outside that root needs the "Include source files
outside of the Root Directory" project setting, which a fresh clone or a new
Vercel project would not have. A build that depends on a dashboard toggle is a
build that breaks for the next person.

`src/keeperhub.ts` is copied for its type declarations only. The modules that
reference it use `import type`, which erases at compile time, so the API client
never reaches the bundle. Two things keep that honest: `src/index.ts` is
deliberately not vendored, because its barrel re-exports `KeeperHubClient` as a
runtime value, and the build output is checked for the client's symbols.

Those TypeScript files carry ESM-correct `./x.js` specifiers, so `next.config.mjs`
sets webpack's `resolve.extensionAlias` to try `.ts` for a `.js` request.
TypeScript already performs that substitution itself, which is why `tsc` needs no
equivalent setting.

## Deploy

Import the repository into Vercel and set the **root directory** to `site`.
Vercel detects Next.js and the `vercel.json` here builds the static export to
`out`.
