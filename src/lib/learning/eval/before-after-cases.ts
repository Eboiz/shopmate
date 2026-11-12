// PB-35b before/after eval: 8 questions on 4 gaps of shop A of the two-shop
// fixture (Eboiz/Documents#39). Each topic's staff reply is learned, and the
// rule is appended to shop A's policy like PB-35a's get_policy will do.
import type { HandoffReason } from "@/contract";
import { amountsIn } from "@/lib/engine/refusal-guard";
import { fold } from "@/lib/engine/text";
import { comparableNumbers } from "../checks";
import { learnCases, type LearnCase } from "./learn-cases";

export type BeforeAfterQuestion = { id: string; text: string; mustSay: RegExp /* on the folded reply */ };
export type BeforeAfterTopic = { id: string; staff: LearnCase["input"]; questions: [BeforeAfterQuestion, BeforeAfterQuestion] };

const staffOf = (id: string) => {
  const c = learnCases.find((x) => x.id === id);
  if (!c) throw new Error(`no learn case ${id}`);
  return c.input;
};

export const beforeAfterTopics: BeforeAfterTopic[] = [
  {
    id: "kiem-hang",
    staff: staffOf("L01-kiem-hang"),
    questions: [
      { id: "kiem-hang-1", text: "Shop có cho kiểm hàng trước khi nhận không?", mustSay: /kiem/ },
      { id: "kiem-hang-2", text: "Nhận hàng mình được mở ra xem trước rồi mới trả tiền không shop?", mustSay: /kiem|xem/ },
    ],
  },
  {
    id: "trong-ngay",
    staff: staffOf("L02-giao-trong-ngay"),
    questions: [
      { id: "trong-ngay-1", text: "Nội thành có giao trong ngày không shop?", mustSay: /trong ngay|11/ },
      { id: "trong-ngay-2", text: "Mình ở quận 3, đặt sáng nay chiều nhận được không?", mustSay: /trong ngay|11/ },
    ],
  },
  {
    id: "hang-sale",
    staff: staffOf("L03-hang-sale"),
    questions: [
      { id: "hang-sale-1", text: "Hàng sale có đổi được không?", mustSay: /khong/ },
      { id: "hang-sale-2", text: "Váy mua lúc giảm giá về không vừa thì đổi được không shop?", mustSay: /khong/ },
    ],
  },
  {
    id: "cod",
    staff: staffOf("L04-cod-ten-khach"),
    questions: [
      { id: "cod-1", text: "Shop có ship COD không?", mustSay: /cod|khi nhan/ },
      { id: "cod-2", text: "Mình nhận hàng rồi mới trả tiền được không?", mustSay: /cod|khi nhan/ },
    ],
  },
];

// The policy text after a learned rule is added (PB-35a appends active facts).
export function appendRule(content: string | null, rule: string): string {
  const current = content?.trim();
  return current ? `${current}\n${rule}` : rule;
}

export type EngineRun = { calledGetPolicy: boolean; handoffReason: HandoffReason | null; reply: string };

// An answer after learning passes when it comes from get_policy, without a
// handoff, says the fact, and names no amount the policies don't hold.
export function judgeAfter(q: BeforeAfterQuestion, run: EngineRun, policyTexts: string[]) {
  const known = comparableNumbers(policyTexts.join("\n"));
  const unsupportedAmounts = amountsIn(run.reply)
    .map((a) => a.replace(/%$/, ""))
    .filter((n) => !known.has(n));
  const saysFact = q.mustSay.test(fold(run.reply));
  return {
    passed: run.calledGetPolicy && run.handoffReason === null && saysFact && unsupportedAmounts.length === 0,
    saysFact,
    unsupportedAmounts,
  };
}
