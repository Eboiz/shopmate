import { describe, expect, it } from "vitest";
import type { InboxConversation } from "./inbox-live";
import {
  appendPage, compareCursor, cursorAfter, cursorArgs, filterArgs, mergeFirstPage, toInboxConversation, toPage, type InboxRow,
} from "./inbox-page";

function row(overrides: Partial<InboxRow>): InboxRow {
  return {
    id: "3f2a0000-0000-0000-0000-000000000000", mode: "ai", channel: "web", display_name: "Lan Anh",
    last_message_at: "2026-11-10T02:00:00+00:00", latest_message: "Dạ còn ạ", customer_message: "Còn váy không?",
    customer_message_at: "2026-11-10T01:59:00+00:00", ...overrides,
  };
}

function conversation(id: string, lastMessageAt: string, mode: InboxConversation["mode"] = "ai"): InboxConversation {
  return { id, customerName: id, channel: "web", mode, lastMessageAt, latestMessage: undefined };
}

const ids = (items: InboxConversation[]) => items.map(({ id }) => id);

describe("toInboxConversation", () => {
  it("maps a search_inbox row to an inbox row", () => {
    expect(toInboxConversation(row({}))).toEqual({
      id: "3f2a0000-0000-0000-0000-000000000000", customerName: "Lan Anh", unnamed: undefined, channel: "web", mode: "ai",
      lastMessageAt: "2026-11-10T02:00:00+00:00", latestMessage: "Dạ còn ạ", customerMessage: "Còn váy không?",
      customerMessageAt: "2026-11-10T01:59:00+00:00",
    });
  });

  it("labels unnamed shoppers and drops missing messages", () => {
    const mapped = toInboxConversation(row({ display_name: " ", channel: "messenger", latest_message: null, customer_message: "", customer_message_at: null }));
    expect(mapped).toMatchObject({ customerName: "Khách Messenger #3F2A", unnamed: true, latestMessage: undefined, customerMessage: undefined, customerMessageAt: undefined });
  });
});

describe("filterArgs and cursorArgs", () => {
  it("leaves out 'all' and a blank search", () => {
    expect(filterArgs({ query: "  ", mode: "all", channel: "all" })).toEqual({ p_query: undefined, p_mode: undefined, p_channel: undefined });
    expect(filterArgs({ query: " bùi trang ", mode: "needs_human", channel: "telegram" }))
      .toEqual({ p_query: "bùi trang", p_mode: "needs_human", p_channel: "telegram" });
  });

  it("passes the cursor keys, or nothing for page one", () => {
    expect(cursorArgs(null)).toEqual({});
    expect(cursorArgs({ urgent: true, at: "2026-11-10T02:00:00+00:00", id: "c1" }))
      .toEqual({ p_after_urgent: true, p_after_at: "2026-11-10T02:00:00+00:00", p_after_id: "c1" });
  });
});

describe("toPage", () => {
  it("offers a next page only after a full page", () => {
    const rows = [row({ id: "b", mode: "needs_human" }), row({ id: "a" })];
    expect(toPage(rows, 2).nextCursor).toEqual({ urgent: false, at: "2026-11-10T02:00:00+00:00", id: "a" });
    expect(toPage(rows, 3).nextCursor).toBeNull();
    expect(toPage([], 2)).toEqual({ conversations: [], nextCursor: null });
  });
});

describe("compareCursor", () => {
  const at = "2026-11-10T02:00:00.123456+00:00";
  it("orders the queue first, then newest, then id descending", () => {
    expect(compareCursor({ urgent: true, at: "2020-01-01T00:00:00+00:00", id: "a" }, { urgent: false, at, id: "z" })).toBeLessThan(0);
    expect(compareCursor({ urgent: false, at, id: "a" }, { urgent: false, at: "2026-11-10T02:00:00.123455+00:00", id: "z" })).toBeLessThan(0);
    expect(compareCursor({ urgent: false, at, id: "b" }, { urgent: false, at, id: "a" })).toBeLessThan(0);
    expect(compareCursor({ urgent: false, at, id: "a" }, { urgent: false, at, id: "a" })).toBe(0);
  });

  it("reads trimmed fractions as microseconds", () => {
    expect(compareCursor({ urgent: false, at: "2026-11-10T02:00:00.12+00:00", id: "a" }, { urgent: false, at: "2026-11-10T02:00:00.119+00:00", id: "a" })).toBeLessThan(0);
  });
});

describe("appendPage", () => {
  it("adds the next page without repeating rows", () => {
    const current = { conversations: [conversation("c", "2026-11-10T03:00:00Z"), conversation("b", "2026-11-10T02:00:00Z")], nextCursor: null };
    const next = { conversations: [conversation("b", "2026-11-10T02:00:00Z"), conversation("a", "2026-11-10T01:00:00Z")], nextCursor: null };
    expect(ids(appendPage(current, next).conversations)).toEqual(["c", "b", "a"]);
  });
});

describe("mergeFirstPage", () => {
  const older = [conversation("c", "2026-11-10T03:00:00Z"), conversation("b", "2026-11-10T02:00:00Z"), conversation("a", "2026-11-10T01:00:00Z")];
  const loaded = { conversations: older, nextCursor: cursorAfter(older[2]) };

  it("puts a new conversation on top and keeps the older pages", () => {
    const fresh = conversation("n", "2026-11-10T04:00:00Z");
    const first = { conversations: [fresh, older[0]], nextCursor: cursorAfter(older[0]) };
    const merged = mergeFirstPage(loaded, first);
    expect(ids(merged.conversations)).toEqual(["n", "c", "b", "a"]);
    expect(merged.nextCursor).toEqual(loaded.nextCursor);
  });

  it("moves a conversation that got a new message to the top, once", () => {
    const moved = conversation("a", "2026-11-10T05:00:00Z", "needs_human");
    const first = { conversations: [moved, older[0]], nextCursor: cursorAfter(older[0]) };
    expect(ids(mergeFirstPage(loaded, first).conversations)).toEqual(["a", "c", "b"]);
  });

  it("takes page one as is when it holds everything", () => {
    const first = { conversations: [older[1]], nextCursor: null };
    expect(mergeFirstPage(loaded, first)).toBe(first);
  });
});
