// PB-17 (eval 11/11): a refusal must not repeat the shopper's own numbers ("không
// giảm 50% được", "không đặt giá 0đ được"), and a discount demand the AI keeps
// mishandling is refused by the server instead of being handed to staff.
// Pure: no IO.
import type { HistoryMessage } from "@/contract";
import { fold } from "./text";

// Folded text with comparable numbers: "500.000đ" -> "500000d", "500k" -> "500000".
function prepare(text: string): string {
  return fold(text.normalize("NFC"))
    .replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1")
    .replace(/(\d+)\s*k\b/g, "$1000");
}

// Money amounts and percentages: "50%", "0d", "500000d", "200 nghin", "1 trieu",
// "gia 0". Plain numbers (sizes, heights, phone numbers, "2 cai") are not amounts.
const AMOUNT =
  /(\d+)\s*(%|phan tram|d\b|dong\b|vnd\b|nghin\b|ngan\b|trieu\b|tr\b)|\bgia\s+(?:la\s+|chi\s+|con\s+)?(\d+)\b/g;

export function amountsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of prepare(text).matchAll(AMOUNT)) {
    if (m[3] !== undefined) {
      out.push(String(Number(m[3])));
      continue;
    }
    const n = Number(m[1]);
    const unit = m[2];
    if (unit === "%" || unit === "phan tram") out.push(`${n}%`);
    else if (unit === "nghin" || unit === "ngan") out.push(String(n * 1000));
    else if (unit === "trieu" || unit === "tr") out.push(String(n * 1_000_000));
    else out.push(String(n));
  }
  return [...new Set(out)];
}

// Only price-like fields of the tool outputs, and the money amounts and
// percentages in shop policies (get_policy `content`), can back a shopper amount. Stock counts,
// sizes, ids and quantities must not: otherwise a get_stock with stock=1 makes
// a "giá 1đ" echo look backed. Walk the JSON keeping the key name.
const PRICE_KEYS = new Set(["price", "unitPrice", "lineTotal", "total"]);

const numbersIn = (outputs: unknown[]): Set<string> => {
  const out = new Set<string>();
  const walk = (value: unknown, key: string | null): void => {
    if (typeof value === "number") {
      if (key !== null && PRICE_KEYS.has(key)) out.add(String(value));
      return;
    }
    if (typeof value === "string") {
      // A policy backs only the money amounts and percentages it states:
      // "đổi hàng trong 7 ngày" must not back a "giá 7đ" echo.
      // Percentages stay "7%": they back a percentage, never a "7đ" price.
      if (key === "content") for (const a of amountsIn(value)) out.add(a);
      else if (key !== null && PRICE_KEYS.has(key)) {
        for (const n of prepare(value).match(/\d+/g) ?? []) out.add(String(Number(n)));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, item] of Object.entries(value)) walk(item, k);
    }
  };
  for (const output of outputs) walk(output, null);
  return out;
};

// The latest shopper messages: what this turn answers.
const RECENT_SHOPPER = 3;

// Amounts the reply repeats from the shopper's recent messages that none of this
// turn's tool outputs hold. "Váy giá 350.000đ" stays fine when get_stock returned
// 350000; "không đặt giá 0đ được" is an echo of the shopper's "0đ".
export function echoedShopperAmounts(reply: string, history: HistoryMessage[], toolOutputs: unknown[]): string[] {
  const shopper = new Set(
    history
      .filter((m) => m.sender === "shopper")
      .slice(-RECENT_SHOPPER)
      .flatMap((m) => amountsIn(m.text)),
  );
  if (shopper.size === 0) return [];
  const backed = numbersIn(toolOutputs);
  return amountsIn(reply).filter((a) => shopper.has(a) && !backed.has(a));
}

// The shopper's latest message asks for a lower price, a discount, a gift, a
// code or a free service, or names a price of their own ("giá 0đ", "để 200k").
const OFFER_WORDS =
  /\bgiam\b|\bbot\b|chiet khau|\bdiscount|\boff\b|\bsale|voucher|coupon|\bma (giam|khuyen mai|uu dai)|\bma [a-z]*\d|mien phi|\bfree\b|\bfree\W?ship|\btang (qua|kem|minh|em|toi)\b|qua tang|\bqua\s+(khong|ko|k)\b|khuyen mai|uu dai|\bdoi gia|\bsua gia|re hon/;

export function shopperAsksForOffer(history: HistoryMessage[]): boolean {
  const last = history.findLast((m) => m.sender === "shopper")?.text ?? "";
  return OFFER_WORDS.test(prepare(last)) || amountsIn(last).length > 0;
}

export const ECHO_RETRY_NOTE =
  "[Kiểm tra của hệ thống, không phải lời khách] Câu trả lời vừa rồi nhắc lại số tiền, % hoặc giá mà khách tự đưa ra, không có trong dữ liệu của shop. Viết lại: không nhắc lại con số đó; chỉ nêu giá lấy từ tool, hoặc từ chối chung (vd. \"shop không đổi giá được\").";

// Sent instead of a handoff when the shopper asked for a discount or a price of
// their own and the AI's reply still failed the checks after one retry. The
// conversation stays with the AI (Scrum Master, 07/11).
export const REFUSAL_TEXT =
  "Dạ, giá và ưu đãi theo đúng niêm yết của shop nên mình không đổi được ạ. Bạn cần mình tư vấn món nào không?";
