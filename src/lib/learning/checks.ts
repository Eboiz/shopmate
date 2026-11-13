// PB-35b: the checks code makes on what the model proposes to learn. The model
// only proposes; these decide. Pure: no IO.
import { hasBlank } from "@/contract";
import { mentionsOffer } from "@/lib/engine/discount-guard";
import { fold } from "@/lib/engine/text";

// Folded text with comparable numbers, like refusal-guard's prepare:
// "500.000đ" -> "500000d", "500k" -> "500000".
function prepare(text: string): string {
  return fold(text.normalize("NFC"))
    .replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1")
    .replace(/(\d+)\s*k\b/g, "$1000");
}

// Every number of the text, without leading zeros: "2-3 ngày" -> {2, 3}.
export function comparableNumbers(text: string): Set<string> {
  return new Set((prepare(text).match(/\d+/g) ?? []).map((n) => String(Number(n))));
}

// True when every number of the rule is one the staff wrote.
export function numbersBacked(rule: string, staffReply: string): boolean {
  const backed = comparableNumbers(staffReply);
  return [...comparableNumbers(rule)].every((n) => backed.has(n));
}

const squash = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const EDGE_PUNCTUATION = /^[\s.!?…,;:"'“”()-]+|[\s.!?…,;:"'“”()-]+$/g;

const needleOf = (evidence: string) => squash(evidence).replace(EDGE_PUNCTUATION, "");

// True when the evidence is a verbatim part of the staff reply. Case, spacing,
// Unicode normalization and punctuation at the evidence's ends don't count.
export function evidenceInReply(evidence: string, staffReply: string): boolean {
  const needle = needleOf(evidence);
  return needle.length > 0 && squash(staffReply).includes(needle);
}

// A sentence ends at . ! ? … followed by a space or the end ("500.000đ" doesn't).
const SENTENCE_END = /[.!?…](?=\s|$)/g;

// The staff's whole sentences that hold the evidence, at every place it
// appears: the model may quote "cho kiểm hàng" out of "shop không cho kiểm
// hàng". The evidence itself when it isn't found.
export function evidenceSentences(evidence: string, staffReply: string): string[] {
  const needle = needleOf(evidence);
  const hay = squash(staffReply);
  const ends = [...hay.matchAll(SENTENCE_END)].map((m) => m.index + 1);
  const out: string[] = [];
  for (let at = needle ? hay.indexOf(needle) : -1; at >= 0; at = hay.indexOf(needle, at + 1)) {
    const start = Math.max(0, ...ends.filter((e) => e <= at));
    const end = ends.find((e) => e >= at + needle.length) ?? hay.length;
    out.push(hay.slice(start, end));
  }
  return out.length > 0 ? out : [evidence];
}

// Folded markers of an answer meant for this order or this shopper only:
// "lần này", "riêng chị", "đơn này", "mã đơn", an order code like "DH1234".
const ONE_OFF =
  /\blan nay\b|\brieng (chi|anh|ban|em|minh)\b|\bdon nay\b|\bdon cua (chi|anh|ban|em)\b|\bma don\b|\b[a-z]{2,4}-?\d{3,}\b/;

export function hasOneOffMarker(staffReply: string): boolean {
  return ONE_OFF.test(fold(staffReply.normalize("NFC")));
}

// Folded markers of a staff member who isn't sure.
const VAGUE = /\bchac la\b|\bco le\b|\bhinh nhu\b|\bde em hoi lai\b|\bde em kiem tra\b|\bem chua chac\b|\bchua ro\b/;

export function hasVagueMarker(staffReply: string): boolean {
  return VAGUE.test(fold(staffReply.normalize("NFC")));
}

// Phone numbers: 0912345678, 0912 345 678, 0912.345.678, +84 912345678.
const PHONE = /(?:\+84|\b84|\b0)(?:[\s.-]?\d){8,10}\b/g;
// A house number and a capitalized street name: "12 Lê Lợi", "45/3 Đường Nguyễn Trãi".
// "quận 1" and "7 ngày" don't match: the number comes after, or no capital follows.
const ADDRESS = /\b\d+[a-z]?(?:\/\d+)*\s+(?:đường\s+)?\p{Lu}\p{Ll}*(?:\s+\p{Lu}\p{Ll}*)+/gu;
const HONORIFIC = "(?:chị|anh|bạn|em|cô|chú)";
// An honorific and a capitalized name, when the shopper's name isn't known: "chị Thảo".
const ADDRESSED_NAME = /(?<![\p{L}\p{N}])(?:[Cc]hị|[Aa]nh|[Bb]ạn|[Ee]m|[Cc]ô|[Cc]hú)\s+\p{Lu}\p{Ll}*(?:\s+\p{Lu}\p{Ll}*)*(?![\p{L}\p{N}])/gu;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The text without phone numbers, street addresses and the shopper's name.
export function redactPersonal(text: string, shopperName?: string | null): string {
  let out = text.normalize("NFC").replace(PHONE, " ").replace(ADDRESS, " ").replace(ADDRESSED_NAME, " ");
  const name = shopperName?.normalize("NFC").trim();
  if (name) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${HONORIFIC}\\s+)?${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, " ");
  }
  return tidy(out);
}

// The spacing and punctuation clean-up redactPersonal ends with, alone: a rule
// whose redaction differs from this lost words, maybe its conditions.
export function tidy(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/^[\s,;:.]+/, "")
    .trim();
}

// True when the draft has a [...] blank and states no fact outside the blanks:
// no number, no offer.
export function draftIsBlankOnly(draft: string): boolean {
  if (!hasBlank(draft)) return false;
  const outside = draft.replace(/\[[^\]]*\]/g, " ");
  return !/\d/.test(outside) && !mentionsOffer(outside);
}

