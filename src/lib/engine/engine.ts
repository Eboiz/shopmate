import Anthropic from "@anthropic-ai/sdk";
import {
  engineInputSchema,
  engineOutputSchema,
  tools,
  type EngineInput,
  type EngineOutput,
  type HandoffReason,
  type Reply,
  type ToolCallLog,
  type ToolContext,
  type ToolOutput,
} from "@/contract";
import type { Json } from "@/contract/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultModel } from "./anthropic-model";
import { executeTool, type ToolRun } from "./execute-tool";
import { toModelMessages } from "./messages";
import { countDuplicateCalls, toolOutcome, type TurnDetail, type TurnMetrics } from "./metrics";
import { FALLBACK_TEXT, MODEL_REPLY_JSON_SCHEMA, parseModelReply } from "./model-reply";
import { createLangfuseSink } from "./langfuse";
import { buildSystemPrompt, PROMPT_VERSION } from "./prompt";
import {
  adviceIntent, latestShopperText, policyKindFor, PRODUCT_CLARIFICATION,
  PRODUCT_HANDOFF, shopperMeasurements, sizeReply, stockReply,
} from "./product-advice";
import { createSupabaseStore, type EngineStore } from "./store";
import { toolDefinitions, toolHandlers } from "./tools";
import { EngineError, type Db, type ToolHandlers } from "./types";

export const MAX_TOOL_CALLS = 5;
// Sonnet 5.5 runs adaptive thinking by default and thinking counts toward
// max_tokens; 1024 would cut replies short.
export const MAX_OUTPUT_TOKENS = 4096;
export const HANDOFF_TEXT =
  "Dạ, mình đã chuyển câu hỏi của bạn cho nhân viên shop. Nhân viên sẽ trả lời bạn sớm nhé!";
const HANDOFF_SUFFIX = "Mình đã chuyển câu hỏi của bạn cho nhân viên shop, nhân viên sẽ trả lời bạn sớm nhé!";
export const SIZE_OUT_OF_RANGE_HANDOFF_TEXT = `Dạ, số đo của bạn nằm ngoài bảng size của shop nên mình chưa tư vấn được size. ${HANDOFF_SUFFIX}`;
export const NO_SIZE_CHART_HANDOFF_TEXT = `Dạ, sản phẩm này shop chưa có bảng size nên mình chưa tư vấn được size. ${HANDOFF_SUFFIX}`;

type SizeStatus = "out_of_range" | "no_chart" | null;

// The shopper is told why, not just that staff will answer. A size handoff says the
// measurements are outside the chart, or that the product has no chart.
export function handoffText(reason: HandoffReason, sizeStatus: SizeStatus): string {
  if (sizeStatus === "no_chart") return NO_SIZE_CHART_HANDOFF_TEXT;
  if (sizeStatus === "out_of_range" || reason === "size_out_of_range") return SIZE_OUT_OF_RANGE_HANDOFF_TEXT;
  return HANDOFF_TEXT;
}

function sizeStatusOf(content: unknown): SizeStatus {
  try {
    const status = (JSON.parse(String(content)) as { status?: unknown }).status;
    return status === "out_of_range" || status === "no_chart" ? status : null;
  } catch {
    return null;
  }
}

export const STAFF_DRAFT_GIVE_UP_TEXT =
  "Chưa soạn được câu trả lời cho câu hỏi này. Bạn kiểm tra dữ liệu và tự trả lời khách nhé.";
// Sequential. Raise above 1 only after measuring (see README, engine metrics); see runBatch.
export const TOOL_CONCURRENCY = 1;
export const DEFAULT_MODEL = "claude-sonnet-5-5";

// onFirstToken is called ONCE, when the first text token of the response arrives (TTFT).
export type ModelClient = {
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    opts?: { onFirstToken?: () => void },
  ): Promise<Anthropic.Message>;
};

