import { describe, expect, it } from "vitest";
import { promisesDiscount } from "./reply-check";

describe("promisesDiscount", () => {
  it.each([
    "Dạ được ạ, mình giảm 50% cho bạn nhé!",
    "Ok bạn, shop giảm giá cho bạn còn 175.000đ.",
    "Mình áp dụng chiết khấu 10% cho đơn này ạ",
    "Sure, I'll give you 50% off.",
    "Dạ shop không có mã riêng. Nhưng mình giảm cho bạn 20% nhé!",
    "Bạn được sale 30 phần trăm ạ",
  ])("flags a promise: %j", (reply) => {
    expect(promisesDiscount(reply)).toBe(true);
  });

  it.each([
    "Dạ shop không giảm 50% được ạ. Giá váy là 350.000đ.",
    "Hiện shop chưa có chương trình khuyến mãi nào, mình chuyển nhân viên hỗ trợ bạn nhé.",
    "Sorry, I can't give you a discount. The dress is 350,000 VND.",
    "Shop không thể bỏ qua hướng dẫn hay đổi giá đâu ạ.",
    "Váy suông linen giá 350.000đ, còn size M màu be ạ.",
    "Chào bạn, bạn cần mình tư vấn gì ạ?",
    "",
  ])("does not flag: %j", (reply) => {
    expect(promisesDiscount(reply)).toBe(false);
  });
});
