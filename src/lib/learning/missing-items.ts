// PB-36 (Eboiz/Documents#37): group product_not_found requests into missing
// items the shop doesn't sell, paired with up to 3 closest catalog products.
import { z } from "zod";
import type { ClosestProduct, GapQuestion, MissingItemProposal } from "@/contract";
import { toStructuredOutputSchema } from "@/lib/engine/model-reply";
import type { Match } from "@/lib/engine/product-match";
import { createParsed, modelNameFrom, type LearningDeps } from "./learn";
import { buildMissingItemsSystemPrompt, buildMissingItemsUserMessage } from "./prompt";

const itemGroupSchema = z.object({
  item: z.string(),
  searchQuery: z.string(),
  refs: z.array(z.string()),
});

const missingItemsModelSchema = z.object({
  items: z.array(itemGroupSchema),
});

const MISSING_ITEMS_JSON_SCHEMA = toStructuredOutputSchema(missingItemsModelSchema);
const MIN_CONVERSATIONS = 2;
const MAX_SAMPLES = 3;
const MAX_CLOSEST = 3;
const MAX_ITEM = 80;

export type CatalogMatchResult = {
  match: Match;
  products: ClosestProduct[];
};

export type MissingItemsDeps = LearningDeps & {
  /** Looks up the shop's catalog using search_products semantics. */
  searchCatalog: (query: string) => Promise<CatalogMatchResult>;
};

const cleanItem = (raw: string): string =>
  raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ITEM);

/**
 * Groups open `product_not_found` requests from the last 7 days by item
 * (at least 2 distinct conversations), filtering out items the shop already sells
 * and attaching up to 3 closest catalog products from `searchCatalog`.
 */
export async function analyzeMissingItems(
  requests: GapQuestion[],
  deps: MissingItemsDeps,
): Promise<MissingItemProposal[]> {
  if (requests.length === 0) return [];

  const byRef = new Map(requests.map((q, i) => [`q${i + 1}`, q]));
  const items = [...byRef].map(([ref, q]) => ({ ref, question: q.question }));
  const parsed = await createParsed(
    deps,
    {
      model: modelNameFrom(deps),
      max_tokens: 1500,
      system: buildMissingItemsSystemPrompt(),
      messages: [{ role: "user", content: buildMissingItemsUserMessage(items) }],
      output_config: { format: { type: "json_schema", schema: MISSING_ITEMS_JSON_SCHEMA } },
    },
    missingItemsModelSchema,
  );
  if (!parsed) throw new Error("missing_items_unreadable");

  const used = new Set<string>();
  const out: MissingItemProposal[] = [];

  for (const group of parsed.items) {
    const matched = group.refs
      .filter((r) => !used.has(r))
      .map((r) => [r, byRef.get(r)] as const)
      .filter((pair): pair is [string, GapQuestion] => Boolean(pair[1]));
    const conversations = new Set(matched.map(([, q]) => q.conversationId));
    const item = cleanItem(group.item);
    if (conversations.size < MIN_CONVERSATIONS || !item) continue;

    const query = group.searchQuery.trim() || item;
    const catalog = await deps.searchCatalog(query);
    if (catalog.match === "exact" && catalog.products.length > 0) continue;

    matched.forEach(([r]) => used.add(r));
    out.push({
      item,
      questionIds: matched.map(([, q]) => q.id),
      conversationCount: conversations.size,
      sampleQuestions: [...new Set(matched.map(([, q]) => q.question))].slice(0, MAX_SAMPLES),
      closestProducts: catalog.products.slice(0, MAX_CLOSEST),
    });
  }

  return out;
}

