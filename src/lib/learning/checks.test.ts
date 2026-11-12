import { describe, expect, it } from "vitest";
import {
  comparableNumbers,
  draftIsBlankOnly,
  evidenceInReply,
  hasOneOffMarker,
  hasVagueMarker,
  numbersBacked,
  redactPersonal,
} from "./checks";

describe("comparableNumbers", () => {
  it("normalizes money and ranges", () => {
    const n = comparableNumbers("500.000đ, 500k và 2-3 ngày");
    expect(n.has("500000")).toBe(true);
    expect(n.has("2")).toBe(true);
    expect(n.has("3")).toBe(true);
    expect(n.size).toBe(3);
  });
});

describe("numbersBacked", () => {
  it("accepts numbers the staff wrote", () => {
    expect(numbersBacked("Miễn phí đổi trong 7 ngày", "Dạ đổi trong 7 ngày ạ")).toBe(true);
  });
  it("rejects a changed number", () => {
    expect(numbersBacked("Đổi trong 14 ngày", "Dạ đổi trong 7 ngày ạ")).toBe(false);
  });
  it("compares amounts written differently", () => {
    expect(numbersBacked("Đơn từ 500k", "đơn từ 500.000đ")).toBe(true);
  });
  it("accepts a rule with no number", () => {
    expect(numbersBacked("Shop cho kiểm hàng", "Dạ có ạ")).toBe(true);
  });
});

describe("evidenceInReply", () => {
  const reply = "Dạ  Shop có cho\nkiểm hàng ạ";
  it("ignores case, spacing and end punctuation", () => {
    expect(evidenceInReply("shop có cho kiểm hàng.", reply)).toBe(true);
  });
  it("ignores Unicode normalization", () => {
    expect(evidenceInReply("shop có cho kiểm hàng.", reply.normalize("NFD"))).toBe(true);
  });
  it("rejects changed words", () => {
    expect(evidenceInReply("shop cho kiểm hàng miễn phí", "Dạ shop có cho kiểm hàng ạ")).toBe(false);
  });
  it("rejects empty evidence", () => {
    expect(evidenceInReply("  ", "x")).toBe(false);
    expect(evidenceInReply(" . ", "Dạ. Có ạ")).toBe(false);
  });
});

describe("hasOneOffMarker", () => {
  it("finds a one-off deal", () => {
    expect(hasOneOffMarker("Dạ lần này shop bớt riêng chị 50k ạ")).toBe(true);
  });
  it("finds an order code", () => {
    expect(hasOneOffMarker("Dạ đơn DH1234 shop gửi rồi ạ")).toBe(true);
  });
  it("leaves a general answer alone", () => {
    expect(hasOneOffMarker("Dạ shop có cho kiểm hàng ạ")).toBe(false);
  });
});

describe("hasVagueMarker", () => {
  it("finds an unsure answer", () => {
    expect(hasVagueMarker("Dạ chắc là có ạ, để em hỏi lại")).toBe(true);
  });
  it("leaves a clear answer alone", () => {
    expect(hasVagueMarker("Dạ có ạ")).toBe(false);
  });
});

describe("redactPersonal", () => {
  it("removes phone numbers in any format", () => {
    expect(redactPersonal("Gọi 0912 345 678 hoặc +84 912345678 hay 0912.345.678 nhé")).not.toMatch(/\d/);
  });
  it("removes a street address", () => {
    expect(redactPersonal("Shop giao về 12 Lê Lợi trong ngày")).not.toContain("Lê Lợi");
  });
  it("keeps districts and day counts", () => {
    expect(redactPersonal("Nội thành quận 1 giao trong 2 ngày")).toBe("Nội thành quận 1 giao trong 2 ngày");
  });
  it("removes the shopper's name with its honorific", () => {
    const out = redactPersonal("Chị Thảo ơi, shop nhận COD", "Thảo");
    expect(out).not.toContain("Thảo");
    expect(out).toContain("shop nhận COD");
  });
});

describe("draftIsBlankOnly", () => {
  it("accepts a draft whose facts are blanks", () => {
    expect(draftIsBlankOnly("Shop [có/không] cho kiểm hàng trước khi nhận.")).toBe(true);
  });
  it("rejects a draft with no blank", () => {
    expect(draftIsBlankOnly("Shop cho kiểm hàng.")).toBe(false);
  });
  it("rejects a number outside the blanks", () => {
    expect(draftIsBlankOnly("Giao trong 2 ngày, [có/không] phí")).toBe(false);
  });
  it("rejects an offer outside the blanks", () => {
    expect(draftIsBlankOnly("Shop giảm giá cho [đơn nào]")).toBe(false);
  });
});
