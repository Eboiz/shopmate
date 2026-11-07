import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ToolContext, ToolInput, ToolName, ToolOutput } from "@/contract";

// The admin client (secret key): it bypasses RLS, so every query filters by
// ctx.shopId itself.
export type Db = SupabaseClient<Database>;

// A tool handler never checks the mode and never reads shop_id from its input:
// executeTool gates the mode, and ctx comes from the server.
export type ToolHandler<T extends ToolName> = (
  input: ToolInput<T>,
  ctx: ToolContext,
  db: Db,
) => Promise<ToolOutput<T>>;

export type ToolHandlers = { [T in ToolName]: ToolHandler<T> };

// A business outcome the model may see and react to (e.g. product_not_found).
export class ToolError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "ToolError";
  }
}

// The caller's fault: bad input, unknown conversation. runEngine throws it.
export class EngineError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "EngineError";
  }
}