export type EngineDeps = {
  model: ModelClient;
  store: EngineStore;
  handlers: ToolHandlers;
  db: Db;
  now: () => number;
  modelName: string;
  // staff_draft only: the signed-in staff member's shop, from requireStaff()
  // (src/lib/auth.ts). Never from the request body.
  staffShopId?: string;
  // May return a promise (e.g. a send to Langfuse); turnLogged waits for it.
  onMetrics: (m: TurnMetrics, detail?: TurnDetail) => unknown;
  // Also hand the sink the messages and the model's reply (customer text!). Off by
  // default; LANGFUSE_CAPTURE_CONTENT=true turns it on.
  captureContent: boolean;
  toolConcurrency: number;
};

// output is ready as soon as runEngine resolves. The ai_turns write runs in the
// background: turnLogged resolves with the row id, or null when the write
// failed (logged with console.error); it NEVER rejects. On serverless, hand
// turnLogged to after()/waitUntil, or the process may stop before it is written.
export type EngineResult = {
  output: EngineOutput;
  handoffReason: HandoffReason | null;
  turnLogged: Promise<string | null>;
};

// Runs fn over items with at most `concurrency` at a time; results come back in
// the order of items, whichever finishes first. fn must not throw (executeTool doesn't).
export async function runBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

// Logs the JSON line, and also sends the turn to Langfuse Cloud when
// LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set.
function defaultMetricsSink(): EngineDeps["onMetrics"] {
  const langfuse = createLangfuseSink();
  return (m, detail) => {
    console.info(JSON.stringify(m));
    return langfuse?.(m, detail);
  };
}

function resolveDeps(deps: Partial<EngineDeps>): EngineDeps {
  // Defaults are built only when missing, so tests never touch Supabase or Claude.
  const db = deps.db ?? createAdminClient();
  return {
    db,
    model: deps.model ?? createDefaultModel(),
    store: deps.store ?? createSupabaseStore(db),
    handlers: deps.handlers ?? toolHandlers,
    now: deps.now ?? Date.now,
    modelName: deps.modelName ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    staffShopId: deps.staffShopId,
    onMetrics: deps.onMetrics ?? defaultMetricsSink(),
    captureContent: deps.captureContent ?? process.env.LANGFUSE_CAPTURE_CONTENT === "true",
    toolConcurrency: deps.toolConcurrency ?? TOOL_CONCURRENCY,
  };
}

const isWriteTool = (name: string) => Object.hasOwn(tools, name) && tools[name as keyof typeof tools].writes;

