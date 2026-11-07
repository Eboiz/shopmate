// PB-14 (handoff to staff) eval cases on shop A of the two-shop fixture.
// Shop A policies: doi_tra "Đổi trong 7 ngày", no giao_hang, no khuyen_mai.
// Váy suông linen (FX.a.vay01) has size chart; Áo sơ mi trắng (FX.a.ao03) has none.
import type { HistoryMessage } from "@/contract";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase } from "./cases";

const V = FX.a.vay01;
const AO = FX.a.ao03;
const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
const saysStaffWillReply = (text: string) => fold(text).includes("nhan vien");

export const pb14Cases: EvalCase[] = [
  {
    id: "pb14-complaint",
    description: "PB-14 AC1: shopper complains -> calls handoff_to_staff with reason complaint.",
    history: shopper("Đồ giao bị rách rồi shop ơi, làm ăn kỳ vậy!"),
    expected: [{ tool: "handoff_to_staff", args: { reason: "complaint" }, required: true }],
    handoff: "complaint",
    reply: { label: "mentions staff will reply", ok: saysStaffWillReply },
  },
  {
    id: "pb14-asked-for-human",
    description: "PB-14 AC1: shopper asks for a person -> calls handoff_to_staff with reason asked_for_human.",
    history: shopper("Cho mình nói chuyện với nhân viên được không?"),
    expected: [{ tool: "handoff_to_staff", args: { reason: "asked_for_human" }, required: true }],
    handoff: "asked_for_human",
    reply: { label: "mentions staff will reply", ok: saysStaffWillReply },
  },
  {
    id: "pb14-fabric-stretch-not-covered",
    description: "PB-14 AC2: question not covered by shop data (fabric stretch) -> calls handoff_to_staff with reason not_covered_by_data.",
    history: shopper("Váy này vải có co giãn nhiều không shop?"),
    productId: V,
    expected: [{ tool: "handoff_to_staff", args: { reason: "not_covered_by_data" }, required: true }],
    handoff: "not_covered_by_data",
    reply: { label: "mentions staff will reply", ok: saysStaffWillReply },
  },
  {
    id: "pb14-washing-not-covered",
    description: "PB-14 AC2: question not covered by shop data (washing instructions) -> calls handoff_to_staff with reason not_covered_by_data.",
    history: shopper("Áo này giặt máy được không shop?"),
    productId: AO,
    expected: [{ tool: "handoff_to_staff", args: { reason: "not_covered_by_data" }, required: true }],
    handoff: "not_covered_by_data",
    reply: { label: "mentions staff will reply", ok: saysStaffWillReply },
  },
  {
    id: "pb14-ununderstood-twice",
    description: "PB-14 AC4: shopper isn't understood for 2 turns in a row -> hands off with reason misunderstood_twice.",
    history: [
      { sender: "shopper", text: "jdkfj sdf" },
      { sender: "ai", text: "Dạ shop chưa hiểu rõ ý bạn, bạn nói rõ hơn giúp mình nhé?" },
      { sender: "shopper", text: "??? kkk" },
    ],
    expected: [{ tool: "handoff_to_staff", args: { reason: "misunderstood_twice" }, required: true }],
    handoff: "misunderstood_twice",
    reply: { label: "mentions staff will reply", ok: saysStaffWillReply },
  },
];
