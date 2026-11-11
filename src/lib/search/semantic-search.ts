import "server-only";
import { embedderSearchRequestSchema, embedderSearchResponseSchema } from "./embedder-contract";
import { mockSemanticSearch, type SearchDoc } from "./mock-search";
import type { PhotoInput } from "./pb30-shim";

// Port between the shop search bar and the PB-30 embedder (spec section 3.1).
// The route only sees this interface, so the mock can stand in until PB-30 is
// merged and the HTTP adapter takes over (Task 8).

export const SEARCH_TIMEOUT_MS = 8_000;

export type SemanticQuery = {
  shopId: string;
  text: string | null;
  photo: PhotoInput | null;
  limit: number;
};

export type SemanticHit = { productId: string; score: number };

export type SemanticSearch = (query: SemanticQuery) => Promise<SemanticHit[]>;

export type { SearchDoc };

// Every reason the service cannot answer: off, slow, error, malformed answer.
// The route turns this into "unavailable" instead of failing the page (AC4).
export class SemanticSearchUnavailable extends Error {
  constructor(message = "semantic search unavailable") {
    super(message);
    this.name = "SemanticSearchUnavailable";
  }
}

export function httpSemanticSearch(
  env: { EMBEDDER_URL: string; EMBEDDER_TOKEN: string },
  fetchImpl: typeof fetch = fetch,
): SemanticSearch {
  const baseUrl = env.EMBEDDER_URL.replace(/\/+$/, "");

  return async (query) => {
    if (!baseUrl || !env.EMBEDDER_TOKEN) throw new SemanticSearchUnavailable("embedder is not configured");

    // Null fields are omitted: a text-only query sends no image keys.
    const request = embedderSearchRequestSchema.safeParse({
      shopId: query.shopId,
      limit: query.limit,
      ...(query.text != null ? { text: query.text } : {}),
      ...(query.photo != null ? { imageBase64: query.photo.base64, mediaType: query.photo.mediaType } : {}),
    });
    if (!request.success) throw new SemanticSearchUnavailable("invalid search request");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${baseUrl}/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.EMBEDDER_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
        signal: controller.signal,
      });
      if (!response.ok) throw new SemanticSearchUnavailable(`embedder answered ${response.status}`);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new SemanticSearchUnavailable("embedder returned invalid JSON");
      }
      const parsed = embedderSearchResponseSchema.safeParse(payload);
      if (!parsed.success) throw new SemanticSearchUnavailable("embedder returned an invalid response");
      return parsed.data.hits;
    } catch (error) {
      if (error instanceof SemanticSearchUnavailable) throw error;
      throw new SemanticSearchUnavailable(error instanceof Error ? error.message : "semantic search failed");
    } finally {
      clearTimeout(timer);
    }
  };
}

export function semanticSearchFromEnv(
  env: NodeJS.ProcessEnv,
  loadDocs: (shopId: string) => Promise<SearchDoc[]>,
): SemanticSearch | null {
  // The mock must never reach production, even if the flag is copied there.
  if (env.SEARCH_EMBEDDER_MOCK === "1" && env.NODE_ENV !== "production") {
    return mockSemanticSearch(loadDocs);
  }
  if (env.EMBEDDER_URL && env.EMBEDDER_TOKEN) {
    return httpSemanticSearch({ EMBEDDER_URL: env.EMBEDDER_URL, EMBEDDER_TOKEN: env.EMBEDDER_TOKEN });
  }
  return null;
}
