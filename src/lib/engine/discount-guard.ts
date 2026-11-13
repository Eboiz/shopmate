// PB-09 AC3: the AI never offers or agrees to a discount. A deterministic check
// on the reply text before it is sent; runEngine regenerates once, then hands off.
// Pure: no IO.
import type { ToolCallLog } from "@/contract";
// With the extension: scripts/eval-live.ts runs this file under plain Node.
import { fold } from "./text.ts";

// Kinds of offer, on folded text (see prepare). A reply clause is backed only
// when the shop's policy text makes an offer of the same kinds. Global: every
// occurrence in a clause is checked for a governing negation.
const OFFER_KINDS: Record<string, RegExp> = {
  // "Free size" and "off-white" are product words, not offers.
  free: /mien phi|\bfree(?![\s-]*size)/g,
  cut: /\bgiam\b|\bbot (gia|cho|\d)|chiet khau|\bdiscount|\boff\b(?![\s-]*white)|\bsale\b|dong gia/g,
  code: /voucher|coupon|\bma giam|\bma khuyen mai|promo code/g,
  // Without diacritics only "tang" + a recipient or "kèm/quà" ("tăng 1 size" is not a gift).
  gift: /\btangqua\b|qua tang|\btang (kem|qua|ban|em|chi|anh)\b|\bgift\b/g,
};

const NEGATION_WORD =
  /^(khong|chua|chang|cha|ko|khg|het|not|no|cannot|can't|cant|unable|don't|dont|won't|wont|isn't|aren't|doesn't)$/;
