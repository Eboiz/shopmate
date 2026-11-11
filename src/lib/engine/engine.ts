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
import { DISCOUNT_HANDOFF_TEXT, DISCOUNT_RETRY_NOTE, findUnbackedDiscount, policyTextsFrom } from "./discount-guard";
import { executeTool, type ToolRun } from "./execute-tool";
import { refusedHandoff, type RefusedHandoff } from "./handoff-guard";
import { toModelMessages } from "./messages";
import { countDuplicateCalls, toolOutcome, type TurnDetail, type TurnMetrics } from "./metrics";
import { FALLBACK_TEXT, MODEL_REPLY_JSON_SCHEMA, parseModelReply } from "./model-reply";
import { checkPolicyCovers, decideTurn, jevFromEnv, type CatalogItem, type JevClient } from "./jev";
import { createLangfuseSink } from "./langfuse";
import { normalizeSizeInput } from "./measurements";
import { findUncheckedNumbers, NUMBER_HANDOFF_TEXT, NUMBER_RETRY_NOTE } from "./number-check";
import type { PostcheckLog } from "./postcheck-log";
import { answersAiMessage, productMissed, shopperTurnText } from "./misunderstood";
import { isOrderIntent, latestQuote, orderCreatedText, orderOutOfStockText, orderSummary, orderWriteError, sameQuote, type PendingQuote } from "./order-flow";
import { isMatchingQuestion, knownShopperSize, matchingReply } from "./pairing-suggestions";
import { buildReplySystemPrompt, buildSystemPrompt, PROMPT_VERSION } from "./prompt";
import { filterQuickReplies, type QuickReply } from "./quick-replies";
import { routeTurn, type RouteOutcome, type ToolRunner } from "./route";
import { replyMatchesSize, sizeCorrection, sizeFallbackText, sizesInToolOutputs, type SizeAdvice } from "./size-postcheck";
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

function blockedOrderRun(input: unknown, code: string, extra: object = {}): ToolRun {
  return {
    log: { name: "create_draft_order", input, error: code },
    content: JSON.stringify({ error: code, ...extra }),
    isError: true,
  };
}

