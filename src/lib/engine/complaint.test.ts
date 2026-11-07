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
  ])("does not flag %s", (text) => {
    expect(isComplaint(text)).toBe(false);
  });
});
