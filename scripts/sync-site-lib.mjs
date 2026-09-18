#!/usr/bin/env node
// Vendors the browser-safe half of src/ into site/lib/vasunthara/.
//
//   node scripts/sync-site-lib.mjs           regenerate
//   node scripts/sync-site-lib.mjs --check   fail if the copy has drifted
//
// Why a copy exists at all. Vercel builds the landing page with site/ as the
// project root directory, and reaching outside that root requires the
// "Include source files outside of the Root Directory" project setting, which
// a fresh clone or a new Vercel project would not have. A build that depends
// on a dashboard toggle is a build that breaks for the next person. Vendoring
// keeps site/ buildable on its own while src/ stays the one place the logic is
// written and tested.
//
// The copy is mechanical: same bytes, plus a banner. --check is wired into
// `npm run verify`, so drift fails the build rather than shipping a site that
// quietly disagrees with the library.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const DEST = join(root, "site", "lib", "vasunthara");
const REL_DEST = "site/lib/vasunthara";

/**
 * The modules the browser is allowed to have. Everything here is either pure
 * computation or a read over a public JSON-RPC endpoint.
 */
const VENDORED = [
  "abis.ts",
  "deployments.ts",
  "format.ts",
  "keeperhub.ts",
  "pool-id.ts",
  "position-info.ts",
  "reader.ts",
  "simulate.ts",
  "strategy.ts",
  "swap.ts",
  "verify.ts",
  "workflows.ts",
];

/**
 * Deliberately not vendored, with the reason, so a future addition to src/ has
 * to make a decision rather than be forgotten.
 *
 * keeperhub.ts is in the list above but is only ever imported for its types:
 * simulate.ts, swap.ts and workflows.ts reference WorkflowNode with
 * `import type`, which erases at compile time, so KeeperHubClient never
 * reaches a browser bundle. It is copied because tsc needs the declarations.
 */
const NOT_VENDORED = {
  "cli.ts": "a Node entry point: reads process.argv and writes to stdout",
  "demo.ts": "a Node entry point, and it reads KEEPERHUB_ORG_KEY from the environment",
  "index.ts":
    "the barrel re-exports KeeperHubClient as a runtime value, which would pull an API client that takes a secret into the browser bundle",
};

function banner(name) {
  return `// GENERATED FILE. Do not edit.
//
// Copied verbatim from src/${name} by scripts/sync-site-lib.mjs.
// Change the original and run \`npm run sync:site\` from the repository root.
// \`npm run check:site\` fails when this copy drifts from src/.
//
// This exists because Vercel builds the site with site/ as its root directory
// and cannot reach src/ without a project setting a fresh clone would lack.

`;
}

function expected(name) {
  return banner(name) + readFileSync(join(SRC, name), "utf8");
}

function main() {
  const check = process.argv.includes("--check");

  const missing = VENDORED.filter((n) => !existsSync(join(SRC, n)));
  if (missing.length > 0) {
    fail(`missing in src/: ${missing.join(", ")}`);
  }

  // A new module in src/ is neither vendored nor consciously excluded, which
  // is exactly the state that lets the site silently fall behind.
  const unclassified = readdirSync(SRC)
    .filter((n) => n.endsWith(".ts"))
    .filter((n) => !VENDORED.includes(n) && !(n in NOT_VENDORED));
  if (unclassified.length > 0) {
    fail(
      `src/${unclassified.join(", src/")} is neither vendored nor excluded.\n` +
        "Add it to VENDORED or to NOT_VENDORED with a reason in scripts/sync-site-lib.mjs.",
    );
  }

  if (!check) {
    mkdirSync(DEST, { recursive: true });
  } else if (!existsSync(DEST)) {
    fail(`${REL_DEST} does not exist. Run \`npm run sync:site\`.`);
  }

  const stray = existsSync(DEST)
    ? readdirSync(DEST)
        .filter((n) => n.endsWith(".ts"))
        .filter((n) => !VENDORED.includes(n))
    : [];
  if (stray.length > 0) {
    fail(
      `${REL_DEST} holds files that src/ does not: ${stray.join(", ")}.\n` +
        "Delete them, or add them to VENDORED if src/ now owns them.",
    );
  }

  const drifted = [];
  let written = 0;
  for (const name of VENDORED) {
    const want = expected(name);
    const target = join(DEST, name);
    const have = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (have === want) {
      continue;
    }
    if (check) {
      drifted.push(have === null ? `${name} (missing)` : name);
    } else {
      writeFileSync(target, want);
      written += 1;
    }
  }

  if (check) {
    if (drifted.length > 0) {
      fail(
        `${REL_DEST} is out of date: ${drifted.join(", ")}.\n` +
          "Run `npm run sync:site` and commit the result.",
      );
    }
    console.log(
      `${REL_DEST} is in sync with src/ (${VENDORED.length} modules).`,
    );
    return;
  }

  console.log(
    written === 0
      ? `${REL_DEST} already up to date (${VENDORED.length} modules).`
      : `${REL_DEST}: wrote ${written} of ${VENDORED.length} modules.`,
  );
}

function fail(message) {
  console.error(`sync-site-lib: ${message}`);
  process.exit(1);
}

main();
