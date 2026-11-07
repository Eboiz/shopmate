import { describe, expect, it } from "vitest";
import type { HistoryMessage } from "@/contract";
import { toModelMessages } from "./messages";

const m = (sender: HistoryMessage["sender"], text: string): HistoryMessage => ({ sender, text });

describe("toModelMessages", () => {
  it("maps senders, merges runs, drops system, empty and leading assistant messages", () => {
    expect(
      toModelMessages([m("ai", "Chào"), m("shopper", "a"), m("shopper", "b"), m("ai", "c"), m("system", "x"), m("shopper", "d")]),
    ).toEqual([
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ]);
  });

  it("maps staff messages to the assistant and drops blank text", () => {
    expect(toModelMessages([m("shopper", "a"), m("staff", "b"), m("ai", "  "), m("shopper", "c")])).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
  });

  it("throws when the last message is not the shopper's", () => {
    for (const history of [[m("shopper", "a"), m("ai", "b")], [m("system", "x")], [m("shopper", "  ")]]) {
      expect(() => toModelMessages(history)).toThrow(expect.objectContaining({ code: "last_message_not_from_shopper" }));
    }
  });
});
