// PB-40 eval cases: suggestions keep to what the shopper said (test report
// 12/11, BOT-02 and BOT-04), on shop A of the two-shop fixture (two-shops.ts).
//
// Shop A: Váy suông linen 350.000đ (M be 2, L be 0, M đen 5; chart L = 165–172cm,
// 54–60kg), Áo sơ mi trắng 250.000đ (S trắng 3, M trắng 0), Quần ống rộng
// 300.000đ, Áo blazer 450.000đ, two jackets 420–480.000đ, Quần jean 380.000đ.
import type { HistoryMessage } from "@/contract";
import { productGroup } from "@/lib/shop/catalog-view";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase } from "./cases";

const V = FX.a.vay01;
const saysSoldOut = (text: string) => /het hang|da het|het size|het mau|het roi|tam het/.test(fold(text));
const namesSize = (size: string) => (reply: string) => fold(reply).split(/[^a-z0-9]+/).includes(fold(size));

export const pb40Cases: EvalCase[] = [
  {
    id: "pb40-advised-size-sold-out",
    description:
      "PB-40 BOT-02: the AI advised L; L be is sold out and the shop has no L in another color. The reply says so and no button pushes M.",
    shouldHandOff: false,
    productId: V,
    history: [
      { sender: "shopper", text: "Mình cao 167cm nặng 56kg thì mặc váy này size nào?" },
      { sender: "ai", text: "Dạ với chiều cao 167cm và cân nặng 56kg, bạn mặc size L là vừa ạ." },
      { sender: "shopper", text: "Màu be size L còn không shop?" },
    ] satisfies HistoryMessage[],
    expected: [
      { tool: "get_stock", args: { productId: V }, required: true },
      { tool: "search_products", required: false },
    ],
    outcome: { decision: "answer" },
    reply: { label: "says L be is sold out", ok: saysSoldOut },
    quickReplies: { label: "no button for size M", ok: (q) => !q.some(namesSize("M")) },
  },
  {
    id: "pb40-staff-budget-no-skirt",
    description:
      "PB-40 BOT-04: staff paste '300 nghìn, đồ đi làm, không thích váy, gợi ý 2 món'. At most 2 cards, no dress or skirt, none above 300.000đ.",
    shouldHandOff: false,
    mode: "staff_draft",
    history: [
      {
        sender: "shopper",
        text: "Tôi có 300 nghìn, muốn đồ đi làm màu trắng, không thích váy. Gợi ý 2 món phù hợp có giá dưới ngân sách",
      },
    ],
    expected: [
      { tool: "search_products", required: false },
      { tool: "get_stock", required: false },
    ],
    outcome: { decision: "answer" },
    reply: { label: "names no dress", ok: (t) => !fold(t).includes("vay suong linen") },
    products: {
      label: "≤ 2 cards, no dress or skirt, price ≤ 300.000đ",
      ok: (cards) =>
        cards.length <= 2 &&
        cards.every((c) => c.price <= 300000 && !["Váy & đầm", "Chân váy"].includes(productGroup(null, c.name))),
    },
  },
];
