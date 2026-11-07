// PB-09 AC3: the AI never offers or agrees to a discount. A deterministic check
// on the reply text before it is sent; runEngine regenerates once, then hands off.
// Pure: no IO.
import type { ToolCallLog } from "@/contract";
import { fold } from "./text";

// Kinds of offer, on folded text (see prepare). A reply clause is backed only
// when the shop's policy text makes an offer of the same kinds.
const OFFER_KINDS: Record<string, RegExp> = {
  // "Free size" and "off-white" are product words, not offers.
  free: /mien phi|\bfree(?![\s-]*size)/,
  cut: /\bgiam\b|\bbot (gia|cho|\d)|chiet khau|\bdiscount|\boff\b(?![\s-]*white)|\bsale\b|dong gia/,
  code: /voucher|coupon|\bma giam|\bma khuyen mai|promo code/,
  // Without diacritics only "tang" + a recipient or "kèm/quà" ("tăng 1 size" is not a gift).
  gift: /\btangqua\b|qua tang|\btang (kem|qua|ban|em|chi|anh)\b|\bgift\b/,
};

// A clause with one of these is a refusal or a "no such offer", not a promise.
const NEGATION =
  /\b(khong|chua|chang|cha|ko|khg|da het|not|no|cannot|can't|cant|unable|don't|dont|won't|wont|isn't|aren't|doesn't)\b/;
// "Giảm giá thì nhân viên sẽ báo bạn": deferring to staff is not a promise,
// unless it names a number ("nhân viên giảm 20% cho bạn").
const DEFERS_TO_STAFF = /nhan vien|\bstaff\b/;

// Folded text with comparable numbers. "tặng" (give) folds to "tang" like
// "tăng" (increase), so it is marked before folding. "500.000đ" -> "500000d",
// "350,000" -> "350000", "500k" -> "500000".
function prepare(text: string): string {
  return fold(text.normalize("NFC").replace(/tặng/giu, " tangqua "))
    .replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1")
    .replace(/(\d+)k\b/g, "$1000");
}

const numbersIn = (text: string) => text.match(/\d+/g) ?? [];

// An offer made in one clause. sentenceNumbers: every number of its sentence,
// which holds the offer's conditions ("Đơn từ 500k, shop miễn phí ship").
type Offer = { clause: string; kinds: string[]; numbers: string[]; sentenceNumbers: string[] };

// The offers a text makes: sentences, split into clauses at commas and "but".
// A clause with no offer word, or one that says no, makes no offer.
function offersIn(text: string): Offer[] {
  return prepare(text)
    .split(/[.!?;\n]+/)
    .flatMap((sentence) => {
      const sentenceNumbers = numbersIn(sentence);
      return sentence.split(/,|\bnhung\b|\bbut\b|\btuy nhien\b|\bhowever\b/).flatMap((raw) => {
        const clause = raw.trim();
        const kinds = Object.keys(OFFER_KINDS).filter((k) => OFFER_KINDS[k].test(clause));
        if (kinds.length === 0 || NEGATION.test(clause)) return [];
        const numbers = numbersIn(clause);
        if (numbers.length === 0 && DEFERS_TO_STAFF.test(clause)) return [];
        return [{ clause, kinds, numbers, sentenceNumbers }];
      });
    });
}

// The first clause of the reply (folded) that offers a discount, gift or free
// service the policy texts don't offer, or null. An offer is backed when, for
// each kind it names, a policy sentence makes that kind of offer and the reply's
// sentence keeps that policy sentence's numbers (its conditions); and every
// number the clause names comes from those policy sentences. Quoting "Miễn phí
// giao hàng cho đơn từ 500.000đ" passes; "bạn được miễn phí ship" drops the
// 500.000đ condition and is flagged, like any offer no policy makes.
export function findUnbackedDiscount(reply: string, policyTexts: string[]): string | null {
  const backing = policyTexts.flatMap(offersIn);
  for (const offer of offersIn(reply)) {
    const backers = offer.kinds.map((k) =>
      backing.filter((b) => b.kinds.includes(k) && b.sentenceNumbers.every((n) => offer.sentenceNumbers.includes(n))),
    );
    const allowed = new Set(backers.flat().flatMap((b) => b.sentenceNumbers));
    if (backers.some((b) => b.length === 0) || !offer.numbers.every((n) => allowed.has(n))) return offer.clause;
  }
  return null;
}

// The policy texts get_policy returned this turn (null content = shop wrote nothing).
export function policyTextsFrom(logs: ToolCallLog[]): string[] {
  return logs.flatMap((log) => {
    const content = (log.output as { content?: unknown } | undefined)?.content;
    return log.name === "get_policy" && typeof content === "string" ? [content] : [];
  });
}

// Sent to the model as the next user turn when its reply promised an unbacked
// discount; the model gets one more try, then the engine hands off.
export const DISCOUNT_RETRY_NOTE =
  "[Kiểm tra của hệ thống, không phải lời khách] Câu trả lời vừa rồi hứa giảm giá, quà tặng hoặc miễn phí mà chính sách của shop (get_policy) không có. Viết lại câu trả lời: không hứa giảm giá, tặng quà hay miễn phí; khách đòi giảm giá thì nói shop không tự giảm giá được.";

export const DISCOUNT_HANDOFF_TEXT =
  "Dạ, giá và ưu đãi do shop quyết định nên mình đã chuyển câu hỏi của bạn cho nhân viên shop. Nhân viên sẽ trả lời bạn sớm nhé!";
