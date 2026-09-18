// GENERATED FILE. Do not edit.
//
// Copied verbatim from src/keeperhub.ts by scripts/sync-site-lib.mjs.
// Change the original and run `npm run sync:site` from the repository root.
// `npm run check:site` fails when this copy drifts from src/.
//
// This exists because Vercel builds the site with site/ as its root directory
// and cannot reach src/ without a project setting a fresh clone would lack.

// A typed client for the KeeperHub workflow API.
//
// This is deliberately small and dependency-free: it speaks the handful of
// routes a V4 strategy actually needs, and it encodes the platform's sharp
// edges so a caller cannot fall down them. Each of the following was confirmed
// against the live API on 2026-09-18 and the reason it matters is in the
// comment, because every one of them fails quietly rather than loudly.

const DEFAULT_BASE_URL = "https://app.keeperhub.com";

/** Terminal execution states. Anything else means the run is still going. */
const TERMINAL = new Set([
  "success",
  "error",
  "system_error",
  "skipped",
  "cancelled",
]);

export type KeeperHubOptions = {
  /** Organization API key, the `kh_` form. Read it from the environment. */
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Injected so tests can drive the client without a network. */
  readonly fetchImpl?: typeof fetch;
};

export type WorkflowNode = {
  readonly id: string;
  readonly type: "trigger" | "action";
  readonly position?: { readonly x: number; readonly y: number };
  readonly data: {
    readonly label: string;
    readonly description?: string;
    readonly type: "trigger" | "action";
    readonly status?: string;
    readonly config: Record<string, unknown>;
  };
};

export type WorkflowEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type?: string;
  /** Only on edges out of a Condition ("true"/"false") or For Each. */
  readonly sourceHandle?: string;
};

export type WorkflowDefinition = {
  readonly name: string;
  readonly description?: string;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
};

export type TransactionReceipt = {
  readonly hash: string;
  readonly nodeId?: string;
  readonly nodeName?: string;
  readonly chainId?: number;
  readonly gasUsed?: string;
  readonly blockNumber?: number;
  readonly receiptStatus?: string;
  /** KeeperHub re-fetched the receipt from the chain and it matched. */
  readonly verified?: boolean;
  readonly verifiedAt?: string;
};

export type ExecutionResult = {
  readonly executionId: string;
  readonly status: string;
  readonly completed: boolean;
  readonly transactionHashes: readonly TransactionReceipt[];
  readonly output: unknown;
  readonly error: string | null;
  readonly gasUsedWei?: string;
  readonly completedAt?: string;
};

export class KeeperHubError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "KeeperHubError";
    this.status = status;
    this.body = body;
  }
}

/**
 * KeeperHub accepts a workflow that can never run.
 *
 * `POST /api/workflows/create` validates neither the template tokens nor
 * `network` nor `actionType`, so a 200 there means "stored", not "works".
 * `PATCH` does run the template validator. That is why createWorkflow below
 * always creates a shell and then patches the real graph in: it buys template
 * validation that the create path does not give you.
 */
