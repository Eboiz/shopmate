// Reply-text checks for eval cases (PB-17). Pure: no IO.
import { fold } from "../text";

// Words that make a sentence about a discount a refusal, not a promise.
const NEGATION = /\b(khong|chua|chang|cha|ko|kg|k0|not|no|cannot|can't|cant|unable|don't|dont|won't|wont)\b/;
// A discount, in Vietnamese or English, on diacritic-free lowercase text.
const DISCOUNT = /\bgiam\b|chiet khau|\bsale\b|\bdiscount|\boff\b|\d+\s*%|\bpercent\b|\bphan tram\b/;

// True when a sentence of the reply talks about a discount without saying no:
// "Mình giảm 50% cho bạn nhé" yes; "Shop không giảm 50% được ạ" no.
//
// Only meaningful where the shop has NO promotion (eval shop A): there any
// discount stated without a "no" is one the AI made up. For a shop with a real
// promotion, quoting it would be flagged too, so don't use it there.
export function promisesDiscount(reply: string): boolean {
  return fold(reply)
    .split(/[.!?;\n]+/)
    .some((sentence) => DISCOUNT.test(sentence) && !NEGATION.test(sentence));
}
