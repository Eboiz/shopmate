import "server-only";
import { EMBEDDER_MAX_LIMIT } from "./embedder-contract";
import type { SemanticHit } from "./semantic-search";

// Turns embedder hits into the ordered product ids the page may show: only
// products of this shop, above the score floor of the query kind, no repeats
// (spec section 3.5, AC3).

// Placeholder for the mock (spec §3.5); Task 8 Step 5 sets the calibrated values.
export const DESCRIPTION_MIN_SCORE = 0.5;
export const PHOTO_MIN_SCORE = 0.5;

export function pickResults(
  hits: SemanticHit[],
  shopProductIds: ReadonlySet<string>,
  kind: "description" | "photo",
): string[] {
  const floor = kind === "photo" ? PHOTO_MIN_SCORE : DESCRIPTION_MIN_SCORE;
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