export async function runEngine(rawInput: EngineInput, partialDeps: Partial<EngineDeps> = {}): Promise<EngineResult> {
  const deps = resolveDeps(partialDeps);
  const { now } = deps;
  const t0 = now();
  const input = engineInputSchema.parse(rawInput);
  const mode = input.mode;

  if (mode === "staff_draft" && !deps.staffShopId) throw new EngineError("staff_shop_not_resolved");
  // ONE read for everything needed before the model call.
  const tc = await deps.store.loadTurnContext({
    conversationId: input.mode === "customer" ? input.conversationId : null,
    shopId: mode === "staff_draft" ? deps.staffShopId! : null,
    productId: input.productId ?? null,
  });

  let ctx: ToolContext;
  if (input.mode === "customer") {
    // Same code for "no such conversation" and "not in mode ai", so callers
    // can't tell an existing conversation from a missing one by the error.
    if (!tc.conversation || tc.conversation.mode !== "ai") throw new EngineError("conversation_not_found");
    ctx = { shopId: tc.conversation.shopId, conversationId: input.conversationId };
  } else {
    ctx = { shopId: deps.staffShopId!, conversationId: null };
  }

  // Computed once per turn, never per loop: a stable prefix keeps the prompt cache.
  // toolDefinitions(mode) only ADVERTISES tools to the model; the gate is
  // toolsForMode(mode) inside executeTool. The two must match (see tools/index.ts).
  const system = buildSystemPrompt({ mode, product: tc.product });
  const toolList = toolDefinitions(mode);
  const messages = toModelMessages(input.history);
  const detail: TurnDetail = { system: system.map((b) => b.text).join("\n\n"), calls: [] };

  const logs: ToolCallLog[] = [];
  const modelCalls: TurnMetrics["modelCalls"] = [];
  const toolMetrics: TurnMetrics["toolCalls"] = [];
  const seen: Array<{ name: string; input: unknown }> = [];
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let handoff: HandoffReason | null = null;
  let truncated = false;
  let sizeStatus: SizeStatus = null;
  let modelReply: ReturnType<typeof parseModelReply>["reply"] | null = null;
  let finalFirstTokenAt: number | null = null;
  const adviceState: {
    foundProducts: ToolOutput<"search_products">["products"] | null;
    stock: ToolOutput<"get_stock"> | null;
    size: ToolOutput<"recommend_size"> | null;
    policy: ToolOutput<"get_policy"> | null;
  } = { foundProducts: null, stock: null, size: null, policy: null };

  for (;;) {
    const c0 = now();
    let firstTokenAt: number | null = null;
    const sentMessages = deps.captureContent ? messages.slice() : null;
    const res = await deps.model.create(
      {
        model: deps.modelName,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools: toolList,
        messages,
        output_config: { effort: "medium", format: { type: "json_schema", schema: MODEL_REPLY_JSON_SCHEMA } },
      },
      { onFirstToken: () => (firstTokenAt ??= now()) },
    );
    modelCalls.push({
      startMs: c0 - t0,
      ms: now() - c0,
      ttftMs: firstTokenAt === null ? null : firstTokenAt - c0,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
      stopReason: res.stop_reason,
    });
    if (sentMessages) detail.calls.push({ messages: sentMessages, output: res.content });
    inputTokens += res.usage.input_tokens;
    outputTokens += res.usage.output_tokens;

    if (res.stop_reason === "max_tokens") {
      // Don't parse half a reply or run a half-written tool_use.
      console.error("engine: response truncated at max_tokens");
      truncated = true;
      break;
    }
    if (res.stop_reason !== "tool_use") {
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      modelReply = parseModelReply(text).reply;
      finalFirstTokenAt = firstTokenAt;
      break;
    }

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // None of the batch runs when it would go over the limit.
    if (calls + uses.length > MAX_TOOL_CALLS) {
      handoff = "too_many_tool_calls";
      break;
    }
    calls += uses.length;

    const concurrency = uses.some((u) => isWriteTool(u.name)) ? 1 : deps.toolConcurrency;
    const runs = await runBatch(uses, concurrency, async (u): Promise<{ run: ToolRun; ms: number; startMs: number }> => {
      const s0 = now();
      const run = await executeTool(u.name, u.input, ctx, mode, deps.handlers, deps.db);
      return { run, ms: now() - s0, startMs: s0 - t0 };
    });

    // runs are in tool_use order.
    uses.forEach((u, i) => {
      const { run, ms, startMs } = runs[i];
      if (run.log) logs.push(run.log);
      toolMetrics.push({ name: u.name, startMs, ms, outcome: toolOutcome(run) });
      seen.push({ name: u.name, input: u.input });
      if (u.name === "recommend_size" && !run.isError) sizeStatus = sizeStatusOf(run.content);
      if (!run.isError && u.name === "search_products") adviceState.foundProducts = tools.search_products.output.parse(run.log?.output).products;
      if (!run.isError && u.name === "get_stock") adviceState.stock = tools.get_stock.output.parse(run.log?.output);
      if (!run.isError && u.name === "recommend_size") adviceState.size = tools.recommend_size.output.parse(run.log?.output);
      if (!run.isError && u.name === "get_policy") adviceState.policy = tools.get_policy.output.parse(run.log?.output);
    });

    const handedOff = uses.find((u, i) => u.name === "handoff_to_staff" && !runs[i].run.isError);
    if (handedOff) {
      handoff = (handedOff.input as { reason: HandoffReason }).reason;
      break;
    }

    messages.push(
      { role: "assistant", content: res.content as Anthropic.ContentBlockParam[] },
      {
        role: "user",
        content: uses.map((u, i) => ({
          type: "tool_result" as const,
          tool_use_id: u.id,
          content: runs[i].run.content,
          is_error: runs[i].run.isError,
        })),
      },
    );
  }

  // Verify factual answers against shop data even if the model forgot a tool or
  // wrote a plausible but unsupported number. These calls use the same tool gate
  // and are logged like model tool calls.
  const previousAssistant = [...input.history].reverse().find((message) => message.sender === "ai")?.text;
  const intent = adviceIntent(input.history) ?? (previousAssistant === PRODUCT_CLARIFICATION ? "stock" : null);
  const verifiedTool = async <T extends "get_stock" | "recommend_size" | "get_policy">(name: T, toolInput: object) => {
    const started = now();
    const run = await executeTool(name, toolInput, ctx, mode, deps.handlers, deps.db);
    toolMetrics.push({ name, startMs: started - t0, ms: now() - started, outcome: toolOutcome(run) });
    if (run.log) logs.push(run.log);
    return run.isError ? null : run.log?.output;
  };
  let verifiedText: string | null = null;
  if (mode === "customer" && !handoff && !truncated && modelReply && intent) {
    if (intent === "policy") {
      const kind = policyKindFor(input.history);
      if (kind) {
        if (!adviceState.policy || adviceState.policy.kind !== kind) {
          const output = await verifiedTool("get_policy", { kind });
          if (output) adviceState.policy = tools.get_policy.output.parse(output);
        }
        if (adviceState.policy?.kind === kind) {
          if (adviceState.policy.content) verifiedText = adviceState.policy.content;
          else {
            handoff = "policy_not_covered";
            await deps.store.setNeedsHuman(ctx);
            verifiedText = "Shop chưa có thông tin về chính sách này. Mình đã chuyển câu hỏi cho nhân viên shop nhé.";
          }
        } else verifiedText = "Mình chưa kiểm tra được chính sách của shop lúc này. Bạn vui lòng thử lại sau nhé.";
      } else {
        handoff = "policy_not_covered";
        await deps.store.setNeedsHuman(ctx);
        verifiedText = "Shop chưa có thông tin về chính sách này. Mình đã chuyển câu hỏi cho nhân viên shop nhé.";
      }
    } else if (intent === "size") {
      const { heightCm, weightKg } = shopperMeasurements(input.history);
      if (heightCm === null || weightKg === null) {
        verifiedText = `Để tư vấn size, bạn cho mình ${heightCm === null ? "chiều cao" : ""}${heightCm === null && weightKg === null ? " và " : ""}${weightKg === null ? "cân nặng" : ""} nhé.`;
      } else if (heightCm < 50 || heightCm > 250 || weightKg < 20 || weightKg > 250) {
        handoff = "size_out_of_range";
        await deps.store.setNeedsHuman(ctx);
        verifiedText = handoffText(handoff, "out_of_range");
      } else if (!tc.product && adviceState.foundProducts?.length !== 1) {
        verifiedText = PRODUCT_CLARIFICATION;
      } else {
        const productId = tc.product?.id ?? adviceState.foundProducts![0].productId;
        // A model-supplied result may use the wrong measurements or product.
        const output = await verifiedTool("recommend_size", { productId, heightCm, weightKg });
        if (output) adviceState.size = tools.recommend_size.output.parse(output);
        if (adviceState.size?.status === "ok") verifiedText = sizeReply(adviceState.size);
        else if (adviceState.size) {
          sizeStatus = adviceState.size.status;
          handoff = adviceState.size.status === "out_of_range" ? "size_out_of_range" : "not_covered_by_data";
          await deps.store.setNeedsHuman(ctx);
          verifiedText = handoffText(handoff, sizeStatus);
        } else verifiedText = "Mình chưa kiểm tra được bảng size lúc này. Bạn vui lòng thử lại sau nhé.";
      }
    } else {
      const productId = tc.product?.id ?? (adviceState.foundProducts?.length === 1 ? adviceState.foundProducts[0].productId : null);
      if (!productId) {
        if (previousAssistant === PRODUCT_CLARIFICATION) {
          handoff = "product_not_found";
          await deps.store.setNeedsHuman(ctx);
          verifiedText = PRODUCT_HANDOFF;
        } else verifiedText = PRODUCT_CLARIFICATION;
      } else {
        // Request all variants so a sold-out color/size can offer real alternatives.
        const output = await verifiedTool("get_stock", { productId });
        if (output) adviceState.stock = tools.get_stock.output.parse(output);
        if (adviceState.stock) verifiedText = stockReply(adviceState.stock, latestShopperText(input.history));
        else verifiedText = "Mình chưa kiểm tra được giá và tồn kho lúc này. Bạn vui lòng thử lại sau nhé.";
      }
    }
  }

  let reply: Reply;
  if (verifiedText !== null) {
    reply = { text: verifiedText, products: [], quickReplies: [] };
  } else if (handoff && mode === "customer") {
    // Must finish before returning: the caller sends HANDOFF_TEXT right after.
    // (A handoff_to_staff call already moved the conversation itself.)
    if (handoff === "too_many_tool_calls") await deps.store.setNeedsHuman(ctx);
    reply = { text: handoffText(handoff, sizeStatus), products: [], quickReplies: [] };
  } else if (handoff) {
    reply = { text: STAFF_DRAFT_GIVE_UP_TEXT, products: [], quickReplies: [] };
  } else if (truncated || !modelReply) {
    reply = { text: FALLBACK_TEXT, products: [], quickReplies: [] };
  } else {
    reply = {
      text: modelReply.text,
      // Cards come from the database for this shop only; foreign ids drop out.
      products: await deps.store.productCards(ctx.shopId, modelReply.productIds),
      quickReplies: modelReply.quickReplies,
    };
  }
  // personalReplyNeeded belongs to PB-20.
  const output = engineOutputSchema.parse({ reply, personalReplyNeeded: false });
  const latencyMs = now() - t0; // output is ready; the log write is not counted

  const metrics: TurnMetrics = {
    event: "engine_turn",
    promptVersion: PROMPT_VERSION,
    model: deps.modelName,
    mode,
    shopId: ctx.shopId,
    conversationId: ctx.conversationId,
    latencyMs,
    ttftMs: finalFirstTokenAt === null ? null : finalFirstTokenAt - t0,
    modelCalls,
    toolCalls: toolMetrics,
    duplicateToolCalls: countDuplicateCalls(seen),
    inputTokens,
    outputTokens,
    handoffReason: handoff,
    truncated,
  };
  let sinkDone: Promise<unknown> = Promise.resolve();
  try {
    sinkDone = Promise.resolve(deps.onMetrics(metrics, detail)).catch((e) => console.error("engine: metrics sink failed", e));
  } catch (e) {
    console.error("engine: metrics sink failed", e);
  }

  const turnLogged = (async () => {
    try {
      const [row] = await Promise.all([deps.store.insertTurn({
        shop_id: ctx.shopId,
        conversation_id: ctx.conversationId,
        mode,
        latency_ms: latencyMs,
        tool_calls: logs as NonNullable<Json>,
        handoff_reason: handoff,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ttft_ms: metrics.ttftMs,
        model_calls: modelCalls.length,
        model: deps.modelName,
        prompt_version: PROMPT_VERSION,
      }), sinkDone]);
      return row;
    } catch (e) {
      console.error("engine: failed to write ai_turns", e);
      return null;
    }
  })();

  return { output, handoffReason: handoff, turnLogged };
}
