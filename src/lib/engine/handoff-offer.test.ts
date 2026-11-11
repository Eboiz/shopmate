import { describe, expect, it } from "vitest";
import { asksForHuman, isNearChart, OFFER_NO, OFFER_QUESTION, OFFER_YES, offerAnswer, offersStaff, sizeOfferText } from "./handoff-offer";

describe("offerAnswer", () => {
  it("reads the quick replies", () => {
    expect(offerAnswer(OFFER_YES)).toBe("yes");
    expect(offerAnswer(OFFER_NO)).toBe("no");
  });
  it("reads short yes/no answers, with or without diacritics", () => {
    for (const t of ["có", "Có ạ", "ok", "vâng", "đồng ý", "cho gặp nhân viên", "co nhe!"]) expect(offerAnswer(t), t).toBe("yes");
    for (const t of ["không", "ko cần", "thôi", "không cần đâu", "k"]) expect(offerAnswer(t), t).toBe("no");
  });
  it("a longer message is a new question, not an answer", () => {
    expect(offerAnswer("có size L không shop")).toBeNull();
    expect(offerAnswer("không biết váy này giặt máy được không")).toBeNull();
  });
});

describe("size offers", () => {
  it("names the nearest size only just outside the chart", () => {
    expect(isNearChart({ offCm: 3, offKg: 0 })).toBe(true);
    expect(isNearChart({ offCm: 0, offKg: 4 })).toBe(false);
    expect(sizeOfferText({ nearestSize: "XL", offCm: 2, offKg: 1 })).toContain("Size gần nhất shop có là XL");
    expect(sizeOfferText({ nearestSize: "XL", offCm: 8, offKg: 15 })).not.toContain("XL");
    expect(sizeOfferText(null)).toContain("chưa có bảng size");
  });
  it("every size text ends by offering staff", () => {
    for (const t of [sizeOfferText(null), sizeOfferText({ nearestSize: "L", offCm: 1, offKg: 0 }), sizeOfferText({ nearestSize: "L", offCm: 9, offKg: 9 })]) {
      expect(t).toMatch(/nhân viên shop trả lời thêm không\?$/);
    }
  });
});

it("offersStaff spots the yes button", () => {
  expect(offersStaff({ quickReplies: [OFFER_YES, OFFER_NO] })).toBe(true);
  expect(offersStaff({ quickReplies: ["Váy"] })).toBe(false);
  // the model asked the offer question but forgot the buttons
  expect(offersStaff({ text: `Dạ shop chưa có thông tin này. ${OFFER_QUESTION}`, quickReplies: [] })).toBe(true);
  expect(offersStaff({ text: "Dạ còn ạ", quickReplies: [] })).toBe(false);
});

it("asksForHuman: a person, staff or the owner is named; an order is not a request for a human", () => {
  for (const t of ["cho gặp nhân viên", "kêu chủ ra", "cho gặp chủ shop", "mình muốn nói chuyện với người thật", "cho gap nhan vien de dat hang"]) {
    expect(asksForHuman(t), t).toBe(true);
  }
  for (const t of ["cho mua 1 áo blazer màu đen size S", "lấy cái đen size S", "chủ nhật có giao không"]) expect(asksForHuman(t), t).toBe(false);
});
