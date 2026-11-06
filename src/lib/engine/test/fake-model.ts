import type Anthropic from "@anthropic-ai/sdk";
import type { ModelReply } from "@/contract";
import type { ModelClient } from "../engine";

export type ScriptedResponse = Partial<Anthropic.Message> & {
  _ms?: number; // how long the whole call takes on the fake clock
  _ttftMs?: number; // when the first text token arrives, from the start of the call
};

// A ModelClient that plays back canned responses in order. With a fake clock it
// advances clock.t by each response's _ms and calls onFirstToken at _ttftMs
// (or at the start, when the response has a text block and no _ttftMs).
// calls holds a copy of every request, as it was when sent.
export function scriptedModel(
  responses: ScriptedResponse[],
  clock: { t: number } = { t: 0 },
): ModelClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let next = 0;
  return {
    calls,
    async create(params, opts) {
      calls.push(structuredClone(params));
      const scripted = responses[next++];
      if (!scripted) throw new Error(`scriptedModel: no response #${next}`);
      const { _ms = 0, _ttftMs, ...response } = scripted;
      const hasText = (response.content ?? []).some((b) => b.type === "text");
      if (_ttftMs !== undefined || hasText) {
        clock.t += _ttftMs ?? 0;
        opts?.onFirstToken?.();
        clock.t += _ms - (_ttftMs ?? 0);
      } else {
        clock.t += _ms;
      }
      return {
        id: `msg_${next}`,
        type: "message",
        role: "assistant",
        model: params.model,
        content: [],
        stop_reason: "end_turn",
        stop_sequence: null,
        ...response,
        usage: { input_tokens: 0, output_tokens: 0, ...response.usage },
      } as Anthropic.Message;
    },
  };
}

let toolUseCount = 0;

export const toolUse = (name: string, input: unknown, id?: string): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id: id ?? `toolu_${++toolUseCount}`, name, input, caller: { type: "direct" } }) as Anthropic.ToolUseBlock;

// A response that calls the given tools.
export const toolCalls = (...uses: Anthropic.ToolUseBlock[]): ScriptedResponse => ({
  stop_reason: "tool_use",
  content: uses,
});

// The model's final answer: stop_reason end_turn, one text block with the JSON reply.
export const finalJson = (reply: ModelReply): Partial<Anthropic.Message> => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(reply), citations: null }],
});
