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

// True when the evidence is a verbatim part of the staff reply. Case, spacing,
// Unicode normalization and punctuation at the evidence's ends don't count.
export function evidenceInReply(evidence: string, staffReply: string): boolean {
  const needle = squash(evidence).replace(EDGE_PUNCTUATION, "");
  return needle.length > 0 && squash(staffReply).includes(needle);
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
  return out
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
// Share of the rule's words the staff reply must hold.
const MIN_COVERAGE = 0.75;

// True when the rule keeps the evidence's negation (or its absence) and most of
// its words come from the staff reply. A rewrite that fails needs the owner.
export function ruleSupported(rule: string, evidence: string, staffReply: string): boolean {
  if (NEGATION.test(fold(rule)) !== NEGATION.test(fold(evidence))) return false;
  const words = [...tokens(rule)];
  if (words.length === 0) return false;
  const staff = tokens(staffReply);
  return words.filter((w) => staff.has(w)).length / words.length >= MIN_COVERAGE;
}
