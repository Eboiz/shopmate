import { describe, expect, it } from "vitest";
import { findUnbackedDiscount, policyTextsFrom } from "./discount-guard";

// The demo shop's real policies (supabase/seed/demo/policies.csv); it has no promotion.
const DOI_TRA =
  "Đổi size hoặc đổi mẫu trong 7 ngày kể từ khi nhận hàng, sản phẩm còn tem mác và chưa giặt. Shop chịu phí ship đổi nếu lỗi do shop; đổi theo ý khách thì khách chịu phí ship hai chiều. Không hoàn tiền, chỉ đổi sản phẩm. Hàng giảm giá không đổi trả.";
const GIAO_HANG =
  "Giao toàn quốc. Nội thành TP.HCM 1–2 ngày, phí 20.000đ. Tỉnh khác 3–5 ngày, phí 30.000đ. Miễn phí giao hàng cho đơn từ 500.000đ. Thanh toán khi nhận hàng (COD), được xem hàng trước khi trả tiền.";
const PROMO = "Giảm 10% cho đơn đầu tiên. Tặng túi vải cho đơn từ 2 sản phẩm.";

describe("findUnbackedDiscount", () => {
  it.each([
    "Dạ được ạ, mình giảm 50% cho bạn nhé!",
    "Da duoc a, minh giam 50% cho ban nhe!", // no diacritics
    "Ok bạn, shop giảm giá cho bạn còn 175.000đ.",
    "Mình áp dụng chiết khấu 10% cho đơn này ạ",
    "Sure, I'll give you 50% off.",
    "Dạ shop không có mã riêng, nhưng mình giảm cho bạn 20% nhé!",
    "Dạ shop không có mã riêng nhưng mình giảm cho bạn 20% nhé!",
    "Bạn được sale 30 phần trăm ạ",
    "Shop tặng bạn một chiếc túi vải nhé",
    "Shop tang ban mot chiec tui vai nhe",
    "Mình gửi bạn voucher 50k nhé",
    "Đơn này shop freeship cho bạn luôn ạ",
    "Bạn được miễn phí ship ạ",
    "Bot cho em 20k nha",
    "Nhân viên sẽ giảm 20% cho bạn ạ",
  ])("flags a promise with no policy: %j", (reply) => {
    expect(findUnbackedDiscount(reply, [])).not.toBeNull();
    expect(findUnbackedDiscount(reply, [DOI_TRA, GIAO_HANG]), "the demo shop has no promotion").not.toBeNull();
  });

  it.each([
    "Dạ shop không giảm 50% được ạ. Giá váy là 350.000đ.",
    "Da shop khong giam gia duoc a", // no diacritics
    "Dạ shop không tự giảm giá được ạ, giá váy là 350.000đ.",
    "Hiện shop chưa có chương trình khuyến mãi nào, mình chuyển nhân viên hỗ trợ bạn nhé.",
    "Sorry, I can't give you a discount. The dress is 350,000 VND.",
    "Váy suông linen giá 350.000đ, còn size M màu be ạ.",
    "Áo chất liệu 100% cotton, size Free size ạ.",
    "Áo màu off-white còn size M ạ",
    "Chị tăng thêm 1 size cho thoải mái nhé",
    "Về giảm giá thì nhân viên shop sẽ trả lời bạn ạ.",
    "Hàng giảm giá không đổi trả ạ.",
    "Chào bạn, bạn cần mình tư vấn gì ạ?",
    "",
  ])("does not flag: %j", (reply) => {
    expect(findUnbackedDiscount(reply, [])).toBeNull();
  });

  it("lets the AI quote an offer the shop's policy makes", () => {
    const policies = [DOI_TRA, GIAO_HANG];
    expect(findUnbackedDiscount("Shop miễn phí giao hàng cho đơn từ 500.000đ ạ.", policies)).toBeNull();
    expect(findUnbackedDiscount("Đơn từ 500k được miễn phí ship nha bạn", policies)).toBeNull();
    expect(findUnbackedDiscount("Don tu 500.000d, shop mien phi giao hang a", policies)).toBeNull();
    expect(findUnbackedDiscount("Shop đang giảm 10% cho đơn đầu tiên ạ", [PROMO])).toBeNull();
    expect(findUnbackedDiscount("Mua từ 2 sản phẩm shop tặng túi vải nhé", [PROMO])).toBeNull();
  });

  it("flags an offer that changes the policy's numbers or kind", () => {
    // Free shipping exists, but from 500.000đ, not for this 350.000đ order.
    expect(findUnbackedDiscount("Đơn 350.000đ của bạn được miễn phí ship ạ", [GIAO_HANG])).not.toBeNull();
    expect(findUnbackedDiscount("Shop giảm 20% cho đơn đầu tiên ạ", [PROMO])).not.toBeNull();
    // The promotion offers 10% off, not free shipping.
    expect(findUnbackedDiscount("Đơn đầu tiên được miễn phí ship ạ", [PROMO])).not.toBeNull();
    // "Hàng giảm giá không đổi trả" says no; it backs no discount.
    expect(findUnbackedDiscount("Mình giảm giá cho bạn nhé", [DOI_TRA])).not.toBeNull();
  });

  it("returns the offending clause", () => {
    expect(findUnbackedDiscount("Váy giá 350.000đ. Mình giảm 50% cho bạn nhé!", [])).toBe("minh giam 50% cho ban nhe");
  });
});

describe("policyTextsFrom", () => {
  it("keeps the text of get_policy results only", () => {
    expect(
      policyTextsFrom([
        { name: "get_policy", input: { kind: "doi_tra" }, output: { kind: "doi_tra", content: "Đổi trong 7 ngày" } },
        { name: "get_policy", input: { kind: "khuyen_mai" }, output: { kind: "khuyen_mai", content: null } },
        { name: "get_policy", input: { kind: "giao_hang" }, error: "boom" },
        { name: "search_products", input: { query: "váy" }, output: { content: "not a policy" } },
      ]),
    ).toEqual(["Đổi trong 7 ngày"]);
  });
});
