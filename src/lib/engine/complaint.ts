// PB-20: the reply assistant shows "reply personally" instead of a draft when
// the pasted question is a complaint (engine output personalReplyNeeded).
//
// Deterministic and checked on the server before any model call, so a complaint
// never costs a Claude call and the result does not depend on the model. It errs
// toward a draft: a missed complaint still gets a draft that only uses shop data,
// which staff read before sending; a false alarm would block a normal question.

// Matched on the lowercased text with diacritics. Vietnamese words that lose
// their meaning without diacritics ("lỗi" vs "lời", "lợi") are only listed here.
// A question before buying ("áo có bị phai màu không?", "sợ chọn sai size") is
// not a complaint, so defect words count only when they describe what happened.
const WITH_DIACRITICS: RegExp[] = [
  /khiếu nại/,
  // "lỗi" (defect), but not "xin lỗi" (sorry).
  /(?<!xin )(?<!\p{L})lỗi(?!\p{L})/u,
  /(?<!(có|dễ|sợ|lo|không) )bị (hỏng|rách|thủng|bung chỉ|tuột chỉ|phai màu|ra màu|co rút|dơ|bẩn|mốc)/u,
  /(giao|gửi|gởi|ship|nhận được|nhận) (sai|nhầm|thiếu)/,
  /chưa (nhận được|thấy) hàng/,
  /(chậm|trễ|lâu) quá/,
  /lừa đảo|bị lừa|lừa khách/,
  /thất vọng|không hài lòng|bực mình|quá đáng|vô trách nhiệm/,
  /(?<!\p{L})tệ(?!\p{L})/u,
  /kém chất lượng|chất lượng kém/,
  /bồi thường|đền tiền|trả lại tiền cho|đòi tiền/,
  /(?<!\p{L})phốt(?!\p{L})|tố cáo/u,
];

// Matched on the text without diacritics: phrases a shopper typing without
// accents may use, chosen so they mean nothing else without them.
const WITHOUT_DIACRITICS: RegExp[] = [
  /khieu nai/,
  /(hang|ao|vay|quan|san pham) (bi )?loi(?![a-z])/,
  /(?<!(co|de|so|lo|khong) )bi (rach|thung|bung chi|tuot chi)/,
  /(giao|gui|ship) (sai|nham|thieu)/,
  /chua nhan duoc hang/,
  /lua dao/,
  /that vong|khong hai long|boi thuong|kem chat luong|chat luong kem/,
  /boc phot/,
];

function withoutDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
}

export function isComplaint(text: string): boolean {
  const lower = text.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
  if (WITH_DIACRITICS.some((pattern) => pattern.test(lower))) return true;
  const plain = withoutDiacritics(lower);
  return WITHOUT_DIACRITICS.some((pattern) => pattern.test(plain));
}

// Required by the reply shape; the reply assistant shows its own note instead.
export const PERSONAL_REPLY_TEXT =
  "Đây là khiếu nại của khách. Bạn đọc kỹ nội dung và tự trả lời khách nhé.";
