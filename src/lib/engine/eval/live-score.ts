// Scoring helpers of the live acceptance run (pnpm eval:live). Pure: no IO.
// Every expected number comes from the shop snapshot or the turn's tool results,
// never from a number typed into a case.
import { findUnbackedDiscount } from "../discount-guard.ts";
import { fold } from "../text.ts";
import type {
  AiTurn,
  CheckResult,
  RunRecord,
  ShopSnapshot,
  SnapshotProduct,
  TurnRecord,
} from "./live-types.ts";

// receive.ts HANDOFF_TEXT (server-only, so not importable here; a test keeps them equal).
// Sent with no ai_turns row, it means the engine threw: an infra error, not an AI answer.
export const ENGINE_FAILURE_TEXT = "Cảm ơn bạn! Nhân viên shop sẽ trả lời bạn ngay.";

const VND = new Intl.NumberFormat("vi-VN");
export const formatVnd = (n: number) => `${VND.format(n)}đ`;

// ---------- reading a turn ----------

export const replyText = (turn: TurnRecord) => turn.replies.map((r) => r.text).join("\n");
export const replyCards = (turn: TurnRecord) => turn.replies.flatMap((r) => r.products);
export const lastTurn = (run: RunRecord): TurnRecord | undefined => run.turns.at(-1);
export const toolCalls = (turn: TurnRecord) => turn.aiTurn?.toolCalls ?? [];
export const calledTool = (turn: TurnRecord, name: string, input?: Record<string, unknown>) =>
  toolCalls(turn).some(
    (c) =>
      c.name === name &&
      (!input || Object.entries(input).every(([k, v]) => (c.input as Record<string, unknown> | null)?.[k] === v)),
  );

// ---------- money and stock in a reply ----------

export type Amount = { raw: string; value: number };

// Money amounts in Vietnamese text: "389.000đ", "389,000 VND", "389000đ", "389k",
// "389 nghìn", "1.250.000". A bare number without separators or currency (a
// phone number, "7 ngày", "1m58") is not money.
export function extractAmounts(text: string): Amount[] {
  const t = fold(text);
  const found: Amount[] = [];
  const add = (raw: string, value: number) => {
    if (Number.isFinite(value) && value > 0) found.push({ raw: raw.trim(), value });
  };
  const re =
    /(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+|\d+)(\s*(?:k\b|nghin\b|ngan\b|trieu\b|d\b|vnd\b|dong\b))?/g;
  for (const m of t.matchAll(re)) {
    const [raw, digits, unitRaw] = m;
    const unit = unitRaw?.trim();
    const grouped = /[.,]\d{3}$/.test(digits);
    const base = Number(digits.replace(/[.,]/g, ""));
    if (unit === "k" || unit === "nghin" || unit === "ngan") add(raw, base * 1000);
    else if (unit === "trieu") add(raw, base * 1_000_000);
    else if (grouped) add(raw, base);
    else if (unit && base >= 1000) add(raw, base);
  }
  return found;
}

// Stock counts the reply claims: "còn 7 cái", "còn lại 2 chiếc", "tồn kho: 5".
export function extractStockClaims(text: string): number[] {
  const t = fold(text);
  const out: number[] = [];
  for (const m of t.matchAll(/\bcon(?: lai)? (\d+) (?:cai|chiec|san pham|mon|bo)\b/g)) out.push(Number(m[1]));
  for (const m of t.matchAll(/\bton kho:? (\d+)\b/g)) out.push(Number(m[1]));
  return out;
}

// Numbers in any JSON value (tool outputs: quote totals, line totals, stock).
function numbersIn(value: unknown, out: Set<number>) {
  if (typeof value === "number") out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
}

// Amounts a reply may state: every price in the shop, amounts in the shop's policy
// text, numbers the turn's tools returned (quote_order totals), and amounts the
// shopper wrote themselves ("bớt 50k").
export function allowedAmounts(snapshot: ShopSnapshot, turn: TurnRecord): Set<number> {
  const allowed = new Set<number>(snapshot.products.map((p) => p.price));
  for (const text of Object.values(snapshot.policies)) extractAmounts(text).forEach((a) => allowed.add(a.value));
  for (const call of toolCalls(turn)) numbersIn(call.output, allowed);
  extractAmounts(turn.shopper).forEach((a) => allowed.add(a.value));
  return allowed;
}

