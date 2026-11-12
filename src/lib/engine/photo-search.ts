import "server-only";
import { z } from "zod";
import type { PhotoInput } from "@/contract";

// PB-30: client of POST {EMBEDDER_URL}/search (shopmate-gpu-services on Modal;
// wire contract in the PB-34 spec, section 3.1). The service returns product
// ids of one shop with a score; this module decides which hits count as the
// exact product and which are only similar. The model never decides that.

// A cold Modal container needs a minute or more to load its models. The
// shopper is not kept waiting that long: search_products falls back to text.
export const EMBEDDER_TIMEOUT_MS = 15_000;
export const PHOTO_SIMILAR_MAX = 3;
const TEXT_MAX = 200;

// Scores are only comparable within one scale: the reranker's sigmoid score
// (`reranked: true`) or EmbeddingGemma's cosine (`reranked: false`, reranker off
// or failed). Reranker numbers: calibration of 2026-11-12 (shopmate-gpu-services
// CALIBRATION.md). Cosine scores of the right product and of other products
// overlapped (2026-11-10: positive min 0.672 <= negative max 0.687), so a cosine
// score never makes a hit exact.
export const PHOTO_THRESHOLDS = {
  reranked: { exact: 0.8, similar: 0.3 },
  cosine: { exact: null, similar: 0.55 },
} as const satisfies Record<"reranked" | "cosine", { exact: number | null; similar: number }>;

export type PhotoHit = { productId: string; score: number };
export type PhotoMatch = PhotoHit & { match: "exact" | "similar" };
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

// Every hit at or above the exact threshold is exact (the same item can be in
// the catalog twice). With none, up to PHOTO_SIMILAR_MAX hits above the similar
// floor are similar. Hits keep the service's order (best first).
export function classifyHits(result: PhotoSearchResult): PhotoMatch[] {
  const t = result.reranked ? PHOTO_THRESHOLDS.reranked : PHOTO_THRESHOLDS.cosine;
  const exactMin = t.exact;
  if (exactMin !== null) {
    const exact = result.hits.filter((h) => h.score >= exactMin);
    if (exact.length > 0) return exact.map((h) => ({ ...h, match: "exact" }));
  }
  return result.hits
    .filter((h) => h.score >= t.similar)
    .slice(0, PHOTO_SIMILAR_MAX)
    .map((h) => ({ ...h, match: "similar" }));
}
