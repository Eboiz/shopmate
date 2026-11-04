const VND = new Intl.NumberFormat("vi-VN");

export function formatPrice(price: number): string {
  return `${VND.format(price)}đ`;
}
