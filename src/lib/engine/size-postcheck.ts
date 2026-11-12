// PB-06 post-check: the size the reply advises must be the one recommend_size
// computed. The model only phrases the size function's result; when its reply
// names another size, the engine asks once more, then falls back to a reply
// written from the tool result itself.
import type { ToolOutput } from "@/contract";
import { fold } from "./text";

export type SizeAdvice = Extract<ToolOutput<"recommend_size">, { status: "ok" }>;

// Tokens that read as a clothing size: XS-3XL letters and two-digit numeric
// sizes (jeans 26-30). Matched on folded, lower-case text.
const SIZE_TOKEN = "(?:\\d?x{0,3}[sl]|m|\\d{2})";
// "size M", "cỡ L", "sz 28": a size named after a size word.
const NAMED_SIZE = new RegExp(`\\b(?:size|sz|co)\\s*(${SIZE_TOKEN})(?![a-z0-9])`, "g");
// A recommending verb ("chọn/lấy/mặc/đặt", "nên dùng") followed by a size.
// "Hợp" explains, it does not recommend.
const VERB_SIZE = new RegExp(
  `\\b(?:chon|lay|mac|dat|nen\\s+dung)(?:\\s+(?:lai|ngay|them|la|tam|co|size|sz))*\\s+(${SIZE_TOKEN})(?![a-z0-9])`,
  "g",
);
// A size attributed to a body measure ("theo chiều cao bạn mặc size S") is the
// sanctioned explanation, not a recommendation of that size.
const ATTRIBUTED = /\btheo\s+(?:chieu\s+)?cao\b|\btheo\s+can\s+nang\b/;

const hasToken = (folded: string, size: string) =>
  new RegExp(`(^|[^a-z0-9])${fold(size).replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`).test(folded);

// Every size string found in a tool output (get_stock variants, search_products
// sizes, get_pairings sizesInStock...). The reply may mention those, e.g. which
// sizes are in stock.
export function sizesInToolOutputs(outputs: unknown[]): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown, key: string | null) => {
    if (typeof node === "string") {
      if (key === "size" || key === "sizes" || key === "sizesInStock") found.add(fold(node));
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  };
  for (const output of outputs) walk(output, null);
  return found;
}

// true when the reply names the advised size and names no size that neither
// recommend_size nor another tool of this turn returned.
export function replyMatchesSize(text: string, advice: SizeAdvice, otherToolSizes: Set<string> = new Set()): boolean {
  const folded = fold(text);
  if (!hasToken(folded, advice.size)) return false;
  const allowed = new Set([advice.size, advice.sizeByHeight, advice.sizeByWeight].map(fold));
  for (const m of folded.matchAll(NAMED_SIZE)) {
    if (!allowed.has(m[1]) && !otherToolSizes.has(m[1])) return false;
  }
  // A recommending verb naming another size contradicts the advice even when
  // every named size is in the allowed set.
  const advised = fold(advice.size).replace(/[^a-z0-9]/g, "");
  for (const m of folded.matchAll(VERB_SIZE)) {
    if (m[1] === advised) continue;
    // A bare two-digit number after the verb is usually a quantity ("đặt 10
    // cái"), not a size: only count it when a size word names it or some tool
    // returned it as a size.
    const beforeToken = folded.slice(m.index, m.index + m[0].length - m[1].length);
    if (
      /^\d{2}$/.test(m[1]) &&
      !/\b(?:size|sz|co)\b/.test(beforeToken) &&
      !allowed.has(m[1]) &&
      !otherToolSizes.has(m[1])
    ) {
      continue;
    }
    // Only check attribution inside the same clause as the verb.
    const start =
      [",", ".", ";", ":", "!", "?", "(", ")"].reduce((acc, c) => Math.max(acc, folded.lastIndexOf(c, m.index)), -1) + 1;
    const clause = folded.slice(start, m.index);
    // A conditional clause offers an alternative, it is not the recommendation.
    if (/^neu\b/.test(clause.trim())) continue;
    // A negated verb ("không nên chọn size M") rejects that size, which agrees
    // with advice for another size.
    if (/\b(?:dung|khong nen|chua nen|dung co|khong|chua)\s*$/.test(clause)) continue;
    // Attribution explains the other measure's size, unless the same clause
    // swaps it in for the advice ("chọn size M thay cho size L").
    const rest = folded.slice(m.index + m[0].length).split(/[,.;:!?()]/)[0];
    if (ATTRIBUTED.test(clause) && !/\bthay\s+(?:cho|vi)\b/.test(clause + " " + rest)) continue;
    return false;
  }
  // The advised size negated right after it ("size L không hợp/vừa...").
  if (new RegExp(`\\b(?:size|sz|co)\\s*${advised}\\s+(?:khong|chua)\\s+(?:hop|vua|phu hop|nen)`).test(folded)) {
    return false;
  }
  // Heuristic negation checks on the folded text: a negated recommending verb
  // ("đừng chọn size L") or a negative descriptor next to the advised size
  // ("size L hơi chật") reads as rejecting the advice.
  const negVerb = new RegExp(
    `\\b(?:dung|khong nen|chua nen|dung co|khong)\\s+(?:chon|lay|mac|dat|nen\\s+dung|dung)(?:\\s+(?:lai|ngay|them|la|tam|co|size|sz))*\\s+(?:size|sz|co)\\s*${advised}(?![a-z0-9])`,
  );
  if (negVerb.test(folded)) return false;
  // Only "hơi chật/rộng" and explicit "không vừa/hợp" count; bare "rộng" would
  // flag praising text ("size L rộng rãi thoải mái"), and "chật" excludes
  // "chất liệu/lượng" which talk about the fabric, not the fit.
  const negDescriptor = new RegExp(
    `\\b(?:size|sz|co)\\s*${advised}(?![a-z0-9])[^,.;:!?()]*?\\b(?:hoi\\s+rong|(?<!\\b(?:khong|ko|khong bi|ko bi|chang|cha)\\s)chat(?!\\s*(?:lieu|luong))|khong\\s+(?:vua|hop|phu\\s+hop))\\b`,
  );
  if (negDescriptor.test(folded)) return false;
  return true;
}

