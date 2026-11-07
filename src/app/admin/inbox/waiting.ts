// How long a shopper has been waiting for staff, as the inbox shows it.
// `now` is passed in so the render stays pure and tests stay deterministic.

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

// Past this, a waiting conversation is flagged as overdue in the inbox.
export const overdueAfterMs = hour;

export function waitingMs(since: string, now: number) {
  return Math.max(0, now - new Date(since).getTime());
}

export function formatWaiting(ms: number) {
  if (ms < minute) return "vừa xong";
  if (ms < hour) return `${Math.floor(ms / minute)} phút`;
  if (ms < day) return `${Math.floor(ms / hour)} giờ`;
  if (ms < 30 * day) return `${Math.floor(ms / day)} ngày`;
  return `${Math.floor(ms / (30 * day))} tháng`;
}
