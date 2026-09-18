# Vasunthara landing page

The marketing / explainer site for [Vasunthara](../), built with Next.js and a
static export (no server runtime), with all animations in pure CSS (no
animation library).

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
```

## Build

```bash
npm run build    # static export to ./out
```

## Deploy to Vercel

Import the repository into Vercel and set the **root directory** to `site`.
Vercel detects Next.js and the `vercel.json` here builds the static export to
`out`. Or use the one-click button in the root README.

The page explains the project and its usage: the poolId insight, the three V4
lens contracts it reads, a four-call usage walkthrough, the live on-chain proof,
the seven supported chains, and the KeeperHub integration.
