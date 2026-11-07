import { describe, expect, it } from "vitest";
import { countByMode, emptyFilter, filterConversations, foldSearch, formatListTime, initialOf } from "./inbox-filter";
import type { InboxConversation } from "./inbox-live";

function conversation(overrides: Partial<InboxConversation>): InboxConversation {
  return {
    id: "c", customerName: "Khách hàng", channel: "web", mode: "ai",
    lastMessageAt: "2026-11-07T03:00:00Z", latestMessage: undefined, ...overrides,
  };
}

const list = [
  conversation({ id: "1", customerName: "Lân Ánh", mode: "needs_human", customerMessage: "Váy đỏ còn size M không?" }),
  conversation({ id: "2", customerName: "Đức Minh", channel: "telegram", mode: "staff", latestMessage: "Shop gửi mã đơn ạ" }),
  conversation({ id: "3", customerName: "Thu Trang", channel: "messenger", mode: "ai" }),
];
const ids = (items: InboxConversation[]) => items.map(({ id }) => id);

describe("foldSearch", () => {
  it("drops case and Vietnamese diacritics, including đ", () => {
    expect(foldSearch("  Đức MINH Ánh ")).toBe("duc minh anh");
  });
});

describe("filterConversations", () => {
  it("finds names and message text typed without diacritics", () => {
    expect(ids(filterConversations(list, { ...emptyFilter, query: "lan anh" }))).toEqual(["1"]);
    expect(ids(filterConversations(list, { ...emptyFilter, query: "duc" }))).toEqual(["2"]);
    expect(ids(filterConversations(list, { ...emptyFilter, query: "vay do" }))).toEqual(["1"]);
    expect(ids(filterConversations(list, { ...emptyFilter, query: "ma don" }))).toEqual(["2"]);
  });

  it("combines mode, channel and query", () => {
    expect(ids(filterConversations(list, { ...emptyFilter, mode: "needs_human" }))).toEqual(["1"]);
    expect(ids(filterConversations(list, { ...emptyFilter, channel: "messenger" }))).toEqual(["3"]);
    expect(ids(filterConversations(list, { query: "minh", mode: "ai", channel: "all" }))).toEqual([]);
    expect(ids(filterConversations(list, emptyFilter))).toEqual(["1", "2", "3"]);
  });
});

describe("countByMode", () => {
  it("counts each mode under the other filters", () => {
    expect(countByMode(list, emptyFilter)).toEqual({ all: 3, ai: 1, needs_human: 1, staff: 1 });
    expect(countByMode(list, { ...emptyFilter, mode: "staff", channel: "telegram" })).toEqual({ all: 1, ai: 0, needs_human: 0, staff: 1 });
  });
});

describe("formatListTime", () => {
  const now = Date.parse("2026-11-07T10:00:00Z"); // 17:00 in Vietnam

  it("shows the time today, the day this year and the full date before", () => {
    expect(formatListTime("2026-11-07T02:05:00Z", now)).toBe("09:05");
    expect(formatListTime("2026-11-06T17:30:00Z", now)).toBe("00:30"); // already the 7th in Vietnam
    expect(formatListTime("2026-11-05T03:00:00Z", now)).toBe("5/11");
    expect(formatListTime("2025-11-05T03:00:00Z", now)).toBe("5/11/2025");
  });
});

describe("initialOf", () => {
  it("takes the given name's first letter", () => {
    expect(initialOf("Nguyễn Lân Ánh")).toBe("Á");
    expect(initialOf("Lê Bình (demo 013)")).toBe("B");
    expect(initialOf("  ")).toBe("?");
  });
});
