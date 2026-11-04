export const ADMIN_NAV = [
  { href: "/admin/inbox", label: "Hộp thư" },
  { href: "/admin/orders", label: "Đơn hàng" },
  { href: "/admin/products", label: "Sản phẩm" },
  { href: "/admin/reply-assistant", label: "Trợ lý" },
] as const;

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
