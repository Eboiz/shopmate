// PB-09 (F3, F4): two customer handoffs the model must not make. Both are refused
// as an error tool result, so the model gets one more try with the reason spelled
// out, and the refused call never counts as a handoff. Pure: no IO.
import type { HistoryMessage, ToolCallLog } from "@/contract";
import { findUnbackedDiscount } from "./discount-guard";

export type RefusedHandoff = { code: "policy_has_text" | "discount_refusal"; message: string };

// Sent to the model instead of the handoff result (F3): the shop wrote the policy,
// so the answer comes from its text.
export const POLICY_HAS_TEXT_ERROR =
  "Chính sách shop đã có nội dung. Trả lời khách đúng theo nội dung đó; nếu nội dung không nói tới điều khách hỏi thì dùng reason policy_not_covered.";

// Sent to the model instead of the handoff result (F4): a discount ask is refused
// in the reply, not sent to staff.
export const DISCOUNT_REFUSAL_ERROR =
  "Khách đòi giảm giá: không chuyển nhân viên. Từ chối lịch sự, shop không giảm thêm ngoài giá niêm yết và khuyến mãi shop đã viết.";

// Tools whose output is product data: a turn that read one may legitimately hand
// off not_covered_by_data (the policy text is not the answer to that question).
const PRODUCT_TOOLS: ReadonlySet<string> = new Set([
  "search_products",
  "get_stock",
  "recommend_size",
  "get_pairings",
  "quote_order",
  "create_draft_order",
]);

const okLogs = (logs: readonly ToolCallLog[]) => logs.filter((log) => log.error === undefined);
const policyLogs = (logs: readonly ToolCallLog[]) => okLogs(logs).filter((log) => log.name === "get_policy");
const policyContent = (log: ToolCallLog) => (log.output as { content?: unknown } | undefined)?.content;
const policyKind = (log: ToolCallLog) => (log.input as { kind?: unknown } | null)?.kind;

const latestShopperText = (history: readonly HistoryMessage[]) =>
  history.findLast((message) => message.sender === "shopper")?.text ?? "";

// A handoff_to_staff input and the turn's logs; returns the refusal to send back,
// or null when the handoff stands. Customer mode only (the caller checks it).
export function refusedHandoff(
  input: unknown,
  logs: readonly ToolCallLog[],
  history: readonly HistoryMessage[],
): RefusedHandoff | null {
  const reason = (input as { reason?: unknown } | null)?.reason;
  if (reason !== "not_covered_by_data" && reason !== "policy_not_covered") return null;
  const policies = policyLogs(logs);

  // F3: get_policy returned text this turn and no product tool ran, so the answer
  // is the policy text, not a handoff. policy_not_covered stays allowed: the text
  // may exist and still not answer the question (PB-09 AC2).
  if (reason === "not_covered_by_data") {
    const hasText = policies.some((log) => policyContent(log) !== null && policyContent(log) !== undefined);
    const productTool = okLogs(logs).some((log) => PRODUCT_TOOLS.has(log.name));
    return hasText && !productTool ? { code: "policy_has_text", message: POLICY_HAS_TEXT_ERROR } : null;
  }

  // F4: every get_policy this turn was khuyen_mai (empty or not: the shop's own
  // promotion text is quoted in the reply, never a reason to hand off) and the
  // latest shopper message asks for a discount: refuse politely instead.
  const promotionOnly = policies.length > 0 && policies.every((log) => policyKind(log) === "khuyen_mai");
  const shopperText = latestShopperText(history);
  const discountAsk = shopperText !== "" && findUnbackedDiscount(shopperText, []) !== null;
  return promotionOnly && discountAsk ? { code: "discount_refusal", message: DISCOUNT_REFUSAL_ERROR } : null;
}