const NEGATION = /\b(khong|chua|chang|ko|khg)\b/;
const tokens = (text: string) => new Set(fold(text.normalize("NFC")).match(/[\p{L}\p{N}]+/gu) ?? []);
// Words a rewrite adds without stating anything: the subject ("shop", "khách",
// "hàng") and function words. Not counted.
const NEUTRAL = new Set(["shop", "hang", "khach", "duoc", "se", "la", "va", "cho", "cua", "cac", "nhung", "thi", "voi", "khi", "nay", "deu", "co"]);
// Share of the rule's other words the staff reply must hold.
const MIN_COVERAGE = 0.75;

// True when the rule keeps the evidence's negation (or its absence), every
// staff sentence holding the evidence agrees with it, and most of the rule's
// words come from the staff reply. A negation elsewhere in the sentence ("không
// nhận trả hàng nhưng cho đổi") leaves its scope unclear: the owner decides.
export function ruleSupported(rule: string, evidence: string, staffReply: string): boolean {
  const negated = (text: string) => NEGATION.test(fold(text));
  const evidenceNegated = negated(evidence);
  if (negated(rule) !== evidenceNegated) return false;
  if (evidenceSentences(evidence, staffReply).some((sentence) => negated(sentence) !== evidenceNegated)) return false;
  const words = [...tokens(rule)].filter((w) => !NEUTRAL.has(w));
  if (words.length === 0) return false;
  const staff = tokens(staffReply);
  return words.filter((w) => staff.has(w)).length / words.length >= MIN_COVERAGE;
}

// Facts only the catalog tools may state (prompt: price, stock and size come
// from tools): stock, a size or a body measurement, a product's price or
// details. Matched on folded text with comparable numbers, so the words are
// picked to avoid their unaccented twins ("đảm bảo", "đẹp", "chất lượng",
// "quận"). A general policy ("đổi size trong 7 ngày", "hết hàng thì hoàn tiền",
// "còn nguyên form", "đơn trên 20kg", "ship có giá 30k") doesn't match; its
// amounts are left to mentionsAmount.
const SIZE = "(?:\\d?x{0,3}l|xs|s|m|\\d{1,2})";
const COLOR = "(?:den|trang|do|xanh|vang|hong|tim|nau|be|kem|xam)";
const PRODUCT = "(?:ao|vay|dam(?! bao)|quan|chan vay|set|giay|tui|mau|san pham)";
const PRODUCT_DATA = new RegExp(
  [
    // Stock: "còn hàng", "còn 3 cái", "chỉ còn 1", "còn size S", "hết màu đen".
    "\\bcon hang\\b",
    "\\bcon (?:\\d+|mot|hai|ba|vai|it) (?:cai|chiec|bo|sp|san pham)\\b",
    "\\bchi con \\d",
    `\\b(?:con|het) size ${SIZE}\\b`,
    `\\b(?:con|het) mau ${COLOR}\\b`,
    "\\bton kho\\b",
    // A size or a body measurement: "size M", "size 3XL", "1m60", "50kg mặc",
    // "eo 68", "vòng 1 86". A weight after "trên"/"dưới" is a parcel's.
    `\\bsize ${SIZE}\\b`,
    "(?<![\\d.,])1 ?m ?\\d{1,2}\\b",
    "(?<!(?:tren|duoi|qua|toi da|hon) )\\b\\d{2,3} ?(?:kg|ky|ki|can)\\b",
    "\\b(?:cao|eo|nguc|mong) \\d{2,3}\\b",
    "\\bvong [1-3] \\d{2,3}\\b",
    // A product's price: "váy hoa giá 350k", "giá bán 199000"; not "áo giảm
    // giá 50k" or "đồng giá" (offers, checked as such).
    `\\b${PRODUCT}\\b(?: \\S+){0,3} (?:co )?(?<!giam |dong )gia (?:la |chi |con |ban |goc |sale )?\\d`,
    "\\bgia (?:ban|goc|niem yet) \\d",
    // A product's details: "váy hoa chất voan", "chất liệu cotton", "màu xanh",
    // "áo này form rộng".
    "(?<!loi )\\bchat lieu\\b",
    `\\bmau ${COLOR}\\b`,
    `\\b(?:ao|vay|dam(?! bao)|mau|san pham) (?:nay|do|kia)\\b`,
    `\\b${PRODUCT}\\b(?: \\S+){0,3} (?:chat(?! luong)(?: vai)?|lam bang|form (?:rong|om|suong|chuan|nho|to)|dang (?:rong|om|suong|ngan|dai))\\b`,
  ].join("|"),
);

// Folded, comparable numbers, single spaces: "Size\tM" is "size m".
const flat = (text: string) => prepare(text).replace(/\s+/g, " ");

export function mentionsProductData(rule: string): boolean {
  return PRODUCT_DATA.test(flat(rule));
}

// A money amount: "30k", "25.000đ", "20 nghìn", "ba mươi nghìn đồng", "1 triệu",
// or a plain number of 1000 or more. Ship fees and the like: the owner checks
// them. "đóng gói" and "mười ngày" are not amounts.
const MONEY = /\b\d+ ?(?:d|dong|vnd|tr)\b|\b(?:nghin|ngan|trieu)\b|\b(?:muoi|tram|lam|chuc) dong\b/;

export function mentionsAmount(rule: string): boolean {
  return MONEY.test(flat(rule)) || [...comparableNumbers(rule)].some((n) => Number(n) >= 1000);
}