// #9: whether a reply recommends a size ("bạn mặc size M là vừa", "chọn L
// nhé", "size M hợp với bạn"). Listing sizes in stock ("shop còn M, L") is not a
// recommendation. A bare two-digit number after a verb is a quantity unless a
// size word names it ("đặt 10 cái").
export function recommendsSize(text: string): boolean {
  const folded = fold(text);
  for (const m of folded.matchAll(VERB_SIZE)) {
    const beforeToken = folded.slice(m.index, m.index + m[0].length - m[1].length);
    if (/^\d{2}$/.test(m[1]) && !/\b(?:size|sz|co)\b/.test(beforeToken)) continue;
    const clause = folded.slice(0, m.index).split(/[,.;:!?()]/).at(-1) ?? "";
    if (/\b(?:dung|khong nen|chua nen|khong|chua)\s*$/.test(clause)) continue;
    return true;
  }
  return new RegExp(`\\b(?:size|sz|co)\\s*${SIZE_TOKEN}(?![a-z0-9])\\s+(?:la\\s+)?(?:vua|hop|phu hop|chuan)\\b`).test(folded);
}

// Sent to the model once when its reply named a size although recommend_size
// was refused for missing measurements.
export function measurementsCorrection(missing: string[]): string {
  return `Kiểm tra tự động: recommend_size chưa chạy vì khách chưa cho ${missing.join(" và ")}. Viết lại câu trả lời: chỉ hỏi ${missing.join(" và ")}, không tư vấn hay nêu size nào.`;
}

// The fixed reply when the second try still recommends a size.
export function measurementsQuestionText(missing: string[]): string {
  return `Dạ để tư vấn size, bạn cho mình biết ${missing.join(" và ")} của bạn nhé?`;
}

// Sent to the model once when its reply failed the check.
export function sizeCorrection(advice: SizeAdvice): string {
  return `Kiểm tra tự động: recommend_size trả size ${advice.size} (theo chiều cao ${advice.sizeByHeight}, theo cân nặng ${advice.sizeByWeight}). Viết lại câu trả lời, tư vấn đúng size ${advice.size} và không nêu size nào khác.`;
}

// The reply written from data when the model's second try still fails.
export function sizeFallbackText(advice: SizeAdvice): string {
  if (advice.sizeByHeight === advice.sizeByWeight) {
    return `Dạ, theo bảng size của shop thì bạn mặc size ${advice.size} là vừa ạ.`;
  }
  return `Dạ, theo bảng size của shop thì chiều cao của bạn hợp size ${advice.sizeByHeight}, cân nặng hợp size ${advice.sizeByWeight}, nên bạn chọn size lớn hơn là ${advice.size} để mặc thoải mái ạ.`;
}