const productOf = (snapshot: ShopSnapshot, id: unknown) =>
  typeof id === "string" ? snapshot.products.find((p) => p.id === id) : undefined;

// Products a turn is about: the one on screen and every product a tool was called on.
function turnProducts(snapshot: ShopSnapshot, turn: TurnRecord): SnapshotProduct[] {
  const ids = new Set<string>();
  if (turn.productId) ids.add(turn.productId);
  for (const call of toolCalls(turn)) {
    const id = (call.input as { productId?: unknown } | null)?.productId;
    if (typeof id === "string") ids.add(id);
  }
  return [...ids].map((id) => productOf(snapshot, id)).filter((p): p is SnapshotProduct => !!p);
}

// The data checks every case gets (PB-07 spirit, "0 wrong prices or stock values"):
// amounts in the reply, card prices and sizes, and stock counts all match the data.
export function dataChecks(snapshot: ShopSnapshot, run: RunRecord): CheckResult[] {
  const checks: CheckResult[] = [];
  const badAmounts: string[] = [];
  const badCards: string[] = [];
  const badStock: string[] = [];
  for (const turn of run.turns) {
    const allowed = allowedAmounts(snapshot, turn);
    for (const reply of turn.replies) {
      for (const a of extractAmounts(reply.text)) if (!allowed.has(a.value)) badAmounts.push(a.raw);
      for (const card of reply.products) {
        const product = productOf(snapshot, card.productId);
        if (!product) badCards.push(`${card.name}: không có trong shop`);
        else if (product.price !== card.price) badCards.push(`${card.name}: ${formatVnd(card.price)} ≠ ${formatVnd(product.price)}`);
        else {
          const soldOut = card.sizesInStock.filter(
            (size) => !product.variants.some((v) => fold(v.size) === fold(size) && v.stock > 0),
          );
          if (soldOut.length) badCards.push(`${card.name}: size ${soldOut.join(", ")} đã hết`);
        }
      }
    }
    const claims = extractStockClaims(replyText(turn));
    if (claims.length) {
      const products = turnProducts(snapshot, turn);
      const stocks = new Set(products.flatMap((p) => p.variants.map((v) => v.stock)));
      for (const n of claims) if (!stocks.has(n)) badStock.push(String(n));
    }
  }
  checks.push({
    label: "Mọi số tiền trong câu trả lời có trong dữ liệu",
    ok: badAmounts.length === 0,
    detail: badAmounts.length ? `số tiền lạ: ${badAmounts.join(", ")}` : undefined,
  });
  checks.push({
    label: "Thẻ sản phẩm đúng giá và size còn hàng",
    ok: badCards.length === 0,
    detail: badCards.length ? badCards.join("; ") : undefined,
  });
  checks.push({
    label: "Số lượng tồn kho nêu ra khớp dữ liệu",
    ok: badStock.length === 0,
    detail: badStock.length ? `số tồn lạ: ${badStock.join(", ")}` : undefined,
  });
  return checks;
}

// ---------- phrases ----------

export const says = (text: string, phrase: string) => fold(text).includes(fold(phrase));
export const saysAny = (text: string, phrases: string[]) => phrases.some((p) => says(text, p));
export const saysPrice = (text: string, vnd: number) => extractAmounts(text).some((a) => a.value === vnd);
// The size letter as its own word: "size S", "S và L", "(M)".
export const saysSize = (text: string, size: string) =>
  new RegExp(`(^|[^a-z0-9])${fold(size).replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`).test(fold(text));
export const saysSoldOut = (text: string) =>
  /het hang|da het|het size|het mau|het roi|tam het|khong con/.test(fold(text));
export const saysStaffWillReply = (text: string) => /nhan vien|shop se (lien he|tra loi|phan hoi)/.test(fold(text));
export const questionCount = (text: string) => (text.match(/\?/g) ?? []).length;
// "size M", "size: M", "sz M" -> ["M"]; the order they appear in.
export function sizesNamed(text: string): string[] {
  return [...fold(text).matchAll(/\b(?:size|sz|co)\s*:?\s*(xxl|xl|xs|s|m|l)\b/g)].map((m) => m[1].toUpperCase());
}
export const noUnbackedDiscount = (text: string, snapshot: ShopSnapshot) =>
  findUnbackedDiscount(text, Object.values(snapshot.policies).filter((p) => p.trim() !== "")) === null;
