import { z } from "zod";
import {
  tools,
  toolsForMode,
  type EngineMode,
  type ToolCallLog,
  type ToolContext,
  type ToolName,
} from "@/contract";
import { ToolError, type Db, type ToolHandler, type ToolHandlers } from "./types";

// content is what the model sees in the tool_result; log goes to ai_turns.tool_calls
// (null only for a tool name that doesn't exist, which has no valid log entry).
export type ToolRun = { log: ToolCallLog | null; content: string; isError: boolean };

const fail = (error: string, log: ToolCallLog | null, extra: object = {}): ToolRun => ({
  log,
  content: JSON.stringify({ error, ...extra }),
  isError: true,
});

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(tools, name);
}

// The only way any tool runs. The mode gate lives here and nowhere else:
// toolsForMode(mode) decides; toolDefinitions(mode) only advertises the same set
// to the model. Never throws: every failure becomes an error tool_result.
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  mode: EngineMode,
  handlers: ToolHandlers,
  db: Db,
): Promise<ToolRun> {
  if (!isToolName(name)) return fail("unknown_tool", null);
  if (!toolsForMode(mode).includes(name)) {
    return fail("tool_not_allowed", { name, input: rawInput, error: "tool_not_allowed" });
  }

  const tool = tools[name];
  const input = tool.input.safeParse(rawInput);
  if (!input.success) {
    return fail(
      "invalid_input",
      { name, input: rawInput, error: "invalid_input" },
      { details: z.prettifyError(input.error) },
    );
  }

  let result: unknown;
  try {
    const handler = handlers[name] as ToolHandler<ToolName>;
    result = await handler(input.data as never, ctx, db);
  } catch (e) {
    if (e instanceof ToolError) return fail(e.code, { name, input: input.data, error: e.code });
    const message = e instanceof Error ? e.message : String(e);
    return fail("internal_error", { name, input: input.data, error: `internal_error: ${message}` });
  }

  const output = tool.output.safeParse(result);
  if (!output.success) {
    return fail("internal_error", {
      name,
      input: input.data,
      error: `invalid_output: ${z.prettifyError(output.error)}`,
    });
  }
  return {
    log: { name, input: input.data, output: output.data },
    content: JSON.stringify(output.data),
    isError: false,
  };
}
