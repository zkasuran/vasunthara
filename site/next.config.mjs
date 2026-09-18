import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so the whole app deploys as static files with no server
  // runtime. Everything interactive runs in the browser against public
  // JSON-RPC endpoints, so there is nothing for a server to do and no place a
  // secret could be held.
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,

  webpack: (config) => {
    // lib/vasunthara is copied verbatim from the library's src/, which writes
    // ESM-correct specifiers like `./abis.js`. Those files are TypeScript, so
    // the bundler has to try `.ts` for a `.js` request. TypeScript already does
    // this substitution itself, which is why tsc needs no equivalent setting.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },

  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
