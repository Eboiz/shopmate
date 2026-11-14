import "server-only";
import { foldVietnamese } from "@/lib/shop/catalog-view";
import type { SemanticSearch } from "./semantic-search";

// In-process stand-in for the PB-30 embedder (spec section 3.4). Scores stay in
// [0, 1] so the rank floors apply to the mock exactly as to the real service.

export type SearchDoc = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  colors: string[];
};

// The mock photo search only orders products: no vector, no image comparison.
const PHOTO_TOP_SCORE = 0.9;
const PHOTO_SCORE_STEP = 0.05;

// Share of the query words present anywhere in the doc, like `matchesQuery`.
function textScore(doc: SearchDoc, words: string[]): number {
  const haystack = foldVietnamese(
    [doc.name, doc.category, doc.description, ...doc.colors].filter(Boolean).join(" "),
  );
  const found = words.filter((word) => haystack.includes(word)).length;
  return found / words.length;
}

export function mockSemanticSearch(loadDocs: (shopId: string) => Promise<SearchDoc[]>): SemanticSearch {
  return async (query) => {
    const docs = await loadDocs(query.shopId);
    const words = query.text ? foldVietnamese(query.text).split(" ").filter(Boolean) : [];

    // Text wins over the photo: a photo with text is scored by its text only.
    // The mock stands in for the reranked service, so the reranker floors apply.
    if (words.length > 0) {
      const hits = docs
        .map((doc) => ({ productId: doc.id, score: textScore(doc, words) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit);
      return { hits, reranked: true };
    }
    if (query.photo) {
      const hits = docs.slice(0, query.limit).map((doc, index) => ({
        productId: doc.id,
        score: Number((PHOTO_TOP_SCORE - index * PHOTO_SCORE_STEP).toFixed(2)),
      }));
      return { hits, reranked: true };
    }
    return { hits: [], reranked: true };
  };
}
