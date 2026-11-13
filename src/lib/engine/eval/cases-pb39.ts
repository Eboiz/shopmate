// PB-39 (Eboiz/Documents#42) eval cases on shop A of the two-shop fixture: the
// bot said it had no price / no shipping fee while the tool results or the
// shop's policy had them (test report 12/11, BOT-01 and BOT-05).
//
// Fixture-dependent, like the PB-31 Sunday cases. The report's product (Áo sơ mi
// trắng công sở, 289.000đ) and shipping text (đồng giá 30.000đ) are the demo
// seed's. On shop A: Áo sơ mi trắng has no size chart, so BOT-01 is asked about
// Váy suông linen (chart S/M/L; 160 cm / 50 kg is M; 350.000đ; M be and M đen in
// stock). Shop A's giao_hang is blank (other cases rely on that), so BOT-05 must
// read giao_hang and offer staff (policy_not_covered), never answer with doi_tra.
import type { HistoryMessage } from "@/contract";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase } from "./cases";

const V = FX.a.vay01;

// "chưa có thông tin", "chưa có giá", or a promise to check and update later.
const claimsMissing = (t: string) =>
  /\b(chua|khong) co (thong tin|gia|phi)\b|\bchua (ro|biet|nam)\b|\bcap nhat\b|\bbao lai\b/.test(fold(t));
const saysPrice = (vnd: number) => (t: string) => {
  const s = fold(t).replace(/[.,\s]/g, "");
  return s.includes(String(vnd)) || s.includes(`${vnd / 1000}k`);
};
const saysSize = (size: string) => (t: string) => new RegExp(`(^|[^a-z0-9])${size}([^a-z0-9]|$)`).test(fold(t));

// After a returns question, the conversation went to staff and came back.
const HANDBACK: HistoryMessage[] = [
  { sender: "shopper", text: "Mua về mặc không vừa thì đổi được không shop?" },
  { sender: "ai", text: "Dạ, shop hỗ trợ đổi trong 7 ngày ạ." },
  { sender: "shopper", text: "Cho mình gặp nhân viên với" },
  { sender: "ai", text: "Dạ, mình đã chuyển câu hỏi của bạn cho nhân viên shop. Nhân viên sẽ trả lời bạn sớm nhé!" },
  { sender: "staff", text: "Dạ chị đã kiểm tra giúp bạn rồi nha, bạn hỏi tiếp trợ lý của shop nhé." },
  { sender: "shopper", text: "phí ship bao nhiêu?" },
];

export const pb39Cases: EvalCase[] = [
  {
    id: "pb39-bot01-size-price-colors",
    description:
      "PB-39 BOT-01: size + price + colors in stock in one message. Advise M (recommend_size 160/50), say 350.000đ and the " +
      "colors in stock from get_stock; never 'chưa có thông tin' or 'để mình kiểm tra và cập nhật'.",
    shouldHandOff: false,
    history: [{ sender: "shopper", text: "Mình muốn mua váy suông linen, cao 160cm nặng 50kg. Tư vấn size và báo giá, màu còn hàng giúp mình." }],
    productId: V,
    expected: [
      { tool: "recommend_size", args: { productId: V, heightCm: 160, weightKg: 50 }, required: true },
      { tool: "get_stock", args: { productId: V }, required: true },
      { tool: "search_products", required: false },
    ],
    outcome: { decision: "answer" },
    reply: {
      label: "size M, 350.000đ, a color in stock, no 'missing' claim",
      ok: (t) => saysSize("m")(t) && saysPrice(350000)(t) && /\b(be|den)\b/.test(fold(t)) && !claimsMissing(t),
    },
  },
  {
    id: "pb39-bot05-ship-fee-after-handback",
    description:
      "PB-39 BOT-05: after a returns talk and a handback, 'phí ship bao nhiêu?' reads giao_hang, not doi_tra. Shop A's " +
      "giao_hang is blank, so offer staff (policy_not_covered) without the returns policy; on the demo seed it is an answer with 30.000đ.",
    shouldHandOff: true,
    history: HANDBACK,
    expected: [{ tool: "get_policy", args: { kind: "giao_hang" }, required: true }],
    outcome: { decision: "offer", reason: "policy_not_covered" },
    reply: {
      label: "no returns policy, no promised update",
      ok: (t) => !/\b7 ngay\b|doi tra|\bdoi\b/.test(fold(t)) && !/\bcap nhat\b|\bbao lai\b/.test(fold(t)),
    },
  },
];
