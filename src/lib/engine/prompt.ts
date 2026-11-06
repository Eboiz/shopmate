import type Anthropic from "@anthropic-ai/sdk";
import type { EngineMode } from "@/contract";

// v0 is a placeholder; prompt v1 belongs to PB-10. Bump the version on every
// change: it is stored with each turn (ai_turns.prompt_version) to compare runs.
export const PROMPT_VERSION = "v0";

type Product = { id: string; name: string };

// Depends only on the mode and PROMPT_VERSION. The prompt cache matches the
// request byte for byte from the start (tools, then system, then messages), so
// nothing that changes per request (ids, names, dates) may go here.
export function buildStablePrompt(mode: EngineMode): string {
  const lines = [
    `Prompt ${PROMPT_VERSION}. Bạn là trợ lý bán hàng của một shop thời trang nhỏ, trả lời khách bằng tiếng Việt, ngắn gọn và lịch sự.`,
    "- Chỉ dùng số liệu (giá, tồn kho, size, chính sách) lấy từ tool. Không đoán, không bịa.",
    "- Không tự tính tiền: luôn gọi quote_order để có giá từng món và tổng tiền.",
    "- Chỉ gợi ý món phối mà get_pairings trả về; không bịa món gợi ý.",
    "- Muốn tư vấn size thì cần chiều cao và cân nặng của khách; nếu thiếu thì hỏi lại, không tự đặt số.",
    "- Câu trả lời cuối cùng là một JSON object {text, productIds, quickReplies}:",
    "  text: câu trả lời cho khách, tối đa 1000 ký tự;",
    "  productIds: id các sản phẩm muốn hiện thẻ, tối đa 10 id, chỉ dùng id có trong kết quả tool;",
    "  quickReplies: tối đa 10 gợi ý trả lời nhanh, mỗi cái tối đa 20 ký tự.",
  ];
  if (mode === "staff_draft") {
    lines.push("- Bạn soạn nháp cho nhân viên, không tạo đơn, không chuyển nhân viên.");
  }
  return lines.join("\n");
}

// Changes per request: the product the shopper is looking at.
export function buildVolatilePrompt(product: Product | null): string | null {
  if (product === null) return null;
  return `Khách đang xem sản phẩm "${product.name}" (productId: ${product.id}).`;
}

// Block 0 is the stable part, marked for caching; block 1 (only with a product)
// is the volatile part after the cache breakpoint. v0 may be shorter than the
// model's minimum cacheable prefix: check cacheReadTokens before claiming savings.
export function buildSystemPrompt(opts: { mode: EngineMode; product: Product | null }): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildStablePrompt(opts.mode), cache_control: { type: "ephemeral" } },
  ];
  const volatile = buildVolatilePrompt(opts.product);
  if (volatile !== null) blocks.push({ type: "text", text: volatile });
  return blocks;
}
