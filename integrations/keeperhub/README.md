# KeeperHub integration artifact

This directory is the KeeperHub plugin form of Vasunthara: the same Uniswap V4
read layer expressed as a KeeperHub ABI-driven protocol (`slug: uniswap-v4`), so
the reads are available as no-code workflow actions in KeeperHub's visual builder.

- `uniswap-v4.ts` - the `defineAbiProtocol` definition (3 contracts, 13 actions).
- `abis/*.json` - the same verified ABIs the core library ships in `src/abis.ts`.
- `uniswap-v4.test.ts` - the KeeperHub-side unit test (24 cases).

These files import KeeperHub internals (`@/lib/protocol-registry`,
`@/lib/test-data/types`), so they typecheck and run inside the KeeperHub
repository, not in this standalone package (the root `tsconfig.json` excludes
this directory for that reason). They are included here as a faithful record of
the integration and as a drop-in for anyone wiring Vasunthara into KeeperHub.

The standalone library in `../../src` has no KeeperHub dependency and runs on
its own against any ethers `Provider`.
