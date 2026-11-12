import "server-only";
import { z } from "zod";
import type { PhotoInput } from "@/contract";

// PB-30: client of POST {EMBEDDER_URL}/search (shopmate-gpu-services on Modal;
// wire contract in the PB-34 spec, section 3.1). The service returns product
// ids of one shop with a score; this module decides which hits are close
// enough to show. The model never decides that.

// A cold Modal container needs a minute or more to load its models. The
// shopper is not kept waiting that long: search_products falls back to text.
export const EMBEDDER_TIMEOUT_MS = 15_000;
export const PHOTO_SIMILAR_MAX = 3;
const TEXT_MAX = 200;

// Scores are only comparable within one scale: the reranker's sigmoid score
// (`reranked: true`) or EmbeddingGemma's cosine (`reranked: false`, reranker off
// or failed). Calibration of 2026-11-12 (shopmate-gpu-services CALIBRATION.md,
// eval shop, reranker on): the shop's own photos 0.80-0.88 but top-1 right only
// 48/60; other photos of the same kind of item 0.78-0.87; other kinds of item
// 0.26-0.53; non-clothing photos 0.13-0.27. A score can't tell "this exact
// product" from "the same kind of product", so no score is ever exact
// (developer decision 2026-11-12): the AI shows up to 3 products and asks.
// 0.65 sits in the gap between the same kind and other kinds. Cosine scores
// overlapped too (2026-11-10: 0.672 vs 0.687); their floor is a guess.
export const PHOTO_SIMILAR_MIN = { reranked: 0.65, cosine: 0.55 } as const;

export type PhotoHit = { productId: string; score: number };
// Always "similar": a photo never proves the exact product (see above).
export type PhotoMatch = PhotoHit & { match: "similar" };
export type PhotoSearchResult = { hits: PhotoHit[]; reranked: boolean };

// Not configured, timeout, non-2xx or a body that is not the contract.
export class PhotoSearchUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoSearchUnavailable";
  }
}

// Extra keys are allowed: a new response field must not turn into "unavailable".
const responseSchema = z.object({
  hits: z.array(z.object({ productId: z.string(), score: z.number() })),
  reranked: z.boolean().optional(),
});

type Env = { EMBEDDER_URL?: string; EMBEDDER_TOKEN?: string };

export async function searchByPhoto(
  args: { shopId: string; photo: PhotoInput; text: string | null; limit: number },
  deps: { fetch?: typeof fetch; env?: Env } = {},
): Promise<PhotoSearchResult> {
  const env = deps.env ?? process.env;
  const base = (env.EMBEDDER_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.EMBEDDER_TOKEN ?? "").trim();
  if (!base || !token) throw new PhotoSearchUnavailable("photo search is not configured");

  const text = args.text?.trim().slice(0, TEXT_MAX) ?? "";
  const body = {
    shopId: args.shopId,
    imageBase64: args.photo.base64,
    mediaType: args.photo.mediaType,
    ...(text ? { text } : {}),
    limit: args.limit,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBEDDER_TIMEOUT_MS);
  let payload: unknown;
  try {
    let response: Response;
    try {
      response = await (deps.fetch ?? fetch)(`${base}/search`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new PhotoSearchUnavailable(`photo search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!response.ok) throw new PhotoSearchUnavailable(`photo search answered ${response.status}`);
    try {
      payload = await response.json();
    } catch {
      throw new PhotoSearchUnavailable("photo search returned invalid JSON");
    }
  } finally {
    clearTimeout(timer);
  }
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new PhotoSearchUnavailable("photo search returned an invalid response");
  return { hits: parsed.data.hits, reranked: parsed.data.reranked ?? false };
}

// Up to PHOTO_SIMILAR_MAX hits at or above the scale's floor, in the
// service's order (best first).
export function classifyHits(result: PhotoSearchResult): PhotoMatch[] {
  const min = result.reranked ? PHOTO_SIMILAR_MIN.reranked : PHOTO_SIMILAR_MIN.cosine;
  return result.hits
    .filter((h) => h.score >= min)
    .slice(0, PHOTO_SIMILAR_MAX)
    .map((h) => ({ ...h, match: "similar" }));
}
