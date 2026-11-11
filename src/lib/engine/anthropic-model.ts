import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "./engine";

// Streams every request so TTFT can be measured: onFirstToken fires at the first
// text delta (thinking deltas don't count: the shopper never sees them).
// Returns the same Message a non-streaming call would.
export function createAnthropicModel(client: Anthropic): ModelClient {
  return {
    async create(params, opts) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stream: _stream, ...body } = params;
      const stream = client.messages.stream(body);
      let first = true;
      stream.on("streamEvent", (event) => {
        if (first && event.type === "content_block_delta" && event.delta.type === "text_delta") {
          first = false;
          opts?.onFirstToken?.();
        }
      });
      return stream.finalMessage();
    },
  };
}

function trimBaseURL(url: string | undefined): string | undefined {
  return url?.trim().replace(/\/+$/, "").replace(/\/v1\/messages$/, "") || undefined;
}

// Errors the backup key can get past: quota or rate limit (429), gateway or API
// errors (5xx, 529 overloaded), the gateway being down, or the gateway key being
// rejected (401/403). A bad request (400, 404, 413) would fail on the backup too.
export function shouldUseBackup(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (!(error instanceof Anthropic.APIError) || error.status === undefined) return false;
  return error.status === 429 || error.status === 401 || error.status === 403 || error.status >= 500;
}

// Sends the request to `backup` when `primary` fails with an error above. Nothing
// reaches the shopper before the primary fails, so onFirstToken fires once.
export function withBackup(primary: ModelClient, backup: ModelClient, onSwitch: (status: number | undefined) => void): ModelClient {
  return {
    async create(params, opts) {
      try {
        return await primary.create(params, opts);
      } catch (error) {
        if (!shouldUseBackup(error)) throw error;
        onSwitch(error instanceof Anthropic.APIError ? error.status : undefined);
        return backup.create(params, opts);
      }
    },
  };
}

// ANTHROPIC_BACKUP_API_KEY (+ optional ANTHROPIC_BACKUP_API_URL, empty means
// api.anthropic.com): a second key used only when the primary fails.
export function backupConfig(env: Record<string, string | undefined>): { apiKey: string; baseURL?: string } | null {
  const apiKey = env.ANTHROPIC_BACKUP_API_KEY?.trim();
  if (!apiKey) return null;
  const baseURL = trimBaseURL(env.ANTHROPIC_BACKUP_API_URL);
  return baseURL ? { apiKey, baseURL } : { apiKey };
}

// The model used when nothing is injected. ANTHROPIC_API_URL points at a gateway
// (the SDK itself only reads ANTHROPIC_BASE_URL); empty means api.anthropic.com.
// opts.maxRetries: the SDK's own retries (default 2). The PB-17 eval passes 0 so a
// 429 quota error stops the run at once instead of spending more quota.
// With a backup key the primary never retries: a failed call goes straight to the
// backup, which keeps opts.maxRetries.
export function createDefaultModel(
  env: Record<string, string | undefined> = process.env,
  opts: { maxRetries?: number } = {},
): ModelClient {
  const baseURL = trimBaseURL(env.ANTHROPIC_API_URL);
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const retries = opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {};
  const backup = backupConfig(env);
  const primary = createAnthropicModel(
    new Anthropic({ ...(baseURL ? { baseURL } : {}), ...(apiKey ? { apiKey } : {}), ...(backup ? { maxRetries: 0 } : retries) }),
  );
  if (!backup) return primary;
  return withBackup(primary, createAnthropicModel(new Anthropic({ ...backup, ...retries })), (status) =>
    console.warn(JSON.stringify({ event: "anthropic_backup", status: status ?? "connection" })),
  );
}
