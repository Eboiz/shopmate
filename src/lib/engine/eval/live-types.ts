// Shapes of the live acceptance run (pnpm eval:live) against a deployed web chat.
// Pure types: scripts/eval-live.ts runs these files under plain Node, so imports
// in the live-*.ts files carry their .ts extension and only types come from "@/contract".
import type { ConversationMode, HandoffReason } from "@/contract";
import type { SizeChartRow } from "../tools/size-recommendation.ts";

export type Issue = "PB-04" | "PB-05" | "PB-06" | "PB-08" | "PB-09" | "PB-11" | "PB-14" | "PB-17";

export type SnapshotVariant = { id: string; size: string; color: string; stock: number };
export type SnapshotProduct = {
  id: string;
  code: string | null;
  name: string;
  price: number;
  description: string | null;
  variants: SnapshotVariant[];
  sizeChart: SizeChartRow[];
};
// The shop's data as the database holds it when the run starts (read only).
export type ShopSnapshot = {
  shopId: string;
  slug: string;
  name: string;
  products: SnapshotProduct[];
  pairings: { productA: string; productB: string; reason: string }[];
  // Empty string: the shop has no such policy.
  policies: { doi_tra: string; giao_hang: string; khuyen_mai: string };
};

export type ReplyCard = { productId: string; name: string; price: number; sizesInStock: string[] };
export type ShopReply = {
  sender: "ai" | "staff" | "system";
  text: string;
  products: ReplyCard[];
  quickReplies: string[];
};
export type ToolCall = { name: string; input: unknown; output?: unknown; error?: string };
// One ai_turns row of the conversation (read only).
export type AiTurn = {
  id: string;
  createdAt: string;
  toolCalls: ToolCall[];
  handoffReason: HandoffReason | null;
  // PB-31: the reason the turn offered staff (soft handoff), null when it made no offer.
  // Undefined: the database has no ai_turns.handoff_offer column yet (before PB-31).
  handoffOffer?: HandoffReason | null;
  model: string | null;
  promptVersion: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};
export type OrderRecord = {
  id: string;
  status: string;
  total: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: { variantId: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

// One shopper message and everything it caused.
export type TurnRecord = {
  shopper: string;
  productId: string | null;
  // null: the request never got an HTTP answer (network error, timeout).
  httpStatus: number | null;
  // `status` of the POST body (answered, handed_off, ...) or its `error`.
  status: string | null;
  error: string | null;
  // Wall-clock time of the POST, which includes the whole AI turn.
  wallMs: number;
  // Shop messages stored after this shopper message (AI reply, handoff notice).
  replies: ShopReply[];
  // The ai_turns row this message produced, if any.
  aiTurn: AiTurn | null;
  modeAfter: ConversationMode | null;
};

export type RunRecord = {
  conversationId: string | null;
  turns: TurnRecord[];
  // Orders of this conversation after the last turn.
  orders: OrderRecord[];
  // Stock after the run of the variants the case watches (variant id -> stock).
  stockAfter: Record<string, number>;
};

export type CheckResult = { label: string; ok: boolean; detail?: string };
// infra: the deployment failed (HTTP 429/5xx, engine error), not the AI.
// skip: the shop's data doesn't meet the case's precondition.
export type RunOutcome = "pass" | "fail" | "infra" | "skip";

export type RunResult = {
  caseId: string;
  issue: Issue;
  run: number;
  outcome: RunOutcome;
  reason: string;
  checks: CheckResult[];
  record: RunRecord;
  model: string | null;
  promptVersion: string | null;
  wallMs: number;
  tokens: { input: number; output: number };
  startedAt: string;
};

export type CaseResults = {
  id: string;
  issue: Issue;
  title: string;
  viewing: string | null;
  turns: string[];
  runs: RunResult[];
};

export const RESULTS_KIND = "shopmate-live-eval";

export type LiveResults = {
  kind: typeof RESULTS_KIND;
  version: 1;
  startedAt: string;
  finishedAt: string;
  base: string;
  shop: string;
  runsPerCase: number;
  group: number | null;
  filters: { case: string | null; issue: string | null };
  fake: boolean;
  snapshot: ShopSnapshot;
  cases: CaseResults[];
  // Why the run stopped before the end (two infra errors in a row), else null.
  stopped: string | null;
};
