import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HANDOFF_TEXT } from "@/lib/channels/receive";
import {
  classifyInfra,
  dataChecks,
  ENGINE_FAILURE_TEXT,
  extractAmounts,
  extractStockClaims,
  reasonOverlap,
  saysSize,
  sizesNamed,
} from "./live-score";
import type { LiveResults, TurnRecord } from "./live-types";

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "live-fake.json"), "utf8"),
) as LiveResults;
const snapshot = fixture.snapshot;
const linen = snapshot.products.find((p) => p.name === "Váy suông linen")!;

const turn = (over: Partial<TurnRecord>): TurnRecord => ({
  shopper: "hỏi",
  productId: null,
  httpStatus: 200,
  status: "answered",
  error: null,
  wallMs: 1000,
  replies: [],
  aiTurn: null,
  modeAfter: "ai",
  ...over,
});
const aiTurn = {
  id: "t1", createdAt: "", toolCalls: [], handoffReason: null, model: "m", promptVersion: "v1.1", latencyMs: 1, inputTokens: 1, outputTokens: 1,
};
const say = (text: string, products: TurnRecord["replies"][number]["products"] = []) =>
  [{ sender: "ai" as const, text, products, quickReplies: [] }];

describe("extractAmounts", () => {
  it("reads the price formats a reply uses", () => {
    expect(extractAmounts("Giá 389.000đ, hoặc 389,000 VND, 389k, 389 nghìn, 389000đ").map((a) => a.value)).toEqual([
      389000, 389000, 389000, 389000, 389000,
    ]);
    expect(extractAmounts("Tổng 1.250.000đ").map((a) => a.value)).toEqual([1250000]);
  });

  it("ignores numbers that are not money", () => {
    expect(extractAmounts("Cao 1m58 nặng 50kg, 1.65m, đổi trong 7 ngày, SĐT 0912345678, 12 Lê Lợi Quận 1")).toEqual([]);
  });
});

describe("extractStockClaims / sizes", () => {
  it("finds stock counts", () => {
    expect(extractStockClaims("Màu be size M còn 7 cái, size L còn lại 2 chiếc, tồn kho: 5")).toEqual([7, 2, 5]);
  });
  it("names sizes in order and as words", () => {
    expect(sizesNamed("chiều cao hợp size S, cân nặng hợp size M, nên chọn size M")).toEqual(["S", "M", "M"]);
    expect(sizesNamed("nằm ngoài bảng size của shop")).toEqual([]);
    expect(saysSize("còn size S và L", "L")).toBe(true);
    expect(saysSize("còn hàng lắm", "L")).toBe(false);
  });
  it("measures how much of the owner's reason the reply kept", () => {
    expect(reasonOverlap("Cardigan khoác ngoài váy suông linen khi vào phòng lạnh", "Cardigan khoác ngoài váy suông linen khi vào phòng lạnh.")).toBe(1);
    expect(reasonOverlap("Đẹp lắm bạn", "Cardigan khoác ngoài váy suông linen")).toBeLessThan(0.6);
  });
});

describe("dataChecks", () => {
  it("passes when every amount, card and stock count matches the data", () => {
    const card = { productId: linen.id, name: linen.name, price: linen.price, sizesInStock: ["M"] };
    const checks = dataChecks(snapshot, {
      conversationId: "c",
      orders: [],
      stockAfter: {},
      turns: [turn({ productId: linen.id, replies: say("Váy giá 389.000đ, màu Be size M còn 7 cái. Miễn phí giao từ 500.000đ.", [card]), aiTurn })],
    });
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("flags an amount, a card price and a stock count not in the data", () => {
    const card = { productId: linen.id, name: linen.name, price: 350000, sizesInStock: ["M"] };
    const checks = dataChecks(snapshot, {
      conversationId: "c",
      orders: [],
      stockAfter: {},
      turns: [turn({ productId: linen.id, replies: say("Váy giá 350.000đ, còn 99 cái.", [card]), aiTurn })],
    });
    expect(checks.filter((c) => !c.ok).map((c) => c.detail)).toEqual([
      "số tiền lạ: 350.000d",
      "Váy suông linen: 350.000đ ≠ 389.000đ",
      "số tồn lạ: 99",
    ]);
  });

  it("allows amounts the shopper wrote and quote_order returned", () => {
    const quote = { ...aiTurn, toolCalls: [{ name: "quote_order", input: {}, output: { total: 778000 } }] };
    const checks = dataChecks(snapshot, {
      conversationId: "c",
      orders: [],
      stockAfter: {},
      turns: [turn({ shopper: "bớt 50k nhé", replies: say("Không bớt 50k được ạ, 2 cái là 778.000đ."), aiTurn: quote })],
    });
    expect(checks[0].ok).toBe(true);
  });
});

describe("classifyInfra", () => {
  it("keeps the engine failure text equal to receive.ts", () => {
    expect(ENGINE_FAILURE_TEXT).toBe(HANDOFF_TEXT);
  });

  it("separates deployment failures from AI answers", () => {
    expect(classifyInfra(turn({ httpStatus: 429, error: "Bạn nhắn hơi nhanh" }))).toMatch(/429/);
    expect(classifyInfra(turn({ httpStatus: 500, error: "x" }))).toMatch(/500/);
    expect(classifyInfra(turn({ httpStatus: null, error: "ECONNRESET" }))).toMatch(/ECONNRESET/);
    expect(classifyInfra(turn({ status: "rate_limited", replies: say("chờ") }))).toMatch(/PB-17/);
    expect(classifyInfra(turn({ status: "handed_off", replies: [{ sender: "system", text: ENGINE_FAILURE_TEXT, products: [], quickReplies: [] }] }))).toMatch(/Engine lỗi/);
    // The same notice with an ai_turns row is a real handoff the AI chose.
    expect(classifyInfra(turn({ status: "handed_off", replies: [{ sender: "system", text: ENGINE_FAILURE_TEXT, products: [], quickReplies: [] }], aiTurn }))).toBeNull();
    expect(classifyInfra(turn({ replies: say("Dạ còn ạ"), aiTurn }))).toBeNull();
  });
});
