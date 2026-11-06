import type { HistoryMessage, ToolOutput } from "@/contract";
import { fold, sortSizes } from "./text";

export const PRODUCT_CLARIFICATION = "Bạn muốn hỏi sản phẩm nào ạ? Cho mình tên hoặc mã sản phẩm để kiểm tra nhé.";
export const PRODUCT_HANDOFF = "Mình vẫn chưa tìm được sản phẩm bạn hỏi. Mình đã chuyển cho nhân viên shop hỗ trợ nhé.";

export function latestShopperText(history: HistoryMessage[]): string {
  return [...history].reverse().find((message) => message.sender === "shopper")?.text ?? "";
}

export function adviceIntent(history: HistoryMessage[]): "size" | "stock" | "policy" | null {
  const text = fold(latestShopperText(history));
  if (/\b(size nao|size gi|tu van size|chon size|mac size|vua size|bang size|co nao|chon co|mac co)\b/.test(text)) return "size";
  if (/\b(doi tra|doi hang|tra hang|doi trong|chinh sach doi|bao hanh|giao hang|ship|van chuyen|mien phi|giam gia|khuyen mai|voucher)\b/.test(text)) return "policy";
  if (/\b(con hang|con khong|het hang|het chua|ton kho|gia|bao nhieu|mau nao|co size|con size)\b/.test(text)) return "stock";
  return null;
}

export function policyKindFor(history: HistoryMessage[]): "doi_tra" | "giao_hang" | "khuyen_mai" | null {
  const text = fold(latestShopperText(history));
  if (/\b(giao hang|ship|van chuyen|mien phi)\b/.test(text)) return "giao_hang";
  if (/\b(giam gia|khuyen mai|voucher)\b/.test(text)) return "khuyen_mai";
  if (/\b(doi tra|doi hang|tra hang|doi trong|chinh sach doi)\b/.test(text)) return "doi_tra";
  return null;
}

export function shopperMeasurements(history: HistoryMessage[]): { heightCm: number | null; weightKg: number | null } {
  let heightCm: number | null = null;
  let weightKg: number | null = null;
  for (const message of history) {
    if (message.sender !== "shopper") continue;
    const text = fold(message.text);
    const height = /\b(1|2)m\s?(\d{1,2})\b/.exec(text);
    const cm = /\b(\d{3})\s?(?:cm)?\b/.exec(text);
    const weight = /\b(\d{2,3})\s?(?:kg|ky|can)\b/.exec(text);
    const labelledWeight = /\b(?:nang|can nang)\s?(\d{2,3})\b/.exec(text);
    if (height) heightCm = Number(height[1]) * 100 + Number(height[2]);
    else if (cm) heightCm = Number(cm[1]);
    if (weight) weightKg = Number(weight[1]);
    else if (labelledWeight) weightKg = Number(labelledWeight[1]);
    else if (heightCm !== null) {
      const bare = text.match(/\b\d{2,3}\b/g)?.map(Number).find((n) => n !== heightCm && n >= 20 && n <= 250);
      if (bare !== undefined) weightKg = bare;
    }
  }
  return { heightCm, weightKg };
}

export function sizeReply(result: ToolOutput<"recommend_size">): string | null {
  if (result.status !== "ok") return null;
  if (result.sizeByHeight !== result.sizeByWeight) {
    return `Theo bảng size của shop, chiều cao hợp size ${result.sizeByHeight}, cân nặng hợp size ${result.sizeByWeight}. Mình gợi ý size ${result.size} (size lớn hơn) để mặc thoải mái hơn ạ.`;
  }
  return `Theo bảng size của shop, chiều cao và cân nặng của bạn hợp size ${result.size} ạ.`;
}

export function stockReply(result: ToolOutput<"get_stock">, question: string): string {
  const normalized = fold(question);
  const sizes = sortSizes(result.variants.map((variant) => variant.size));
  const sizeToken = /\b(?:size\s*)?(3xl|xxl|xl|xs|s|m|l|[2-4]\d)\b/i.exec(normalized)?.[1]?.toUpperCase();
  const requestedSize = sizeToken ?? sizes.find((size) => new RegExp(`\\b${size.toLowerCase()}\\b`, "i").test(normalized));
  const colors = [...new Set(result.variants.map((variant) => variant.color))];
  const requestedColor = colors.find((color) => new RegExp(`\\b${fold(color)}\\b`, "i").test(normalized) || (fold(color) === "be" && /\bbeige\b/.test(normalized)));
  const target = result.variants.filter((variant) =>
    (!requestedSize || variant.size === requestedSize) && (!requestedColor || variant.color === requestedColor));
  const available = target.filter((variant) => variant.stock > 0);
  const price = result.price.toLocaleString("vi-VN");
  const variantText = (variant: typeof result.variants[number]) => `${variant.color} size ${variant.size} (${variant.stock} chiếc)`;
  if (available.length > 0) {
    return `${result.name} giá ${price}đ. Còn ${available.map(variantText).join(", ")} ạ.`;
  }
  const wanted = [requestedColor, requestedSize && `size ${requestedSize}`].filter(Boolean).join(" ");
  const alternatives = result.variants.filter((variant) => variant.stock > 0);
  if (alternatives.length === 0) return `${result.name} giá ${price}đ, hiện đã hết hàng ạ.`;
  return `${result.name} ${wanted || "hiện"} đã hết hàng. Giá ${price}đ; shop còn ${alternatives.map(variantText).join(", ")}. Bạn muốn xem lựa chọn nào ạ?`;
}
