// PB-31 soft handoff (PO approved 07/11/2026). When the AI has only part of the
// answer it says what the data says, says what it doesn't know, and OFFERS staff
// with two quick replies. Only a "yes" on the next turn hands off, with the
// reason the offer was made for. Complaints, asking for a human and two
// misunderstood turns still hand off at once (PB-14).
import type { HandoffReason, Reply, ToolCallLog } from "@/contract";
import { isOrderMessage } from "./order-flow";
import { isReturnsQuestion } from "./product-match";
import { fold } from "./text";

export const OFFER_YES = "Có, gặp nhân viên";
export const OFFER_NO = "Không cần";
export const OFFER_QUESTION = "Bạn có muốn mình nhờ nhân viên shop trả lời thêm không?";
export const OFFER_QUICK_REPLIES = [OFFER_YES, OFFER_NO];
export const OFFER_DECLINED_TEXT = "Dạ vâng. Bạn cần tư vấn thêm món nào cứ nhắn mình nhé!";

// The reasons a turn may offer staff for instead of handing off.
export const OFFER_REASONS = ["not_covered_by_data", "policy_not_covered", "size_out_of_range"] as const satisfies readonly HandoffReason[];
export type OfferReason = (typeof OFFER_REASONS)[number];

// Server texts for size turns: the size function decides, the model never phrases
// a size it could get wrong.
export function sizeOfferText(out: { nearestSize: string; offCm: number; offKg: number } | null): string {
  if (out === null) return `Dạ, sản phẩm này shop chưa có bảng size nên mình chưa tư vấn được size. ${OFFER_QUESTION}`;
  if (isNearChart(out)) {
    return `Dạ, số đo của bạn hơi vượt bảng size của sản phẩm này. Size gần nhất shop có là ${out.nearestSize}, có thể sẽ hơi vừa sát người. ${OFFER_QUESTION}`;
  }
  return `Dạ, số đo của bạn nằm ngoài bảng size của sản phẩm này nên mình chưa tư vấn được size. ${OFFER_QUESTION}`;
}

// Up to 3 cm and 3 kg past the chart: the nearest size may still be worth naming.
export const NEAR_CHART_CM = 3;
export const NEAR_CHART_KG = 3;
export function isNearChart(out: { offCm: number; offKg: number }): boolean {
  return out.offCm <= NEAR_CHART_CM && out.offKg <= NEAR_CHART_KG;
}

export function offerReply(text: string): Reply {
  return { text, products: [], quickReplies: OFFER_QUICK_REPLIES };
}

// The shopper's answer to an offer. Short replies only: a longer message is a new
// question and goes through the normal turn.
const YES = /^(co|co a|co nhe|co nha|co chu|vang|vang a|da|da co|ok|oke|okay|uh|u|dong y|duoc|co gap nhan vien|gap nhan vien|cho gap nhan vien|nho nhan vien|nho nhan vien giup|can|co can)$/;
const NO = /^(khong|khong can|khong a|ko|k|ko can|k can|thoi|thoi khong can|khoi|khong can dau|chua can)$/;

export type OfferAnswer = "yes" | "no" | null;
export function offerAnswer(text: string): OfferAnswer {
  const t = fold(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (t === fold(OFFER_YES) || YES.test(t)) return "yes";
  if (t === fold(OFFER_NO) || NO.test(t)) return "no";
  return null;
}

// Whether a model reply offered staff (LLM tool loop): it carries the yes button,
// or asks the offer question without it.
export const offersStaff = (reply: { text?: string; quickReplies: string[] }) =>
  reply.quickReplies.includes(OFFER_YES) || (reply.text ?? "").includes(OFFER_QUESTION);

// The shopper names a person to talk to (staff, the owner, a real person). An
// order like "cho mua 1 áo blazer" names none, so it is never asked_for_human.
const HUMAN = /\b(nhan vien|nguoi that|nguoi ban hang|nguoi tu van|tu van vien|admin|quan ly|chu (shop|cua hang|tiem)|(gap|keu|goi) chu|chu ra)\b/;
export const asksForHuman = (text: string) => HUMAN.test(fold(text).replace(/[^a-z0-9 ]+/g, " "));

// LLM tool loop: a handoff the shopper's message and this turn's tools don't
// support is sent back to the model once, with what to do instead. null: let it run.
export function handoffCorrection(reason: unknown, text: string, logs: readonly ToolCallLog[]): string | null {
  if (reason === "asked_for_human" && isOrderMessage(text) && !asksForHuman(text)) {
    return "Khách muốn đặt hàng, không đòi gặp người. Không chuyển nhân viên: xác nhận lại món, màu, size khách muốn đặt rồi tiếp tục luồng đặt hàng.";
  }
  const readReturns = logs.some((l) => l.name === "get_policy" && (l.input as { kind?: unknown } | null)?.kind === "doi_tra");
  if ((reason === "not_covered_by_data" || reason === "policy_not_covered") && isReturnsQuestion(text) && !readReturns) {
    return "Khách hỏi đổi trả: gọi get_policy với kind doi_tra và trả lời từ nội dung đó trước.";
  }
  const foundClose = logs.some((l) => l.name === "search_products" && !l.error
    && ((l.output as { products?: unknown[] } | undefined)?.products?.length ?? 0) > 0);
  if (reason === "product_not_found" && foundClose) {
    return "search_products đã tìm thấy món gần giống. Không chuyển nhân viên: hỏi khách \"Ý bạn là A hay B?\" với tối đa 3 tên món đó trong quickReplies.";
  }
  return null;
}
