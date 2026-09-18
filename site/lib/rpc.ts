import { JsonRpcProvider } from "ethers";
import { type ChainId, getDeployment } from "./vasunthara/deployments";

/**
 * A read-only provider for a chain, over the same public endpoint the library's
 * proof CLI uses. Every endpoint in the deployment table answers with
 * `access-control-allow-origin: *`, which is what lets this page read chain
 * state directly from the browser with no backend in between.
 *
 * There is no signer here and there is no way to add one. The page reads and
 * verifies; anything that moves value is executed by KeeperHub, which holds the
 * key server-side. A static export could not keep a secret anyway.
 */
export function providerFor(chainId: ChainId): JsonRpcProvider {
  const { rpcUrl } = getDeployment(chainId);
  return new JsonRpcProvider(rpcUrl, chainId, {
    // The chain id is known from the deployment table, so skip the discovery
    // round trip every provider otherwise makes before its first real call.
    staticNetwork: true,
    // Public endpoints vary in whether they accept JSON-RPC batches, and a
    // rejected batch fails every call inside it. One request per call is
    // slower and predictable.
    batchMaxCount: 1,
  });
}

/** Turn a thrown value into something worth showing a reader. */
export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const e = error as { shortMessage?: string; info?: { error?: { message?: string } }; message?: string };
    const message = e.shortMessage ?? e.info?.error?.message ?? e.message;
    if (message) {
      return message;
    }
  }
  return String(error);
}