export class KeeperHubClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly http: typeof fetch;

  constructor(options: KeeperHubOptions) {
    if (!options.apiKey) {
      throw new Error("KeeperHub apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.http = options.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...extraHeaders,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const response = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new KeeperHubError(
        `KeeperHub ${method} ${path} failed with ${response.status}`,
        response.status,
        text,
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /**
   * Create a workflow, then patch the real graph in so the template validator
   * runs. Returns the workflow id.
   */
  async createWorkflow(definition: WorkflowDefinition): Promise<string> {
    const shell = await this.request<{ id: string }>(
      "POST",
      "/api/workflows/create",
      {
        name: definition.name,
        description: definition.description ?? "",
        nodes: definition.nodes,
        edges: definition.edges,
      },
    );
    await this.updateWorkflow(shell.id, {
      nodes: definition.nodes,
      edges: definition.edges,
    });
    return shell.id;
  }

  /** Partial update. Only the keys sent are changed. Validates templates. */
  async updateWorkflow(
    workflowId: string,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.request("PATCH", `/api/workflows/${workflowId}`, patch);
  }

  /**
   * Start a run. Returns immediately: the execution happens in the background.
   *
   * `idempotencyKey` goes in the header, which is the supported mechanism.
   * Never put `executionId` in the body: that is a hard 400 for an external
   * caller and it raises a security event.
   */
  async execute(
    workflowId: string,
    input: Record<string, unknown> = {},
    idempotencyKey?: string,
  ): Promise<{ executionId: string; status: string }> {
    const headers = idempotencyKey
      ? { "Idempotency-Key": idempotencyKey }
      : undefined;
    return await this.request(
      "POST",
      `/api/workflows/${workflowId}/execute`,
      // Always nest under `input`. A bare top-level body still works but is
      // deprecated, and mixing the two shapes is a hard 400.
      { input },
      headers,
    );
  }

  /**
   * Block until the run reaches a terminal state.
   *
   * The server caps a single wait at 60s and answers a timeout with HTTP 200
   * and `completed: false`, so this loops on the body rather than the status
   * code. Branching on the HTTP code alone never terminates.
   */
  async waitForExecution(
    executionId: string,
    totalTimeoutMs = 180_000,
    pollTimeoutMs = 55_000,
  ): Promise<ExecutionResult> {
    const deadline = totalTimeoutMs / pollTimeoutMs;
    let attempts = 0;
    let last: ExecutionResult | null = null;

    while (attempts <= deadline) {
      attempts += 1;
      const result = await this.request<ExecutionResult>(
        "GET",
        `/api/workflows/executions/${executionId}/wait?timeoutMs=${pollTimeoutMs}`,
      );
      last = result;
      if (result.completed || TERMINAL.has(result.status)) {
        return result;
      }
    }
    throw new Error(
      `execution ${executionId} did not finish within ${totalTimeoutMs}ms, last status ${last?.status ?? "unknown"}`,
    );
  }

  /** Non-blocking status, with per-node progress and the error context. */
  async getStatus(executionId: string): Promise<{
    status: string;
    nodeStatuses: readonly { nodeId: string; status: string }[];
    progress: Record<string, unknown>;
    errorContext: Record<string, unknown> | null;
    transactionHashes: readonly TransactionReceipt[];
  }> {
    return await this.request(
      "GET",
      `/api/workflows/executions/${executionId}/status`,
    );
  }

  /**
   * Per-node logs, oldest first.
   *
   * The API returns them newest first. Rendering that order shows the run
   * backwards, so they are reversed here once rather than at every call site.
   */
  async getLogs(executionId: string): Promise<{
    execution: Record<string, unknown>;
    logs: readonly Record<string, unknown>[];
  }> {
    const raw = await this.request<{
      execution: Record<string, unknown>;
      logs: Record<string, unknown>[];
    }>("GET", `/api/workflows/executions/${executionId}/logs`);
    return { execution: raw.execution, logs: [...raw.logs].reverse() };
  }

  /** Past runs of a workflow, newest first. The API caps this at 50. */
  async listExecutions(
    workflowId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    return await this.request("GET", `/api/workflows/${workflowId}/executions`);
  }

  /** Run a workflow and wait for it, the common case. */
  async run(
    workflowId: string,
    input: Record<string, unknown> = {},
    idempotencyKey?: string,
  ): Promise<ExecutionResult> {
    const started = await this.execute(workflowId, input, idempotencyKey);
    return await this.waitForExecution(started.executionId);
  }
}

/**
 * Explorer links for every transaction a run produced.
 *
 * Worth saying plainly wherever these are published: KeeperHub relays writes,
 * so the `from` on the explorer is a KeeperHub relayer and the top-level `to`
 * is its executor contract, not the wallet and not the target. The proof that
 * the intended call happened is the emitted event plus KeeperHub's own
 * `executedCall` record, not the sender column.
 */
export function receiptLinks(
  result: ExecutionResult,
  explorerByChain: Readonly<Record<number, string>>,
): readonly string[] {
  const links: string[] = [];
  for (const receipt of result.transactionHashes) {
    const base = receipt.chainId ? explorerByChain[receipt.chainId] : undefined;
    links.push(base ? `${base}${receipt.hash}` : receipt.hash);
  }
  return links;
}
