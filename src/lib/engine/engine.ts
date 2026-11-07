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
import { isComplaint, PERSONAL_REPLY_TEXT } from "./complaint";
import { executeTool, type ToolRun } from "./execute-tool";
import { toModelMessages } from "./messages";
import { countDuplicateCalls, toolOutcome, type TurnDetail, type TurnMetrics } from "./metrics";
import { FALLBACK_TEXT, MODEL_REPLY_JSON_SCHEMA, parseModelReply } from "./model-reply";
import { decideTurn, jevFromEnv, type CatalogItem, type JevClient } from "./jev";
import { createLangfuseSink } from "./langfuse";
import { normalizeSizeInput } from "./measurements";
import { answersAiMessage, searchMissed } from "./misunderstood";
import { isMatchingQuestion, knownShopperSize, matchingReply } from "./pairing-suggestions";
import { buildReplySystemPrompt, buildSystemPrompt, PROMPT_VERSION } from "./prompt";
import { routeTurn, type RouteOutcome, type ToolRunner } from "./route";
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
export const PRODUCT_NOT_FOUND_HANDOFF_TEXT = `Dạ, mình vẫn chưa tìm thấy sản phẩm bạn hỏi trong shop. ${HANDOFF_SUFFIX}`;

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
  // PB-10: Jev decides the turn and the model only writes the reply (route.ts).
  // null: every turn runs the LLM tool loop (no OPENROUTER_API_KEY, or tests).
  jev: JevClient | null;
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
    jev: deps.jev !== undefined ? deps.jev : jevFromEnv(),
  };
}

const lastShopperText = (history: EngineInput["history"]) =>
  history.findLast((message) => message.sender === "shopper")?.text ?? "";

const isWriteTool =(name: string) => Object.hasOwn(tools, name) && tools[name as keyof typeof tools].writes;

