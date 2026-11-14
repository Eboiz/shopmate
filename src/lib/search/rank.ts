import "server-only";
import { EMBEDDER_MAX_LIMIT } from "./embedder-contract";
import type { SemanticHit } from "./semantic-search";

// Turns embedder hits into the ordered product ids the page may show: only
// products of this shop, at or above the score floor, no repeats (spec
// section 3.5, AC3).

// Floors per score kind (the service's `reranked` flag) and query kind.
// - reranked.description: calibrated 2026-11-13 on hanh-boutique-eval through the
//   deployed service (v4, 20 candidates): 10 shopper descriptions of catalog
//   products scored 0.577-0.766 for their product (top-1 8/10, top-2 10/10);
//   5 off-catalog queries topped at 0.453 and 3 fashion items the shop doesn't
//   sell at 0.423. Floor = max off-catalog + 0.02 (plan Task 8 Step 5).
// - reranked.photo: PB-30's PHOTO_SIMILAR_MIN.reranked ("similar", never exact).
// - cosine.photo: PB-30's cosine floor (a guess, not re-measured).
// - cosine.description: never calibrated, so null: the route answers
//   "unavailable" and the page keeps its instant filter (AC4).
export const SCORE_FLOORS = {
  reranked: { description: 0.47, photo: 0.3 },
  cosine: { description: null, photo: 0.55 },
} as const;

export type QueryKind = "description" | "photo";

export function scoreFloor(kind: QueryKind, reranked: boolean): number | null {
  return SCORE_FLOORS[reranked ? "reranked" : "cosine"][kind];
}

export function pickResults(hits: SemanticHit[], shopProductIds: ReadonlySet<string>, floor: number): string[] {
  const picked: string[] = [];

  for (const hit of hits) {
    if (picked.length >= EMBEDDER_MAX_LIMIT) break;
    if (hit.score < floor) continue;
    if (!shopProductIds.has(hit.productId)) continue;
    if (picked.includes(hit.productId)) continue;
    picked.push(hit.productId);
  }

  return picked;
}
