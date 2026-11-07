import { tools, type HistoryMessage, type ToolCallLog, type ToolInput, type ToolOutput } from "@/contract";
import { formatPrice } from "@/lib/format";
import { mergeItems } from "./tools/order-items";
import { fold } from "./text";

export type PendingQuote = {
  items: ToolInput<"quote_order">["items"];
  quote: ToolOutput<"quote_order">;
};

export const ORDER_SUMMARY_PREFIX = "Dạ, đơn hàng dự kiến:";

export function latestQuote(logs: ToolCallLog[]): PendingQuote | null {
  for (const log of logs.toReversed()) {
    if (log.name !== "quote_order" || log.error) continue;
    const input = tools.quote_order.input.safeParse(log.input);
    const output = tools.quote_order.output.safeParse(log.output);
    if (!input.success || !output.success || output.data.lines.length === 0) continue;
    const items = mergeItems(input.data.items);
    if (!sameItems(items, output.data.lines)) continue;
    return { items, quote: output.data };
  }
  return null;
}

export function isOrderIntent(history: HistoryMessage[]): boolean {
  return history.some(({ sender, text }) => sender === "shopper" &&
    /\b(lay|mua|dat|chot|order|len don)\b/.test(fold(text)));
}

export function isOrderConfirmation(history: HistoryMessage[]): boolean {
  const last = history.at(-1);
  const summary = history.slice(0, -1).findLast(({ sender }) => sender === "ai")?.text ?? "";
  if (last?.sender !== "shopper" || !summary.startsWith(ORDER_SUMMARY_PREFIX)) return false;
  const answer = fold(last.text).replace(/[.!?]+$/g, "").trim();
  return /^(?:da\s+)?(?:(?:minh|em)\s+)?(?:ok|oke|dong y|xac nhan|chot don|dat hang|lay|dung roi|chinh xac|vang)(?:\s+(?:nha|nhe|a))?$/.test(answer);
}

export function sameItems(
  items: ToolInput<"quote_order">["items"],
  lines: ToolOutput<"quote_order">["lines"],
): boolean {
  const merged = mergeItems(items);
  if (merged.length !== lines.length) return false;
  const quoted = new Map(lines.map((line) => [line.variantId, line.quantity]));
  return merged.every(({ variantId, quantity }) => quoted.get(variantId) === quantity);
}

export function sameQuote(a: ToolOutput<"quote_order">, b: ToolOutput<"quote_order">): boolean {
  if (a.total !== b.total || a.lines.length !== b.lines.length) return false;
  const expected = new Map(a.lines.map((line) => [line.variantId, line]));
  return b.lines.every((line) => {
    const old = expected.get(line.variantId);
    return old?.productId === line.productId && old.name === line.name &&
      old.size === line.size && old.color === line.color && old.quantity === line.quantity &&
      old.unitPrice === line.unitPrice && old.lineTotal === line.lineTotal;
  });
}

export function missingCustomerDetails(
  input: ToolInput<"create_draft_order">,
  history: HistoryMessage[],
): string[] {
  const shopperMessages = history.filter(({ sender }) => sender === "shopper").map(({ text }) => text);
  const shopperText = shopperMessages.map(fold).join(" ");
  const normalized = shopperText.replace(/[^a-z0-9]+/g, " ").trim();
  const present = (value: string) => (` ${normalized} `).includes(` ${fold(value).replace(/[^a-z0-9]+/g, " ").trim()} `);
  const phoneWasGiven = shopperMessages.some((text) =>
    (text.match(/(?<!\d)0(?:[\s().-]*\d){9}(?!\d)/g) ?? [])
      .some((candidate) => candidate.replace(/\D/g, "") === input.customerPhone),
  );
  const missing: string[] = [];
  if (!present(input.customerName)) missing.push("tên");
  if (!phoneWasGiven) missing.push("số điện thoại");
  if (!present(input.customerAddress)) missing.push("địa chỉ giao hàng");
  return missing;
}

export function orderWriteError(
  rawInput: unknown,
  history: HistoryMessage[],
  previousQuote: PendingQuote | null,
): { code: string; missing?: string[] } | null {
  if (!previousQuote || !isOrderConfirmation(history)) return { code: "confirmation_required" };
  const parsed = tools.create_draft_order.input.safeParse(rawInput);
  if (!parsed.success) return null; // executeTool reports the contract's invalid_input error.
  if (!sameItems(parsed.data.items, previousQuote.quote.lines)) return { code: "order_items_changed" };
  const missing = missingCustomerDetails(parsed.data, history);
  return missing.length ? { code: "customer_details_missing", missing } : null;
}

// All prices and arithmetic here are copied from quote_order's database result.
// The shipping policy is quoted separately and never added to the goods total.
export function orderSummary(quote: ToolOutput<"quote_order">, shippingPolicy: string | null): string | null {
  const lines = quote.lines.map((line, index) =>
    `${index + 1}. ${line.name} (${line.size}, ${line.color}) ×${line.quantity}: ${formatPrice(line.unitPrice)}/món, thành tiền ${formatPrice(line.lineTotal)}.`,
  );
  const policy = shippingPolicy?.trim()
    ? `Chính sách giao hàng của shop: ${shippingPolicy.trim()}`
    : "Phí giao hàng chưa được shop công bố; nhân viên sẽ xác nhận trước khi chốt.";
  const text = [ORDER_SUMMARY_PREFIX, ...lines, `Tổng tiền hàng: ${formatPrice(quote.total)} (chưa gồm phí giao hàng).`, policy, "Bạn xác nhận đơn này chứ?"].join("\n");
  return text.length <= 1000 ? text : null;
}

export function orderCreatedText(): string {
  return "Dạ, mình đã ghi nhận đơn nháp. Nhân viên shop sẽ xác nhận đơn và phí giao hàng sớm nhé. Bạn có thể thanh toán khi nhận hàng (COD) hoặc chuyển khoản theo hướng dẫn của shop.";
}

export function orderOutOfStockText(
  variantIds: string[],
  previousQuote: PendingQuote | null,
  alternatives: ToolOutput<"get_stock">[],
): string {
  const soldOut = previousQuote?.quote.lines.filter((line) => variantIds.includes(line.variantId)) ?? [];
  const names = soldOut.slice(0, 3).map((line) => `${line.name} size ${line.size} màu ${line.color}`).join(", ") +
    (soldOut.length > 3 ? ` và ${soldOut.length - 3} món khác` : "");
  const options = alternatives.flatMap((item) => item.variants
    .filter((variant) => variant.stock > 0 && !variantIds.includes(variant.variantId))
    .slice(0, 2)
    .map((variant) => `${item.name} size ${variant.size} màu ${variant.color}`));
  const offer = options.length
    ? `Shop còn ${options.slice(0, 3).join(" hoặc ")}. Bạn muốn đổi sang lựa chọn nào?`
    : "Bạn muốn mình tìm size, màu hoặc mẫu khác còn hàng không?";
  return `Mình chưa tạo đơn vì ${names || "một món trong đơn"} vừa hết hàng. ${offer}`;
}
