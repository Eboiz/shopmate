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
  return true;
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
