// PB-04 (F6): replies are Vietnamese only. The English stock/size words seen in
// production ("stock 7") get one rewrite; size letters, product names and brand
// words are not matched. Pure: no IO.

export const VIETNAMESE_RETRY_NOTE =
  "Câu trả lời có từ tiếng Anh. Viết lại hoàn toàn bằng tiếng Việt (vd. \"còn 7 cái\", không viết \"stock\").";

// Unicode look-arounds instead of "\b", which only knows ASCII letters.
const ENGLISH_RE = /(?<![\p{L}\p{N}])(in stock|out of stock|stock|size chart|sold out|available)(?![\p{L}\p{N}])/iu;

// The first English stock/size word in the reply, or null.
export function findEnglish(reply: string): string | null {
  return ENGLISH_RE.exec(reply)?.[0] ?? null;
}
