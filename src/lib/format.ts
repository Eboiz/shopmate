const VND = new Intl.NumberFormat("vi-VN");

export function formatPrice(price: number): string {
  return `${VND.format(price)}đ`;
}

// The stock line of a product card, the same on web chat and every chat channel.
export function formatSizesInStock(sizes: string[]): string {
  return sizes.length > 0 ? `Size còn hàng: ${sizes.join(", ")}` : "Hết hàng";
}
