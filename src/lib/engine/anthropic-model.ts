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

// The model used when nothing is injected. ANTHROPIC_API_URL points at a gateway
// (the SDK itself only reads ANTHROPIC_BASE_URL); empty means api.anthropic.com.
// opts.maxRetries: the SDK's own retries (default 2). The PB-17 eval passes 0 so a
// 429 quota error stops the run at once instead of spending more quota.
export function createDefaultModel(
  env: Record<string, string | undefined> = process.env,
  opts: { maxRetries?: number } = {},
): ModelClient {
  const baseURL = env.ANTHROPIC_API_URL?.trim().replace(/\/+$/, "").replace(/\/v1\/messages$/, "");
  return createAnthropicModel(
    new Anthropic({ ...(baseURL ? { baseURL } : {}), ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}) }),
  );
}
