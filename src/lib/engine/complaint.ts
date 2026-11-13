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
//
// PB-38: the patterns in EVENTS name something that can go wrong with an order
// (a defect, a wrong or missing item, a late parcel, a refund). Asked as a
// hypothetical before buying ("Nếu shop giao sai màu thì có được đổi không?",
// "Mình chưa đặt, lỡ áo bị rách thì sao?") they are a policy question the shop's
// policy text answers, so they don't count there (see isHypothetical). The
// patterns in ALWAYS (the word "khiếu nại", anger, fraud) count wherever they are.
const EVENTS_WITH_DIACRITICS: RegExp[] = [
  // "lỗi" (defect), but not "xin lỗi" (sorry).
  /(?<!xin )(?<!\p{L})lỗi(?!\p{L})/u,
  /(?<!(có|dễ|sợ|lo|không) )bị (hỏng|rách|thủng|bung chỉ|tuột chỉ|phai màu|ra màu|co rút|dơ|bẩn|mốc)/u,
  /(giao|gửi|gởi|ship|nhận được|nhận) (sai|nhầm|thiếu)/,
  /chưa (nhận được|thấy) hàng/,
  /(chậm|trễ|lâu) quá/,
  /kém chất lượng|chất lượng kém/,
  /bồi thường|đền tiền|trả lại tiền cho|đòi tiền/,
];
const ALWAYS_WITH_DIACRITICS: RegExp[] = [
  /khiếu nại/,
  /lừa đảo|bị lừa|lừa khách/,
  /thất vọng|không hài lòng|bực mình|quá đáng|vô trách nhiệm/,
  /(?<!\p{L})tệ(?!\p{L})/u,
  /(?<!\p{L})phốt(?!\p{L})|tố cáo/u,
];

// Matched on the text without diacritics: phrases a shopper typing without
// accents may use, chosen so they mean nothing else without them.
const EVENTS_WITHOUT_DIACRITICS: RegExp[] = [
  /(hang|ao|vay|quan|san pham) (bi )?loi(?![a-z])/,
  /(?<!(co|de|so|lo|khong) )bi (rach|thung|bung chi|tuot chi)/,
  /(giao|gui|ship) (sai|nham|thieu)/,
  /chua nhan duoc hang/,
  /boi thuong|kem chat luong|chat luong kem/,
];
const ALWAYS_WITHOUT_DIACRITICS: RegExp[] = [/khieu nai/, /lua dao/, /that vong|khong hai long/, /boc phot/];

// PB-38: the shopper says they haven't ordered yet, so whatever "goes wrong" in
// the message is hypothetical.
const NOT_ORDERED = /(?<!\p{L})(?:chưa|chua) (?:đặt|dat|mua|order)(?!\p{L})/u;

// A word that opens a hypothetical or a worry before buying ("nếu", "giả sử",
// "trường hợp", "lỡ", "nhỡ", "sợ", "lo"), with or without diacritics. After the
// shop or its staff, "lỡ"/"nhỡ" means "by mistake" ("shop lỡ giao sai màu" is a
// complaint), and "trường hợp của mình" tells what happened: neither opens one.
// Matched on the clause as written, so the plain forms ("neu", "lo") only count
// when the shopper typed without diacritics; plain "nho" is left out ("nhỏ").
const HYPOTHETICAL =
  /(?<!\p{L})(?:nếu|neu|giả sử|gia su|giả dụ|gia du|ngộ nhỡ|ngo nho|sợ|trường hợp(?! (?:của|cua)(?!\p{L}))|truong hop(?! cua(?!\p{L}))|(?<!(?:shop|bên|ben|viên|vien|em|bạn|ban|shipper|ship) )(?:lỡ|nhỡ|lo))(?!\p{L})/u;

// Splits a message into clauses: sentences, lines and comma-separated parts. A
// hypothetical word covers the rest of its own clause, "nếu ... thì ..." included,
// so "Shop giao sai màu cho mình rồi, nếu không đổi thì..." is still a complaint.
const CLAUSE_BREAK = /[.!?;,\n]/;

function withoutDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
}

// A clause names something that went wrong: an ALWAYS pattern anywhere, or an
// EVENT pattern that doesn't come after the clause's hypothetical opener (its
// index; Vietnamese letters lose their marks one for one, so the index is the
// same in the written and the plain clause).
function complains(clause: string, events: RegExp[], always: RegExp[], opener: number | null): boolean {
  if (always.some((pattern) => pattern.test(clause))) return true;
  return events.some((pattern) => {
    const match = pattern.exec(clause);
    return match !== null && (opener === null || opener > match.index);
  });
}

export function isComplaint(text: string): boolean {
  // Line breaks are kept: they end a clause.
  const lower = text.normalize("NFC").toLowerCase().replace(/[^\S\n]+/g, " ");
  const plain = withoutDiacritics(lower);
  // "Mình chưa đặt hàng": nothing in the message has happened yet.
  const notOrdered = NOT_ORDERED.test(lower);
  const writtenClauses = lower.split(CLAUSE_BREAK);
  const plainClauses = plain.split(CLAUSE_BREAK);
  return writtenClauses.some((written, i) => {
    const plainClause = plainClauses[i] ?? withoutDiacritics(written);
    // -1: the whole clause is hypothetical.
    const opener = notOrdered ? -1 : (HYPOTHETICAL.exec(written)?.index ?? null);
    return (
      complains(written, EVENTS_WITH_DIACRITICS, ALWAYS_WITH_DIACRITICS, opener) ||
      complains(plainClause, EVENTS_WITHOUT_DIACRITICS, ALWAYS_WITHOUT_DIACRITICS, opener)
    );
  });
}

// Required by the reply shape; the reply assistant shows its own note instead.
export const PERSONAL_REPLY_TEXT =
  "Đây là khiếu nại của khách. Bạn đọc kỹ nội dung và tự trả lời khách nhé.";
