// PB-45 (Eboiz/Documents#48) eval cases on shop A of the two-shop fixture: the
// bot agreed to a size the shop doesn't sell (QA Bot #1) and left out a color in
// stock when asked "Còn màu nào khác?" (QA Bug #2 / Bot #4).
//
// The report's product (Áo blazer dáng suông: Be S 5, Đen S 8) is the demo
// seed's. On shop A the same shapes are on Váy suông linen: sizes M and L sold
// (chart S/M/L; 158 cm / 50 kg is M), M be 2 and M đen 5 in stock, no XXL.
import type { HistoryMessage } from "@/contract";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase } from "./cases";

const V = FX.a.vay01;
const words = (t: string) => fold(t).split(/[^a-z0-9]+/);
const names = (word: string) => (t: string) => words(t).includes(word);
// "chọn size XXL cũng được", "để xem còn size XXL không": agrees to XXL or
// promises to check it.
const agreesToXxl = (t: string) => /xxl (cung duoc|duoc nhe|duoc a|ok)|(xem|kiem tra|check)( lai)? (con )?(size )?xxl/.test(fold(t));
const saysNoXxl = (t: string) => /(khong|chua) (co|ban|nhap) (size )?xxl/.test(fold(t));

export const pb45Cases: EvalCase[] = [
  {
    id: "pb45-bot01-unsold-size-xxl",
    description:
      "PB-45 Bot #1: 1m58 / 50kg wants XXL 'cho rộng như cái mền'. The shop has no XXL: the reply says so, never agrees or promises to check XXL stock, and advises M from the chart.",
    shouldHandOff: false,
    productId: V,
    history: [
      { sender: "shopper", text: "mình cao 1m58 nặng 50kg nhưng muốn mặc size XXL cho rộng như cái mền được không?" },
    ] satisfies HistoryMessage[],
    expected: [
      { tool: "recommend_size", args: { productId: V, heightCm: 158, weightKg: 50 }, required: true },
      // Never the stock of a size the product doesn't sell.
      { tool: "get_stock", args: { productId: V, size: (v: unknown) => v === undefined || fold(String(v)) !== "xxl" }, required: false },
      { tool: "search_products", required: false },
    ],
    outcome: { decision: "answer" },
    reply: { label: "says there is no XXL, advises M, never agrees to XXL", ok: (t) => saysNoXxl(t) && !agreesToXxl(t) && names("m")(t) },
  },
  {
    id: "pb45-bug02-other-colors",
    description:
      "PB-45 Bug #2: after a turn about black size M, 'Còn màu nào khác?'. get_stock runs without the earlier color and the reply names every color in stock in M: be and đen.",
    shouldHandOff: false,
    productId: V,
    history: [
      { sender: "shopper", text: "Váy này màu đen size M còn không shop?" },
      { sender: "ai", text: "Dạ, váy suông linen màu đen size M còn 5 chiếc ạ." },
      { sender: "shopper", text: "Còn màu nào khác?" },
    ] satisfies HistoryMessage[],
    expected: [
      { tool: "get_stock", args: { productId: V, color: (v: unknown) => v === undefined }, required: true },
      { tool: "search_products", required: false },
    ],
    outcome: { decision: "answer" },
    reply: { label: "names be and đen", ok: (t) => names("be")(t) && names("den")(t) },
  },
];
