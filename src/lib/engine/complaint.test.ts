import { describe, expect, it } from "vitest";
import { isComplaint } from "./complaint";

describe("isComplaint", () => {
  it.each([
    "Mình muốn khiếu nại đơn hôm qua",
    "Áo mình nhận về bị lỗi đường may",
    "Váy bị rách ở vai, shop xử lý sao đây?",
    "Shop giao sai màu cho mình rồi",
    "Mình nhận thiếu 1 cái quần",
    "Đặt 5 ngày rồi mà chưa nhận được hàng",
    "Giao lâu quá shop ơi",
    "Hàng tệ thật sự, thất vọng",
    "Mình không hài lòng với chất lượng",
    "Shop lừa đảo à?",
    "Mình sẽ bóc phốt shop",
    "Shop phải bồi thường cho mình",
    "KHIẾU NẠI: áo bị phai màu sau 1 lần giặt",
    // typed without diacritics
    "minh muon khieu nai",
    "ao bi loi roi shop oi",
    "shop giao nham size roi",
    "chua nhan duoc hang",
    // PB-38: real complaints still hand off, even with a hypothetical word elsewhere
    "Shop giao sai màu cho tôi rồi",
    "Nhận được hàng bị rách",
    "Tôi đặt rồi mà giao thiếu",
    "Shop giao sai màu cho mình rồi, nếu không đổi thì mình báo",
    "Nếu được thì đổi giúp mình, shop giao sai màu rồi",
    "Shop lỡ giao sai màu cho mình rồi",
    "Trường hợp của mình là shop giao thiếu 1 cái",
    "Mình chưa nhận được hàng, nếu mai chưa có thì sao?",
    "Nếu shop giao sai thì mình sẽ khiếu nại",
    "Hàng giao sai màu. Nếu đổi thì ai trả ship?",
    "shop giao sai mau roi, neu khong doi thi sao",
    "Nếu được thì đổi giúp mình\nshop giao sai màu rồi",
    "Bên shop nhỡ gửi nhầm size cho mình",
    "Áo chất lượng chưa đạt, shop giao sai màu rồi",
    "ao nho bi rach roi shop oi",
  ])("flags %s", (text) => {
    expect(isComplaint(text)).toBe(true);
  });

  it.each([
    "Váy suông linen còn size M không?",
    "Mình cao 1m58 nặng 50kg mặc size nào?",
    "Xin lỗi cho mình hỏi shop có giao Hà Nội không",
    "Shop trả lời giúp mình phí ship bao nhiêu",
    "Áo này có bị phai màu không shop?",
    "Vải có dễ bị rách không?",
    "Mình sợ chọn sai size quá",
    "Shop có chính sách đổi trả thế nào?",
    "Shop có hoàn tiền không nếu không vừa?",
    "Áo này phối với quần gì đẹp?",
    "Túi da hồng còn không",
    "ao nay co bi rach khong",
    "loi ich cua vai linen la gi",
    // PB-38: a hypothetical question before buying is a policy question
    "Tôi chưa đặt hàng. Nếu nhận áo bị shop giao sai màu thì tôi có phải trả phí ship đổi không? Có được hoàn tiền không?",
    "Nếu shop giao sai size thì mình có được đổi không?",
    "Lỡ áo bị rách thì shop có đổi không?",
    "Lỡ như giao thiếu thì sao shop?",
    "Trường hợp giao nhầm màu, mình đổi được không?",
    "Giả sử hàng bị lỗi thì shop xử lý sao?",
    "Mình chưa mua, hàng lỗi thì shop có đổi không?",
    "Nếu nhận được hàng bị hỏng thì shop có bồi thường không?",
    "Shop có đổi không nếu giao sai màu?",
    "toi chua dat hang. neu shop giao sai mau thi co duoc doi khong",
    "neu ao bi loi thi sao shop",
    "lo giao nham size thi doi duoc khong",
    "truong hop ship sai mau thi sao",
    "Mình sợ shop giao sai màu, có đổi được không?",
    "Mình lo hàng bị lỗi, shop có bảo hành không?",
    "Mình chưa mua. Giao sai màu thì đổi được không?",
  ])("does not flag %s", (text) => {
    expect(isComplaint(text)).toBe(false);
  });
});
