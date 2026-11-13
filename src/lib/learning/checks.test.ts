import { describe, expect, it } from "vitest";
import {
  comparableNumbers,
  draftIsBlankOnly,
  evidenceInReply,
  hasOneOffMarker,
  hasVagueMarker,
  numbersBacked,
  mentionsAmount,
  mentionsProductData,
  redactPersonal,
  ruleSupported,
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

describe("ruleSupported", () => {
  it("ignores function words when counting the staff's words", () => {
    expect(ruleSupported("Shop giao hàng đi Hà Nội thường mất 3-4 ngày.", "đi Hà Nội thường mất 3-4 ngày", "Dạ đi Hà Nội thường mất 3-4 ngày ạ")).toBe(true);
    expect(ruleSupported("Shop không nhận đổi trả hàng sale.", "hàng sale shop không nhận đổi trả", "Dạ hàng sale shop không nhận đổi trả chị nhé")).toBe(true);
  });
  it("rejects a rule mostly made of other words", () => {
    expect(ruleSupported("Shop bán sỉ cho đại lý ở mọi tỉnh thành.", "có", "Dạ có ạ")).toBe(false);
  });
});

describe("ruleSupported negation", () => {
  it("reads the negation from the staff's whole sentence, not only the evidence", () => {
    const reply = "Dạ shop không cho kiểm hàng trước khi nhận ạ. Đơn trên 500.000đ được freeship.";
    expect(ruleSupported("Shop cho kiểm hàng trước khi nhận.", "cho kiểm hàng trước khi nhận", reply)).toBe(false);
  });
  it("doesn't take a negation from another sentence", () => {
    const reply = "Dạ không ạ. Shop cho kiểm hàng trước khi nhận ạ";
    expect(ruleSupported("Shop cho kiểm hàng trước khi nhận.", "shop cho kiểm hàng trước khi nhận", reply)).toBe(true);
  });
});

describe("mentionsProductData", () => {
  it.each(["Mẫu này còn 3 cái.", "Còn size S.", "1m60 50kg mặc size M.", "Váy hoa giá 350k.", "Váy hoa chất voan, màu đỏ.", "Áo này form rộng."])(
    "finds %s",
    (rule) => expect(mentionsProductData(rule)).toBe(true),
  );
  it.each([
    "Shop cho đổi size trong 7 ngày.",
    "Hết size thì shop hoàn tiền.",
    "Đơn giá trị từ 500k được freeship.",
    "Áo sale không đổi trả.",
    "Đổi trong vài ngày.",
    "Shop đảm bảo chất lượng, hàng đẹp chất vải tốt.",
    "Áo lỗi chất lượng được đổi trong 7 ngày.",
    "Hết mẫu thì shop hoàn tiền.",
    "Shop giảm giá 50k cho đơn đầu.",
    "Đơn trên 10kg tính thêm phí ship.",
    "Nội thành quận 1 giao trong ngày.",
  ])("leaves %s alone", (rule) => expect(mentionsProductData(rule)).toBe(false));
});

describe("mentionsAmount", () => {
  it("finds money", () => {
    expect(mentionsAmount("Phí ship nội thành 30k.")).toBe(true);
    expect(mentionsAmount("Phí ship 25.000đ.")).toBe(true);
    expect(mentionsAmount("Phí ship 20 nghìn.")).toBe(true);
  });
  it("leaves day counts and districts alone", () => {
    expect(mentionsAmount("Nội thành quận 1 giao trong 2-3 ngày.")).toBe(false);
  });
});

