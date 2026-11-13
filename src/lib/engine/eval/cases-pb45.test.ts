import { describe, expect, it } from "vitest";
import { FX } from "../test/two-shops";
import { pb45Cases } from "./cases-pb45";
import { scoreRun, type RunOutcome } from "./score";

const byId = (id: string) => pb45Cases.find((c) => c.id === id)!;
const V = FX.a.vay01;

describe("pb45Cases", () => {
  it("ids are unique and every case has a reply label", () => {
    expect(new Set(pb45Cases.map((c) => c.id)).size).toBe(pb45Cases.length);
    for (const c of pb45Cases) expect(c.reply).toBeDefined();
  });

  it("Bot #1: 'no XXL, size M' passes; agreeing to XXL or looking up XXL stock fails", () => {
    const c = byId("pb45-bot01-unsold-size-xxl");
    const size = { name: "recommend_size", input: { productId: V, heightCm: 158, weightKg: 50 } };
    const ok: RunOutcome = {
      handoffReason: null,
      replyText: "Dạ, Váy suông linen shop không có size XXL, chỉ có các size M, L ạ. Theo bảng size bạn mặc size M là vừa. Nếu thích mặc rộng hơn, bạn có thể lấy size L.",
    };
    expect(scoreRun(c, [size], ok).passed).toBe(true);
    const qa: RunOutcome = { ...ok, replyText: "Dạ, chọn size XXL cũng được ạ, để mình xem còn size XXL không nhé." };
    expect(scoreRun(c, [size], qa).passed).toBe(false);
    expect(scoreRun(c, [size, { name: "get_stock", input: { productId: V, size: "XXL" } }], ok).passed).toBe(false);
  });

  it("Bug #2: every color passes; the QA reply (only black) or a color-filtered lookup fails", () => {
    const c = byId("pb45-bug02-other-colors");
    const all = { name: "get_stock", input: { productId: V, size: "M" } };
    const ok: RunOutcome = { handoffReason: null, replyText: "Dạ, size M còn màu be 2 chiếc và màu đen 5 chiếc ạ." };
    expect(scoreRun(c, [all], ok).passed).toBe(true);
    expect(scoreRun(c, [all], { ...ok, replyText: "Dạ, hiện mình chỉ thấy màu đen size M còn 5 chiếc." }).passed).toBe(false);
    expect(scoreRun(c, [{ name: "get_stock", input: { productId: V, size: "M", color: "đen" } }], ok).passed).toBe(false);
  });
});