// Share of the reason's words (3+ letters) found in the reply: the model may
// rephrase the owner's reason a little.
export function reasonOverlap(text: string, reason: string): number {
  const words = [...new Set(fold(reason).split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];
  if (words.length === 0) return 1;
  const t = fold(text);
  return words.filter((w) => t.includes(w)).length / words.length;
}
// Other products of the shop named in the reply (longest names first, so
// "Áo khoác jean" isn't also counted as "Áo khoác").
export function productsNamed(text: string, snapshot: ShopSnapshot): SnapshotProduct[] {
  let t = fold(text);
  const out: SnapshotProduct[] = [];
  for (const p of [...snapshot.products].sort((a, b) => b.name.length - a.name.length)) {
    const name = fold(p.name);
    if (name.length >= 6 && t.includes(name)) {
      out.push(p);
      t = t.replaceAll(name, " ");
    }
  }
  return out;
}

// ---------- check builders ----------

export const check = (label: string, ok: boolean, detail?: string): CheckResult => ({
  label,
  ok,
  detail: ok ? undefined : detail,
});

export function handoffCheck(turn: TurnRecord | undefined, expected: AiTurn["handoffReason"]): CheckResult {
  const got = turn?.aiTurn?.handoffReason ?? null;
  return check(
    expected === null ? "Không chuyển nhân viên (handoff_reason null)" : `handoff_reason = ${expected}`,
    turn?.aiTurn !== null && turn?.aiTurn !== undefined && got === expected,
    turn?.aiTurn ? `nhận ${got ?? "null"}` : "không có ai_turns cho lượt này",
  );
}

export function modeCheck(turn: TurnRecord | undefined, expected: "ai" | "needs_human"): CheckResult {
  return check(`Cuộc trò chuyện ở chế độ ${expected}`, turn?.modeAfter === expected, `đang ở ${turn?.modeAfter ?? "?"}`);
}

// PB-31 soft handoff (handoff-offer.ts; server-only, so copied here).
export const OFFER_QUESTION = "Bạn có muốn mình nhờ nhân viên shop trả lời thêm không?";
export const OFFER_YES = "Có, gặp nhân viên";
export const OFFER_NO = "Không cần";

// The turn offered staff for `reason` instead of handing off: it asks the offer
// question with the Có / Không quick replies, keeps the reason in
// ai_turns.handoff_offer, and the conversation stays with the AI.
export function offerChecks(turn: TurnRecord | undefined, reason: NonNullable<AiTurn["handoffReason"]>): CheckResult[] {
  const offer = turn?.aiTurn?.handoffOffer;
  const quick = turn?.replies.flatMap((r) => r.quickReplies) ?? [];
  return [
    check("Hỏi khách có muốn gặp nhân viên không", !!turn && says(replyText(turn), OFFER_QUESTION), "không có câu hỏi offer"),
    check(`Có nút “${OFFER_YES}” / “${OFFER_NO}”`, quick.includes(OFFER_YES) && quick.includes(OFFER_NO), `nút: ${quick.join(", ") || "không có"}`),
    check(
      `handoff_offer = ${reason}`,
      offer === reason,
      offer === undefined ? "ai_turns chưa có cột handoff_offer (chưa chạy migration PB-31)" : `nhận ${offer ?? "null"}`,
    ),
    handoffCheck(turn, null),
    modeCheck(turn, "ai"),
  ];
}

// ---------- infra errors ----------

// Why this turn says nothing about the AI (the deployment failed), or null.
export function classifyInfra(turn: TurnRecord): string | null {
  if (turn.httpStatus === null) return `Không gọi được server: ${turn.error ?? "lỗi mạng"}`;
  if (turn.httpStatus === 429) return `HTTP 429 (giới hạn tần suất): ${turn.error ?? ""}`.trim();
  if (turn.httpStatus >= 500) return `HTTP ${turn.httpStatus}: ${turn.error ?? ""}`.trim();
  if (turn.httpStatus >= 400) return `HTTP ${turn.httpStatus}: ${turn.error ?? ""}`.trim();
  if (turn.status === "rate_limited") return "PB-17 chặn vì nhắn quá nhanh (rate_limited)";
  if (!turn.aiTurn && turn.replies.some((r) => r.text.trim() === ENGINE_FAILURE_TEXT)) {
    return "Engine lỗi: trả câu chuyển nhân viên mặc định, không có ai_turns";
  }
  if (!turn.aiTurn && turn.replies.length === 0) return `Không có câu trả lời (status ${turn.status ?? "?"})`;
  return null;
}
