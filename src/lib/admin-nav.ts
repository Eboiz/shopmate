export const ADMIN_NAV = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/inbox", label: "Hộp thư" },
  { href: "/admin/orders", label: "Đơn hàng" },
  { href: "/admin/products", label: "Sản phẩm" },
  { href: "/admin/reply-assistant", label: "Trợ lý" },
] as const;

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
