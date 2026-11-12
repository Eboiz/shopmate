import type { EngineMode, HandoffReason, ToolCallLog } from "@/contract";
import type { OfferAnswer, OfferReason } from "./handoff-offer";

// PB-35a: which customer turns record a question the AI couldn't answer
// (data_gaps), so staff's answer can be learned and the owner sees the gaps.
//
// Recorded on the turn that OFFERS staff (PB-31), where the shopper's own
// question is: the "Có"/"Không cần" turn after it adds nothing ("Không cần" only
// marks the gap soft_declined). Only gaps the AI could learn are recorded: a
// policy question (get_policy) or a product detail (search_products / the product
// on screen). Size is never learned (the size chart decides), off-topic
// questions read no data, and complaints, requests for a person and technical
// failures are not gaps.

export type GapTurn = {
  mode: EngineMode;
  question: string;
  handoff: HandoffReason | null;
  offerMade: OfferReason | null;
  offerAnswer: OfferAnswer;
  productMissedTwice: boolean;
  logs: ToolCallLog[];
  productId: string | null;
  // The Jev router's intent (router path only): "product_detail" makes the product on
  // screen the subject; "off_topic" reads no data and is never a gap.
  intent: string | null;
};

export type Gap = { reason: "policy_not_covered" | "not_covered_by_data" | "product_not_found"; question: string; productId: string | null };

const QUESTION_MAX = 500;

export function gapOfTurn(turn: GapTurn): Gap | null {
  const question = turn.question.trim().slice(0, QUESTION_MAX);
  if (turn.mode !== "customer" || turn.offerAnswer !== null || !question) return null;

  if (turn.productMissedTwice || turn.handoff === "product_not_found") {
    return { reason: "product_not_found", question, productId: null };
  }
  if (turn.handoff !== null || turn.offerMade === null || turn.offerMade === "size_out_of_range") return null;

  const ok = (name: ToolCallLog["name"]) => turn.logs.some((log) => log.name === name && !log.error);
  if (ok("recommend_size")) return null;
  const readPolicy = ok("get_policy");
  const found = searchedProducts(turn.logs);
  const aboutProductOnScreen = turn.intent === "product_detail" && turn.productId !== null;
  if (turn.offerMade === "not_covered_by_data" && !readPolicy && found.length === 0 && !aboutProductOnScreen) return null;

  const productId = readPolicy ? null : aboutProductOnScreen ? turn.productId : found.length === 1 ? found[0] : (turn.productId ?? null);
  return { reason: turn.offerMade, question, productId };
}

// Product ids the turn's last successful search returned.
function searchedProducts(logs: ToolCallLog[]): string[] {
  const search = logs.findLast((log) => log.name === "search_products" && !log.error);
  const products = (search?.output as { products?: { productId?: unknown }[] } | undefined)?.products ?? [];
  return products.map((p) => p.productId).filter((id): id is string => typeof id === "string");
}
