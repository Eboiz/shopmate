import { describe, expect, it } from "vitest";
import type { HistoryMessage } from "@/contract";
import { EARLIER_PHOTO_MARK, latestShopperPhotoPaths, PHOTO_ONLY_TEXT, toModelMessages } from "./messages";

const m = (sender: HistoryMessage["sender"], text: string): HistoryMessage => ({ sender, text });

describe("toModelMessages", () => {
  it("maps senders, merges runs, maps system to assistant, drops empty and leading assistant messages", () => {
    expect(
      toModelMessages([m("ai", "Chào"), m("shopper", "a"), m("shopper", "b"), m("ai", "c"), m("system", "x"), m("shopper", "d")]),
    ).toEqual([
      { role: "user", content: "a\nb" },
      { role: "assistant", content: "c\nx" },
      { role: "user", content: "d" },
    ]);
  });

  it("keeps shopper messages separated across intervening system handoff notices", () => {
    expect(
      toModelMessages([m("shopper", "gặp nhân viên"), m("system", "Nhân viên sẽ trả lời sớm"), m("shopper", "mua áo blazer")]),
    ).toEqual([
      { role: "user", content: "gặp nhân viên" },
      { role: "assistant", content: "Nhân viên sẽ trả lời sớm" },
      { role: "user", content: "mua áo blazer" },
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

describe("PB-30 photos", () => {
  const photo = (n: number) => ({ base64: `b${n}`, mediaType: "image/jpeg" as const });
  const p = (text: string, photoPaths: string[]): HistoryMessage => ({ sender: "shopper", text, photoPaths });

  it("puts image blocks before the text of the last user turn only", () => {
    const out = toModelMessages([m("shopper", "chào"), m("ai", "Dạ"), p("mẫu này còn không?", ["s/c/1.jpg"])], [photo(1)]);
    expect(out[0]).toEqual({ role: "user", content: "chào" });
    expect(out[2]).toEqual({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "b1" } },
        { type: "text", text: "mẫu này còn không?" },
      ],
    });
  });

  it("a photo-only turn is not dropped: its text says so", () => {
    const out = toModelMessages([p("", ["s/c/1.jpg"])], [photo(1)]);
    expect(out).toEqual([{ role: "user", content: [expect.objectContaining({ type: "image" }), { type: "text", text: PHOTO_ONLY_TEXT }] }]);
    expect(toModelMessages([p("", ["s/c/1.jpg"])])).toEqual([{ role: "user", content: PHOTO_ONLY_TEXT }]);
  });

  it("an earlier photo message gets a mark instead of its photo", () => {
    const out = toModelMessages([p("", ["s/c/1.jpg"]), m("ai", "Dạ shop có mẫu này"), m("shopper", "size M còn không?")]);
    expect(out[0]).toEqual({ role: "user", content: EARLIER_PHOTO_MARK });
    expect(out[2]).toEqual({ role: "user", content: "size M còn không?" });
  });

  it("latestShopperPhotoPaths: the photos of the merged last burst, at most 4, none after an AI reply", () => {
    const burst = [p("", ["a"]), m("ai", "x"), p("", ["b", "c"]), p("và mẫu này", ["d", "e", "f"])];
    expect(latestShopperPhotoPaths(burst)).toEqual(["b", "c", "d", "e"]);
    expect(latestShopperPhotoPaths([p("", ["a"]), m("ai", "x"), m("shopper", "còn không?")])).toEqual([]);
  });
});