// PB-09 (F3, F4): a refused handoff is an error tool_result, so the model answers
// from the data instead. isError means it is not counted as a handoff below.
function refusedHandoffRun(input: unknown, refused: RefusedHandoff): ToolRun {
  return {
    log: { name: "handoff_to_staff", input, error: refused.code },
    content: refused.message,
    isError: true,
  };
}

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
    // Accepts conversations in mode "ai" or "needs_human" (auto-resume when answerable).
    if (!tc.conversation || (tc.conversation.mode !== "ai" && tc.conversation.mode !== "needs_human")) {
      throw new EngineError("conversation_not_found");
    }
    ctx = { shopId: tc.conversation.shopId, conversationId: input.conversationId };
  } else {
    ctx = { shopId: deps.staffShopId!, conversationId: null };
  }

  // The shop's catalogue: read at most once per turn, shared by the Jev router
  // and the quick-reply check.
  let turnCatalog: CatalogItem[] | null = null;
  const loadCatalog = async (): Promise<CatalogItem[]> => {
    if (turnCatalog === null) turnCatalog = deps.store.catalog ? await deps.store.catalog(ctx.shopId) : [];
    return turnCatalog;
  };
  // PB-05: customer quick replies only name what the shop sells (staff_draft is
  // unchanged). No quick replies, no catalogue read. A failed read must not
  // lose the reply: filter against an empty catalogue, which keeps only the
  // replies that name no garment.
  const customerQuickReplies = async (replies: QuickReply[]): Promise<QuickReply[]> => {
    if (mode !== "customer" || replies.length === 0) return replies;
    try {
      return filterQuickReplies(replies, await loadCatalog());
    } catch (e) {
      console.error("engine: catalog read failed, filtering quick replies against an empty catalog", e);
      turnCatalog ??= [];
      return filterQuickReplies(replies, []);
    }
  };

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
  // PB-06 post-check: the last ok recommend_size result of this turn, the product
  // it was for, and whether the model already got its one retry.
  let sizeAdvice: { advice: SizeAdvice; productId: string } | null = null;
  let sizeRetried = false;
  let sizeFallback = false;
  let modelReply: ReturnType<typeof parseModelReply>["reply"] | null = null;
  let finalFirstTokenAt: number | null = null;
  const pairingState: { called: boolean; failed: boolean; needsProduct: boolean; items: ToolOutput<"get_pairings">["pairings"] } = {
    called: false, failed: false, needsProduct: false, items: [],
  };
  let knownSize = knownShopperSize(input.history);
  let reply: Reply | null = null;
  let quotedOrderPresented = false;
  let personalReplyNeeded = false;
  let productMiss = false;
  let productMissedTwice = false;
  let discountRetried = false;
  let discountBlocked = false;
  // PB-07: prices and stock in a model-written reply must be the tools'. One
  // rewrite; a second mismatch hands off with the product card (numberBlocked).
  let numberCheck: PostcheckLog["numberCheck"];
  let numberBlocked = false;
  const shopperText = shopperTurnText(input.history);
  const uncheckedNumbers = (text: string) =>
    mode === "customer" ? findUncheckedNumbers(text, logs, shopperText).map((issue) => issue.raw) : [];
  const previousQuote = tc.previousQuote ?? null;
  let currentQuote: PendingQuote | null = null;
  let orderResult: ToolOutput<"create_draft_order"> | null = null;
  let orderIssue: { code: string; missing?: string[] } | null = null;
  let createAttempted = false;

  // PB-10: Jev routes the turn; orders, unsure turns and Jev failures fall back
  // to the LLM tool loop below.
  let route: NonNullable<TurnMetrics["route"]> = { path: "llm_loop", fallbackReason: deps.jev ? undefined : "no_jev" };
  let routed: RouteOutcome | null = null;
  // PB-11: an order in progress (the last turn read back a quote) stays in the
  // tool loop, so "ok" / "đồng ý" is never routed as a greeting or unclear turn.
  const orderInProgress = mode === "customer" && (tc.previousQuote ?? null) !== null;
  if (deps.jev && orderInProgress) route = { path: "llm_loop", fallbackReason: "order_in_progress" };
  if (deps.jev && !orderInProgress) {
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
      const catalog = await loadCatalog();
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
        policyCovers: (policy) => checkPolicyCovers(deps.jev!, { history: input.history, policy }),
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
        // Same post-checks as the tool loop: an unreadable reply, a size other
        // than recommend_size's (PB-06) or an unbacked discount (PB-09) gets one
        // more try with the reason added to the task; after that the server's
        // own text (size) or a handoff (discount) is sent.
        const write = routed;
        // PB-05 AC3: the router's "which product do you mean" question is this
        // turn's miss; the second one in a row hands off before the reply model
        // runs (the guard is customer-only).
        productMiss = mode === "customer" && write.productMiss === true;
        if (productMiss && tc.previousTurnMissedProduct === true && answersAiMessage(input.history)) {
          productMissedTwice = true;
          handoff = "misunderstood_twice";
          await deps.store.setNeedsHuman(ctx);
          reply = { text: PRODUCT_NOT_FOUND_HANDOFF_TEXT, products: [], quickReplies: [] };
          break;
        }
        const otherSizes = () => sizesInToolOutputs(logs.filter((l) => l.name !== "recommend_size").map((l) => l.output));
        let task = write.task;
        for (let attempt = 1; ; attempt++) {
          const replySystem = buildReplySystemPrompt({ mode, product: tc.product, facts: write.facts, task });
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
          const canRetry = attempt < 2;
          if (res.stop_reason === "max_tokens") {
            console.error("engine: reply truncated at max_tokens");
            if (canRetry) continue;
            truncated = true;
            reply = { text: FALLBACK_TEXT, products: [], quickReplies: [] };
            break;
          }
          const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
          const parsed = parseModelReply(text);
          if (!parsed.ok) {
            // Seen with the gateway cutting a stream short: ask once more.
            console.error(`engine: unreadable reply (stop ${res.stop_reason}, ${text.length} chars)`);
            if (canRetry) continue;
            reply = { text: FALLBACK_TEXT, products: [], quickReplies: [] };
            break;
          }
          if (write.sizeAdvice && !replyMatchesSize(parsed.reply.text, write.sizeAdvice, otherSizes())) {
            if (canRetry) {
              task = `${write.task}\n${sizeCorrection(write.sizeAdvice)}`;
              continue;
            }
            reply = {
              text: sizeFallbackText(write.sizeAdvice),
              products: await deps.store.productCards(ctx.shopId, write.productIds),
              quickReplies: [],
            };
            break;
          }
          if (mode === "customer" && findUnbackedDiscount(parsed.reply.text, policyTextsFrom(logs)) !== null) {
            if (canRetry) {
              task = `${write.task}\n${DISCOUNT_RETRY_NOTE}`;
              continue;
            }
            handoff = "postcheck_failed";
            await deps.store.setNeedsHuman(ctx);
            reply = { text: DISCOUNT_HANDOFF_TEXT, products: [], quickReplies: [] };
            break;
          }
          const unchecked = uncheckedNumbers(parsed.reply.text);
          if (unchecked.length > 0 || numberCheck) numberCheck = { failed: unchecked, retried: numberCheck !== undefined };
          if (unchecked.length > 0) {
            if (canRetry) {
              task = `${write.task}\n${NUMBER_RETRY_NOTE}`;
              continue;
            }
            numberBlocked = true;
            handoff = "postcheck_failed";
            await deps.store.setNeedsHuman(ctx);
            const ids = tc.product ? [tc.product.id] : write.productIds;
            reply = { text: NUMBER_HANDOFF_TEXT, products: await deps.store.productCards(ctx.shopId, ids), quickReplies: [] };
            break;
          }
          finalFirstTokenAt = firstTokenAt;
          // Cards are the server's choice (graded by PB-10), never the model's ids.
          reply = {
            text: parsed.reply.text,
            products: await deps.store.productCards(ctx.shopId, write.productIds),
            quickReplies: await customerQuickReplies(parsed.reply.quickReplies),
          };
          break;
        }
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
      const parsed = parseModelReply(text);
      // sizeAdvice is set inside a callback; TS can't see it.
      const advice = (sizeAdvice as { advice: SizeAdvice } | null)?.advice;
      const otherSizes = () => sizesInToolOutputs(logs.filter((l) => l.name !== "recommend_size").map((l) => l.output));
      // A matching question gets a reply built from get_pairings, not this text.
      const sizeOk = !advice || !parsed.ok || isMatchingQuestion(input.history)
        || replyMatchesSize(parsed.reply.text, advice, otherSizes());
      if (!sizeOk && !sizeRetried) {
        // Ask once more, with the tool's size spelled out.
        sizeRetried = true;
        messages.push(
          { role: "assistant", content: res.content as Anthropic.ContentBlockParam[] },
          { role: "user", content: sizeCorrection(advice!) },
        );
        continue;
      }
      sizeFallback = !sizeOk;
      modelReply = parsed.reply;
      finalFirstTokenAt = firstTokenAt;
      // PB-09 AC3: a reply promising a discount the shop's policy text doesn't
      // offer gets one regeneration; a second one hands off (below the loop).
      if (mode === "customer" && modelReply && !pairingState.called
        && findUnbackedDiscount(modelReply.text, policyTextsFrom(logs)) !== null) {
        if (!discountRetried) {
          discountRetried = true;
          messages.push(
            { role: "assistant", content: res.content as Anthropic.ContentBlockParam[] },
            { role: "user", content: DISCOUNT_RETRY_NOTE },
          );
          continue;
        }
        discountBlocked = true;
      }
      // PB-07: only a reply the model wrote is checked; an order summary, a size
      // fallback or a pairing reply is written by the server from tool data.
      const serverWrites = orderResult !== null || currentQuote !== null || orderIssue !== null
        || sizeFallback || pairingState.called || isMatchingQuestion(input.history);
      if (!discountBlocked && modelReply && !serverWrites) {
        const unchecked = uncheckedNumbers(modelReply.text);
        const retried = numberCheck !== undefined;
        if (unchecked.length > 0 || retried) numberCheck = { failed: unchecked, retried };
        if (unchecked.length > 0 && !retried) {
          messages.push(
            { role: "assistant", content: res.content as Anthropic.ContentBlockParam[] },
            { role: "user", content: NUMBER_RETRY_NOTE },
          );
          continue;
        }
        numberBlocked = unchecked.length > 0;
      }
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
      if (u.name === "create_draft_order" && mode === "customer") {
        const issue = orderWriteError(u.input, input.history, previousQuote);
        if (issue) {
          orderIssue = issue;
          return { run: blockedOrderRun(u.input, issue.code, issue.missing ? { missing: issue.missing } : {}), ms: now() - s0, startMs: s0 - t0 };
        }
        if (createAttempted) {
          orderIssue = { code: "duplicate_order_call" };
          return { run: blockedOrderRun(u.input, "duplicate_order_call"), ms: now() - s0, startMs: s0 - t0 };
        }
        createAttempted = true;
        const candidate = u.input as { customerPhone?: unknown } | null;
        if (typeof candidate?.customerPhone === "string" && !/^0\d{9}$/.test(candidate.customerPhone)) {
          orderIssue = { code: "invalid_phone" };
        }
        if (tools.create_draft_order.input.safeParse(u.input).success) {
          // Prices may change between the summary and confirmation. Re-read the
          // same variants before writing; a changed quote needs a new approval.
          const quotedAt = now();
          const freshRun = await executeTool("quote_order", { items: previousQuote!.items }, ctx, mode, deps.handlers, deps.db);
          toolMetrics.push({ name: "quote_order", startMs: quotedAt - t0, ms: now() - quotedAt, outcome: toolOutcome(freshRun) });
          if (freshRun.log) logs.push(freshRun.log);
          const freshQuote = freshRun.log ? latestQuote([freshRun.log]) : null;
          if (freshRun.isError || !freshQuote) {
            orderIssue = { code: "quote_unavailable" };
            return { run: blockedOrderRun(u.input, "quote_unavailable"), ms: now() - s0, startMs: s0 - t0 };
          }
          if (!sameQuote(previousQuote!.quote, freshQuote.quote)) {
            currentQuote = freshQuote;
            orderIssue = { code: "quote_changed" };
            return { run: blockedOrderRun(u.input, "quote_changed"), ms: now() - s0, startMs: s0 - t0 };
          }
        }
      }
      // PB-09 (F3, F4): a handoff the shop's own data rules out is refused before
      // the tool runs; the model gets the reason back and answers instead.
      if (u.name === "handoff_to_staff" && mode === "customer") {
        const refused = refusedHandoff(u.input, logs, input.history);
        if (refused) return { run: refusedHandoffRun(u.input, refused), ms: now() - s0, startMs: s0 - t0 };
      }
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
      if (u.name === "recommend_size" && !run.isError) {
        sizeStatus = sizeStatusOf(run.content);
        const out = run.log?.output as { status?: string } | undefined;
        const productId = (run.log?.input as { productId?: string } | undefined)?.productId;
        if (out?.status === "ok" && productId) sizeAdvice = { advice: out as SizeAdvice, productId };
      }
      if (u.name === "recommend_size" && !run.isError && !knownSize) {
        const size = (run.log?.output as { status?: string; size?: string } | undefined);
        if (size?.status === "ok") knownSize = size.size ?? null;
      }
      if (u.name === "get_pairings") {
        pairingState.called = true;
        if (run.isError) pairingState.failed = true;
        if (!run.isError) pairingState.items.push(...tools.get_pairings.output.parse(run.log?.output).pairings);
      }
      if (mode === "customer" && u.name === "quote_order" && !run.isError && run.log && isOrderIntent(input.history)) {
        currentQuote = latestQuote([run.log]);
      }
      if (mode === "customer" && u.name === "create_draft_order" && !run.isError) {
        orderResult = tools.create_draft_order.output.parse(run.log?.output);
      }
    });

    const handedOff = uses.find((u, i) => u.name === "handoff_to_staff" && !runs[i].run.isError);
    if (handedOff) {
      handoff = (handedOff.input as { reason: HandoffReason }).reason;
      break;
    }
    if (orderResult || currentQuote) break;

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
  // miss is decided by the search for the shopper's own words (productMissed),
  // not by the broader queries the model also ran; a router turn logs no
  // search, so the previous turn's postcheck carries it (store.ts). The engine
  // hands off itself; the model's second guess is not sent.
  productMiss = mode === "customer"
    ? productMissed(logs, shopperTurnText(input.history), tc.product?.id ?? null)
    : false;
  productMissedTwice = mode === "customer" && !handoff && !truncated && tc.previousTurnMissedProduct === true
    && answersAiMessage(input.history) && productMiss;
  if (productMissedTwice) handoff = "misunderstood_twice";
  else if (discountBlocked || numberBlocked) handoff = "postcheck_failed";

  // PB-06 AC4: measurements outside the chart, or a product with no chart, always
  // end in a handoff, even when the model answered instead of calling
  // handoff_to_staff. (sizeStatus is set inside a callback; TS can't see it.)
  const finalSizeStatus = sizeStatus as SizeStatus;
  const sizeHandoff = mode === "customer" && !handoff && finalSizeStatus !== null;
  if (sizeHandoff) handoff = finalSizeStatus === "no_chart" ? "not_covered_by_data" : "size_out_of_range";

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

  // These are assigned inside the runBatch callback; TypeScript cannot see it.
  const finalOrderResult = orderResult as ToolOutput<"create_draft_order"> | null;
  const finalQuote = currentQuote as PendingQuote | null;
  const finalOrderIssue = orderIssue as { code: string; missing?: string[] } | null;
  if (handoff && mode === "customer") {
    // Must finish before returning: the caller sends HANDOFF_TEXT right after.
    // (A handoff_to_staff call already moved the conversation itself.)
    if (handoff === "too_many_tool_calls" || handoff === "postcheck_failed" || productMissedTwice || sizeHandoff) await deps.store.setNeedsHuman(ctx);
    const text = productMissedTwice
      ? PRODUCT_NOT_FOUND_HANDOFF_TEXT
      : discountBlocked ? DISCOUNT_HANDOFF_TEXT
      : numberBlocked ? NUMBER_HANDOFF_TEXT : handoffText(handoff, sizeStatus);
    // PB-07: the numbers the shopper gets come from the database card, not the
    // model's text: the viewed product, else the products the reply was about.
    const cardIds = handoff !== "postcheck_failed" ? []
      : tc.product ? [tc.product.id]
      : numberBlocked ? (modelReply?.productIds ?? []) : [];
    const products = cardIds.length > 0 ? await deps.store.productCards(ctx.shopId, cardIds) : [];
    reply = { text, products, quickReplies: [] };
  } else if (handoff) {
    reply = { text: STAFF_DRAFT_GIVE_UP_TEXT, products: [], quickReplies: [] };
  } else if (finalOrderResult?.status === "created") {
    reply = { text: orderCreatedText(), products: [], quickReplies: [] };
  } else if (finalOrderResult?.status === "out_of_stock") {
    const soldOutVariantIds = finalOrderResult.variantIds;
    const productIds = [...new Set((previousQuote?.quote.lines ?? [])
      .filter((line) => soldOutVariantIds.includes(line.variantId)).map((line) => line.productId))];
    const alternatives: ToolOutput<"get_stock">[] = [];
    for (const productId of productIds) {
      const started = now();
      const run = await executeTool("get_stock", { productId }, ctx, mode, deps.handlers, deps.db);
      toolMetrics.push({ name: "get_stock", startMs: started - t0, ms: now() - started, outcome: toolOutcome(run) });
      if (run.log) logs.push(run.log);
      if (!run.isError) alternatives.push(tools.get_stock.output.parse(run.log?.output));
    }
    reply = { text: orderOutOfStockText(soldOutVariantIds, previousQuote, alternatives), products: [], quickReplies: [] };
  } else if (finalQuote) {
    const previousShipping = logs.findLast((log) => log.name === "get_policy" && !log.error &&
      (log.input as { kind?: string } | null)?.kind === "giao_hang");
    let shippingPolicy = previousShipping
      ? tools.get_policy.output.parse(previousShipping.output).content
      : null;
    if (!previousShipping) {
      const started = now();
      const run = await executeTool("get_policy", { kind: "giao_hang" }, ctx, mode, deps.handlers, deps.db);
      toolMetrics.push({ name: "get_policy", startMs: started - t0, ms: now() - started, outcome: toolOutcome(run) });
      if (run.log) logs.push(run.log);
      if (!run.isError) shippingPolicy = tools.get_policy.output.parse(run.log?.output).content;
    }
    const summary = orderSummary(finalQuote.quote, shippingPolicy);
    quotedOrderPresented = summary !== null;
    reply = { text: summary ?? "Đơn có quá nhiều món để đọc lại trong một tin. Bạn chia thành các đơn nhỏ hơn giúp mình nhé.", products: [], quickReplies: [] };
  } else if (finalOrderIssue?.code === "invalid_phone") {
    reply = { text: "Số điện thoại chưa hợp lệ. Bạn gửi lại số di động Việt Nam gồm 10 chữ số, bắt đầu bằng 0 nhé.", products: [], quickReplies: [] };
  } else if (finalOrderIssue?.code === "customer_details_missing") {
    reply = { text: `Mình còn thiếu ${finalOrderIssue.missing?.join(", ")}. Bạn gửi giúp mình để tiếp tục đặt hàng nhé.`, products: [], quickReplies: [] };
  } else if (finalOrderIssue?.code === "quote_unavailable") {
    reply = { text: "Mình chưa kiểm tra lại được giá của đơn. Mình chưa tạo đơn; bạn thử lại sau nhé.", products: [], quickReplies: [] };
  } else if (finalOrderIssue?.code === "confirmation_required" || finalOrderIssue?.code === "order_items_changed") {
    reply = { text: "Mình cần báo giá đúng các món và xin bạn xác nhận bản tóm tắt trước khi tạo đơn. Bạn cho mình biết món, size, màu và số lượng muốn đặt nhé.", products: [], quickReplies: [] };
  } else if (truncated || !modelReply) {
    reply = { text: FALLBACK_TEXT, products: [], quickReplies: [] };
  } else if (sizeFallback && sizeAdvice) {
    // The model named a size the size function didn't return, twice: the reply
    // is written from the tool result, with the product's card from the database.
    const { advice, productId } = sizeAdvice as { advice: SizeAdvice; productId: string };
    reply = {
      text: sizeFallbackText(advice),
      products: await deps.store.productCards(ctx.shopId, [productId]),
      quickReplies: [],
    };
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
      quickReplies: await customerQuickReplies(modelReply.quickReplies),
    };
  }
  } // end of the LLM tool loop path
  // Auto-resume: if the conversation was in needs_human and the AI produced an
  // answer without handing off, move the conversation back to ai mode.
  if (mode === "customer" && tc.conversation?.mode === "needs_human" && handoff === null && !truncated) {
    await deps.store.setAiMode?.(ctx);
  }

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
        postcheck: { productMiss, ...(numberCheck ? { numberCheck } : {}) } satisfies PostcheckLog,
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

  if (quotedOrderPresented && await turnLogged === null) {
    return {
      output: engineOutputSchema.parse({
        reply: { text: "Mình chưa lưu được báo giá lúc này. Bạn thử lại giúp mình nhé.", products: [], quickReplies: [] },
        personalReplyNeeded: false,
      }),
      handoffReason: handoff,
      turnLogged,
    };
  }
  return { output, handoffReason: handoff, turnLogged };
}
