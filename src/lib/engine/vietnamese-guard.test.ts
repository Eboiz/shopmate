import { describe, expect, it } from "vitest";
import { findEnglish } from "./vietnamese-guard";

describe("findEnglish (F6)", () => {
  it.each([
    ["còn hàng, stock 7", "stock"],
    ["Màu be In Stock ạ", "In Stock"],
    ["Size M out of stock rồi", "out of stock"],
    ["Bạn xem size chart nhé", "size chart"],
    ["Mẫu này sold out ạ", "sold out"],
    ["Size L available ạ", "available"],
  ])("%s → %s", (reply, word) => {
    expect(findEnglish(reply)).toBe(word);
  });

  it.each([
    "size M còn 7 cái",
    "Áo khoác bomber",
    "Áo polo nữ size XL",
    "Quần jean mom fit màu đen",
    "Áo thun croptop gân, form rộng",
    "Dạ chào bạn, bạn đang tìm món gì ạ?",
  ])("%s → null", (reply) => {
    expect(findEnglish(reply)).toBeNull();
  });
});
