import { describe, expect, it, vi } from "vitest";
import { toolCallLogSchema, type ToolContext, type ToolName } from "@/contract";
import { executeTool } from "./execute-tool";
import { ToolError, type Db, type ToolHandlers } from "./types";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000001";
const C = "a0000000-0000-4000-8000-000000000031";
const ctx: ToolContext = { shopId: A, conversationId: C };
const db = {} as Db;

type Handler = (...args: unknown[]) => Promise<unknown>;
const fn = (impl: Handler) => vi.fn<Handler>(impl);

function fakeHandlers(overrides: Partial<Record<ToolName, (...args: unknown[]) => unknown>> = {}) {
  const base = {
    search_products: fn(async () => ({ match: "none" as const, products: [] })),
    get_stock: fn(async () => ({})),
    recommend_size: fn(async () => ({})),
    get_pairings: fn(async () => ({ pairings: [] })),
    get_policy: fn(async () => ({ kind: "doi_tra", content: "Đổi trong 7 ngày" })),
    quote_order: fn(async () => ({})),
    create_draft_order: fn(async () => ({})),
    handoff_to_staff: fn(async () => ({ mode: "needs_human" })),
  };
  for (const [name, impl] of Object.entries(overrides)) base[name as ToolName].mockImplementation(impl as never);
  return base as typeof base & ToolHandlers;
}

const errorOf = (content: string) => JSON.parse(content).error;

describe("executeTool", () => {
  it("rejects unknown tools", async () => {
    const run = await executeTool("drop_table", {}, ctx, "customer", fakeHandlers(), db);
    expect(run.isError).toBe(true);
    expect(run.log).toBeNull();
    expect(errorOf(run.content)).toBe("unknown_tool");
  });

  it("blocks create_draft_order and handoff_to_staff in staff_draft without calling the handler", async () => {
    const inputs = {
      create_draft_order: {
        items: [{ variantId: C, quantity: 1 }],
        customerName: "Thảo",
        customerPhone: "0912345678",
        customerAddress: "Q1",
      },
      handoff_to_staff: { reason: "complaint" },
    } as const;
    for (const [name, input] of Object.entries(inputs)) {
      const handlers = fakeHandlers();
      const run = await executeTool(name, input, ctx, "staff_draft", handlers, db);
      expect(run.isError).toBe(true);
      expect(errorOf(run.content)).toBe("tool_not_allowed");
      expect(run.log).toEqual({ name, input, error: "tool_not_allowed" });
      expect(handlers[name as ToolName]).toHaveBeenCalledTimes(0);
    }
  });

  it("rejects input with shop_id", async () => {
    const handlers = fakeHandlers();
    const run = await executeTool("search_products", { query: "váy", shop_id: B }, ctx, "customer", handlers, db);
    expect(run.isError).toBe(true);
    expect(errorOf(run.content)).toBe("invalid_input");
    expect(JSON.parse(run.content).details).toEqual(expect.any(String));
    expect(run.log?.error).toBe("invalid_input");
    expect(handlers.search_products).toHaveBeenCalledTimes(0);
  });

  it("passes defaults from the schema", async () => {
    const handlers = fakeHandlers();
    await executeTool("search_products", { query: "váy" }, ctx, "customer", handlers, db);
    expect(handlers.search_products).toHaveBeenCalledWith({ query: "váy", limit: 5 }, ctx, db);
  });

  it("passes ctx from the server", async () => {
    const handlers = fakeHandlers();
    await executeTool("get_policy", { kind: "doi_tra" }, ctx, "customer", handlers, db);
    expect(handlers.get_policy.mock.calls[0][1]).toBe(ctx);
  });

  it("maps ToolError to its code", async () => {
    const handlers = fakeHandlers({
      get_stock: async () => {
        throw new ToolError("product_not_found");
      },
    });
    const run = await executeTool("get_stock", { productId: B }, ctx, "customer", handlers, db);
    expect(run.isError).toBe(true);
    expect(errorOf(run.content)).toBe("product_not_found");
    expect(run.log?.error).toBe("product_not_found");
  });

  it("hides unexpected errors from the model", async () => {
    const handlers = fakeHandlers({
      get_stock: async () => {
        throw new Error("connection refused");
      },
    });
    const run = await executeTool("get_stock", { productId: A }, ctx, "customer", handlers, db);
    expect(run.content).toBe('{"error":"internal_error"}');
    expect(run.isError).toBe(true);
    expect(run.log?.error).toContain("connection refused");
  });

  it("rejects invalid handler output", async () => {
    const handlers = fakeHandlers({ get_policy: async () => ({ kind: "doi_tra" }) });
    const run = await executeTool("get_policy", { kind: "doi_tra" }, ctx, "customer", handlers, db);
    expect(errorOf(run.content)).toBe("internal_error");
    expect(run.log?.error?.startsWith("invalid_output")).toBe(true);
  });

  it("logs a successful call", async () => {
    const run = await executeTool("get_policy", { kind: "doi_tra" }, ctx, "customer", fakeHandlers(), db);
    expect(run.isError).toBe(false);
    expect(JSON.parse(run.content)).toEqual({ kind: "doi_tra", content: "Đổi trong 7 ngày" });
    const log = toolCallLogSchema.parse(run.log);
    expect(log.output).toEqual({ kind: "doi_tra", content: "Đổi trong 7 ngày" });
    expect(log).not.toHaveProperty("error");
  });
});
