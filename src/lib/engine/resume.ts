// PB-14 AC2 (decision D2, 10/11/2026): a conversation waiting for staff goes back
// to the AI only when this turn answered from the shop's data. A greeting, a
// thanks, an unclear message or a complaint keeps it in the staff queue. Pure.
import type { ToolCallLog } from "@/contract";

const outputOf = (log: ToolCallLog) => (log.output ?? null) as Record<string, unknown> | null;

function fromData(log: ToolCallLog): boolean {
  if (log.error !== undefined) return false;
  const out = outputOf(log);
  switch (log.name) {
    case "get_stock":
    case "get_pairings":
    case "quote_order":
      return true;
    case "recommend_size":
      return out?.status === "ok";
    case "get_policy":
      return typeof out?.content === "string";
    case "search_products":
      return Array.isArray(out?.products) && out.products.length > 0;
    default:
      return false;
  }
}

// True when the turn ran a data tool successfully and it returned an answer.
export function answeredFromData(logs: readonly ToolCallLog[]): boolean {
  return logs.some(fromData);
}
