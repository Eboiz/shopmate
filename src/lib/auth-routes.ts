export const LOGIN_PATH = "/login";
export const ADMIN_PATH = "/admin";

export function isProtectedPath(pathname: string): boolean {
  return pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`);
}

// Only same-site admin paths are accepted, so `next` cannot become an open redirect.
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return ADMIN_PATH;
  return isProtectedPath(next.split(/[?#]/)[0]) ? next : ADMIN_PATH;
}

export function loginRedirectUrl(pathname: string, search: string): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(pathname + search)}`;
}