// Set phrases with a "no" in them that refuse nothing: "không cần mã", "không mất
// phí", "không sao", "no problem". Blanked out before looking for a negation, so
// "không sao mình giảm cho bạn" is still an offer.
const NOT_A_REFUSAL = /\b(khong (sao|lo|can|mat|van de|ngai)|no (problem|worries)|don'?t worry|not a problem)\b/g;
// Words that may sit between the negation and the offer word without counting
// toward MAX_GAP: "không thể giảm", "chưa có chương trình giảm giá",
// "can't give you a discount".
const FILLER = new Set(["a", "an", "the", "any", "co", "chuong", "trinh", "tu", "duoc", "ap", "dung", "nao", "give", "you", "offer"]);
// Other words allowed between the negation and the offer word.
const MAX_GAP = 2;

// "Giảm giá thì nhân viên sẽ báo bạn": deferring to staff is not a promise,
// unless it names a number ("nhân viên giảm 20% cho bạn").
const DEFERS_TO_STAFF = /nhan vien|\bstaff\b/;

// Folded text with comparable numbers. "tặng" (give) folds to "tang" like "tăng"
// (increase), so it is marked before folding; "mà" and "và" fold to "ma" (also
// "mã", code) and "va", so they become clause breaks ("|") first.
// "500.000đ" -> "500000d", "350,000" -> "350000", "500k" -> "500000".
function prepare(text: string): string {
  return fold(
    text
      .normalize("NFC")
      .replace(/tặng/giu, " tangqua ")
      .replace(/(?<!\p{L})(mà|và)(?!\p{L})/giu, " | "),
  )
    .replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1")
    .replace(/(\d+)k\b/g, "$1000");
}

const numbersIn = (text: string) => text.match(/\d+/g) ?? [];

// Clause breaks inside a sentence: commas, "mà/và" (already "|"), but, and.
// Unaccented "ma" too, unless it is the "mã" of "mã giảm giá" / "mã khuyến mãi".
const CLAUSE_BREAK = /,|\||\bnhung\b|\bbut\b|\band\b|\bva\b|\bma\b(?!\s+(giam|khuyen))|\btuy nhien\b|\bhowever\b/;

// True when a negation governs the offer word at `at`: it comes at most MAX_GAP
// words before it ("không giảm", "không thể giảm", "can't offer a discount"), or
// right after the offer phrase ("hàng giảm giá không đổi trả", "giảm giá thì không có").
function negated(clause: string, at: number, length: number): boolean {
  const before = clause.slice(0, at).trim().split(/\s+/).filter(Boolean);
  let gap = 0;
  for (let i = before.length - 1; i >= 0 && gap <= MAX_GAP; i--) {
    if (NEGATION_WORD.test(before[i])) return true;
    if (!FILLER.has(before[i])) gap++;
  }
  return /^\s*(gia\s+)?(thi\s+)?(shop\s+)?(khong|chua|not)\b/.test(clause.slice(at + length));
}

// An offer made in one clause. sentenceNumbers: every number of its sentence,
// which holds the offer's conditions ("Đơn từ 500k, shop miễn phí ship").
type Offer = { clause: string; kinds: string[]; numbers: string[]; sentenceNumbers: string[] };

// The offers a text makes, clause by clause.
// - reply (strict, fails closed): an offer word with a number, percent or amount
//   in its clause is an offer whatever the negation. Without a number it is a
//   refusal only when a negation governs every offer word in the clause.
// - policy (lenient): any negation in the clause makes it no offer, so a rule
//   like "Hàng giảm giá không đổi trả" never backs a discount.
function offersIn(text: string, strict: boolean, deferToStaff = true): Offer[] {
  return prepare(text)
    .split(/[.!?;\n]+/)
    .flatMap((sentence) => {
      const sentenceNumbers = numbersIn(sentence);
      return sentence.split(CLAUSE_BREAK).flatMap((raw) => {
        const clause = (raw ?? "").trim();
        if (!clause) return [];
        const matches = Object.entries(OFFER_KINDS).flatMap(([kind, re]) =>
          [...clause.matchAll(re)].map((m) => ({ kind, at: m.index, length: m[0].length })),
        );
        if (matches.length === 0) return [];
        const numbers = numbersIn(clause);
        // Same length, so match positions stay valid.
        const unblocked = clause.replace(NOT_A_REFUSAL, (m) => "_".repeat(m.length));
        if (strict) {
          if (numbers.length === 0 && matches.every((m) => negated(unblocked, m.at, m.length))) return [];
        } else if (/\b(khong|chua|not|no)\b/.test(unblocked)) {
          return [];
        }
        if (deferToStaff && numbers.length === 0 && DEFERS_TO_STAFF.test(clause)) return [];
        return [{ clause, kinds: [...new Set(matches.map((m) => m.kind))], numbers, sentenceNumbers }];
      });
    });
}

// PB-35b: true when the text makes any offer (discount, gift, free service, code),
// read strictly like a reply: a learned rule that does must wait for the owner.
// A rule has no staff to defer to: "Nhân viên tặng quà" is an offer.
export function mentionsOffer(text: string): boolean {
  return offersIn(text, true, false).length > 0;
}

// The first clause of the reply (folded) that offers a discount, gift or free
// service the policy texts don't offer, or null. An offer is backed when, for
// each kind it names, a policy sentence makes that kind of offer and the reply's
// sentence keeps that policy sentence's numbers (its conditions); and every
// number in the reply's sentence comes from those policy sentences (clauses only
// scope the negation, numbers are checked per sentence). Quoting "Miễn phí
// giao hàng cho đơn từ 500.000đ" passes; "bạn được miễn phí ship" drops the
// 500.000đ condition and is flagged, like any offer no policy makes.
export function findUnbackedDiscount(reply: string, policyTexts: string[]): string | null {
  const backing = policyTexts.flatMap((t) => offersIn(t, false));
  for (const offer of offersIn(reply, true)) {
    const backers = offer.kinds.map((k) =>
      backing.filter((b) => b.kinds.includes(k) && b.sentenceNumbers.every((n) => offer.sentenceNumbers.includes(n))),
    );
    const allowed = new Set(backers.flat().flatMap((b) => b.sentenceNumbers));
    // Sentence level: a changed condition may sit in the next clause
    // ("miễn phí giao hàng, cho đơn từ 200.000đ").
    if (backers.some((b) => b.length === 0) || !offer.sentenceNumbers.every((n) => allowed.has(n))) return offer.clause;
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
  "[Kiểm tra của hệ thống, không phải lời khách] Câu trả lời vừa rồi hứa giảm giá, quà tặng hoặc miễn phí mà chính sách của shop (get_policy) không có. Viết lại câu trả lời: không hứa giảm giá, tặng quà hay miễn phí; khách đòi giảm giá thì nói shop không tự giảm giá được, không nhắc lại số tiền hay % giảm.";

export const DISCOUNT_HANDOFF_TEXT =
  "Dạ, giá và ưu đãi do shop quyết định nên mình đã chuyển câu hỏi của bạn cho nhân viên shop. Nhân viên sẽ trả lời bạn sớm nhé!";