export async function runEngine(rawInput: EngineInput, partialDeps: Partial<EngineDeps> = {}): Promise<EngineResult> {
  const deps = resolveDeps(partialDeps);
  const { now } = deps;
  const t0 = now();
  const input = engineInputSchema.parse(rawInput);
  const mode = input.mode;

  if (mode === "staff_draft" && !deps.staffShopId) throw new EngineError("staff_shop_not_resolved");
  // PB-20: a complaint gets "reply personally", not a draft. Decided by the server
  // before any model call, so it costs nothing and logs no turn.
  if (mode === "staff_draft" && isComplaint(lastShopperText(input.history))) {
    return {
      output: { reply: { text: PERSONAL_REPLY_TEXT, products: [], quickReplies: [] }, personalReplyNeeded: true },
      handoffReason: null,
      turnLogged: Promise.resolve(null),
    };
  }
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
  const pairingState: { called: boolean; failed: boolean; needsProduct: boolean; items: ToolOutput<"get_pairings">["pairings"] } = {
    called: false, failed: false, needsProduct: false, items: [],
  };
  let knownSize = knownShopperSize(input.history);
  let reply: Reply | null = null;
  let personalReplyNeeded = false;
  let productMissedTwice = false;

  // PB-10: Jev routes the turn; orders, unsure turns and Jev failures fall back
  // to the LLM tool loop below.
  let route: NonNullable<TurnMetrics["route"]> = { path: "llm_loop", fallbackReason: deps.jev ? undefined : "no_jev" };
  let routed: RouteOutcome | null = null;
  if (deps.jev) {
    const runTool: ToolRunner = async (name, toolInput) => {
      calls += 1;
      const s0 = now();
      const run = await executeTool(name, toolInput, ctx, mode, deps.handlers, deps.db);
      if (run.log) logs.push(run.log);
      toolMetrics.push({ name, startMs: s0 - t0, ms: now() - s0, outcome: toolOutcome(run) });
      seen.push({ name, input: toolInput });
      return run.isError ? { ok: false, output: undefined, code: toolOutcome(run) } : { ok: true, output: run.log?.output };
    };
    try {
      const catalog: CatalogItem[] = deps.store.catalog ? await deps.store.catalog(ctx.shopId) : [];
      const decision = await decideTurn(deps.jev, { history: input.history, viewing: tc.product, catalog, now });
      route = {
        path: "router",
        jevModel: decision.model,
        jevMs: decision.ms,
        jevCost: decision.cost,
        intent: decision.intent,
        confidence: decision.confidence,
        product: decision.product.kind,
        discountTrick: decision.discountTrick,
      };
      routed = await routeTurn({
        mode,
        history: input.history,
        decision,
        viewing: tc.product,
        catalog,
        runTool,
        cards: (ids) => deps.store.productCards(ctx.shopId, ids),
      });
      if (routed.kind === "fallback") {
        route = { ...route, path: "llm_loop", fallbackReason: routed.reason };
        routed = null;
      }
    } catch (e) {
      console.error("engine: jev routing failed, using the tool loop", e);
      route = { ...route, path: "llm_loop", fallbackReason: "jev_error" };
      routed = null;
    }
  }

  if (routed) {
    switch (routed.kind) {
      case "handoff":
        handoff = routed.reason;
        sizeStatus = routed.sizeStatus;
        // handoff_to_staff moved the conversation already, unless it failed.
        if (!routed.viaTool) await deps.store.setNeedsHuman(ctx);
        reply = { text: handoffText(handoff, sizeStatus), products: [], quickReplies: [] };
        break;
      case "personal":
        personalReplyNeeded = true;
        reply = { text: PERSONAL_REPLY_TEXT, products: [], quickReplies: [] };
        break;
      case "fixed":
        reply = routed.reply;
        break;
      case "write": {
        const replySystem = buildReplySystemPrompt({ mode, product: tc.product, facts: routed.facts, task: routed.task });
        detail.system = replySystem.map((b) => b.text).join("\n\n");
        const c0 = now();
        let firstTokenAt: number | null = null;
        const res = await deps.model.create(
          {
            model: deps.modelName,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: replySystem,
            messages,
            output_config: { effort: "low", format: { type: "json_schema", schema: MODEL_REPLY_JSON_SCHEMA } },
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
        if (deps.captureContent) detail.calls.push({ messages: messages.slice(), output: res.content });
        inputTokens += res.usage.input_tokens;
        outputTokens += res.usage.output_tokens;
        if (res.stop_reason === "max_tokens") {
          console.error("engine: reply truncated at max_tokens");
          truncated = true;
          reply = { text: FALLBACK_TEXT, products: [], quickReplies: [] };
          break;
        }
        const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const parsed = parseModelReply(text).reply;
        finalFirstTokenAt = firstTokenAt;
        // Cards are the server's choice (graded by PB-10), never the model's ids.
        reply = {
          text: parsed.text,
          products: await deps.store.productCards(ctx.shopId, routed.productIds),
          quickReplies: parsed.quickReplies,
        };
        break;
      }
    }
  }

  if (!routed) {
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
      // recommend_size gets the height and weight the shopper actually wrote
      // ("1m65", "58 ký"), parsed deterministically; see measurements.ts.
      const effectiveInput = u.name === "get_pairings" && u.input && typeof u.input === "object"
        ? { ...u.input, ...(tc.product ? { productId: tc.product.id } : {}), ...(knownSize ? { size: knownSize } : {}) }
        : u.name === "recommend_size"
          ? normalizeSizeInput(u.input, input.history)
          : u.input;
      const run = await executeTool(u.name, effectiveInput, ctx, mode, deps.handlers, deps.db);
      return { run, ms: now() - s0, startMs: s0 - t0 };
    });

    // runs are in tool_use order.
    uses.forEach((u, i) => {
      const { run, ms, startMs } = runs[i];
      if (run.log) logs.push(run.log);
      toolMetrics.push({ name: u.name, startMs, ms, outcome: toolOutcome(run) });
      seen.push({ name: u.name, input: u.input });
      if (u.name === "recommend_size" && !run.isError) sizeStatus = sizeStatusOf(run.content);
      if (u.name === "recommend_size" && !run.isError && !knownSize) {
        const size = (run.log?.output as { status?: string; size?: string } | undefined);
        if (size?.status === "ok") knownSize = size.size ?? null;
      }
      if (u.name === "get_pairings") {
        pairingState.called = true;
        if (run.isError) pairingState.failed = true;
        if (!run.isError) pairingState.items.push(...tools.get_pairings.output.parse(run.log?.output).pairings);
      }
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

  // PB-05: the product name matched nothing last turn (the AI asked one
  // clarifying question) and the shopper's answer matches nothing again. The
  // engine hands off itself; the model's second guess is not sent.
  productMissedTwice = mode === "customer" && !handoff && !truncated && tc.previousTurnMissedProduct === true
    && answersAiMessage(input.history) && searchMissed(logs);
  if (productMissedTwice) handoff = "misunderstood_twice";

  // A matching question must not depend on the model remembering the tool. If
  // it forgot, query the product the shopper is viewing on the server. Without
  // a product, ask which item they mean instead of showing invented matches.
  if (mode === "customer" && !handoff && !truncated && modelReply && isMatchingQuestion(input.history) && !pairingState.called) {
    pairingState.called = true;
    if (tc.product && calls < MAX_TOOL_CALLS) {
      const toolInput = { productId: tc.product.id, ...(knownSize ? { size: knownSize } : {}) };
      const started = now();
      const run = await executeTool("get_pairings", toolInput, ctx, mode, deps.handlers, deps.db);
      toolMetrics.push({ name: "get_pairings", startMs: started - t0, ms: now() - started, outcome: toolOutcome(run) });
      if (run.log) logs.push(run.log);
      pairingState.failed = run.isError;
      if (!run.isError) pairingState.items.push(...tools.get_pairings.output.parse(run.log?.output).pairings);
    } else {
      pairingState.needsProduct = !tc.product;
      pairingState.failed = Boolean(tc.product);
    }
  }

  if (handoff && mode === "customer") {
    // Must finish before returning: the caller sends HANDOFF_TEXT right after.
    // (A handoff_to_staff call already moved the conversation itself.)
    if (handoff === "too_many_tool_calls" || productMissedTwice) await deps.store.setNeedsHuman(ctx);
    const text = productMissedTwice ? PRODUCT_NOT_FOUND_HANDOFF_TEXT : handoffText(handoff, sizeStatus);
    reply = { text, products: [], quickReplies: [] };
  } else if (handoff) {
    reply = { text: STAFF_DRAFT_GIVE_UP_TEXT, products: [], quickReplies: [] };
  } else if (truncated || !modelReply) {
    reply = { text: FALLBACK_TEXT, products: [], quickReplies: [] };
  } else if (pairingState.called) {
    const cards = pairingState.items.length === 0
      ? []
      : await deps.store.productCards(ctx.shopId, pairingState.items.map((pairing) => pairing.productId));
    reply = pairingState.needsProduct
      ? { text: "Bạn muốn phối cùng sản phẩm nào? Hãy chọn món hoặc cho shop biết tên sản phẩm nhé.", products: [], quickReplies: [] }
      : pairingState.failed && pairingState.items.length === 0
        ? { text: "Shop chưa kiểm tra được món phối lúc này. Vui lòng thử lại sau nhé.", products: [], quickReplies: [] }
        : matchingReply(pairingState.items, cards);
  } else {
    reply = {
      text: modelReply.text,
      // Cards come from the database for this shop only; foreign ids drop out.
      products: await deps.store.productCards(ctx.shopId, modelReply.productIds),
      quickReplies: modelReply.quickReplies,
    };
  }
  } // end of the LLM tool loop path
  // A complaint the word list catches returned early above (PB-20); one only Jev
  // caught sets personalReplyNeeded here.
  const output = engineOutputSchema.parse({ reply: reply!, personalReplyNeeded });
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
    route,
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
