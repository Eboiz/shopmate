import type Anthropic from "@anthropic-ai/sdk";
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
