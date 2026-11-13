import { NextResponse, type NextRequest } from "next/server";
import { chatErrors, shopSlugSchema } from "@/lib/chat/request";
import { findShop } from "@/lib/chat/web-chat";
import { searchClientHash, takeSearchSlot } from "@/lib/guard/search-limit";
import { clientIp } from "@/lib/guard/web-chat-limit";
import { EMBEDDER_MAX_LIMIT, EMBEDDER_TEXT_MAX } from "@/lib/search/embedder-contract";
import { MAX_PHOTO_BYTES, PHOTO_ERRORS, checkPhoto, type PhotoInput } from "@/lib/search/pb30-shim";
import { pickResults, scoreFloor } from "@/lib/search/rank";
import { SEARCH_MIN_TEXT, searchErrors, type SearchResponse } from "@/lib/search/request";
import { SemanticSearchUnavailable, semanticSearchFromEnv } from "@/lib/search/semantic-search";
import { loadSearchDocs } from "@/lib/search/shop-docs";

// PB-34: search the shop by description and/or photo. multipart/form-data with
// `q` (text, may be empty next to a photo) and an optional `photo` file. The
// photo is sent to the search service and dropped, never stored (A1). The shop
// id comes only from the slug (R2); the browser never sees the embedder (R3).

type Ctx = RouteContext<"/api/shops/[slug]/search">;

const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });
const answer = (payload: SearchResponse) => NextResponse.json(payload, { headers: noStore });

export async function POST(request: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }

  try {
    const shop = shopSlugSchema.safeParse(slug).success ? await findShop(slug) : null;
    if (!shop) return fail(chatErrors.shopNotFound, 404);

    const rawText = form.get("q");
    const text = typeof rawText === "string" ? rawText.trim() : "";
    const rawPhoto = form.get("photo");
    const photoFile = rawPhoto instanceof Blob ? rawPhoto : null;

    if (!text && !photoFile) return fail(searchErrors.empty, 400);
    if (!photoFile && text.length < SEARCH_MIN_TEXT) return fail(searchErrors.tooShort, 400);
    if (text.length > EMBEDDER_TEXT_MAX) return fail(searchErrors.tooLong, 400);

    let photo: PhotoInput | null = null;
    if (photoFile) {
      // Size from the multipart header first: a huge upload is refused unread.
      if (photoFile.size > MAX_PHOTO_BYTES) return fail(PHOTO_ERRORS.size, 400);
      const bytes = new Uint8Array(await photoFile.arrayBuffer());
      const checked = checkPhoto(bytes);
      if (!checked.ok) return fail(PHOTO_ERRORS[checked.error], 400);
      photo = { base64: Buffer.from(bytes).toString("base64"), mediaType: checked.mediaType };
    }

    const search = semanticSearchFromEnv(process.env, loadSearchDocs);
    if (!search) {
      console.warn("shop search: no search service configured");
      return answer({ mode: "unavailable" });
    }

    const limit = await takeSearchSlot({ shopId: shop.id, clientHash: searchClientHash(clientIp(request.headers)) });
    if (limit !== "ok") return fail(searchErrors.rateLimited, 429);

    const [docs, result] = await Promise.all([
      loadSearchDocs(shop.id),
      search({ shopId: shop.id, text: text || null, photo, limit: EMBEDDER_MAX_LIMIT }).catch((error: unknown) => {
        if (error instanceof SemanticSearchUnavailable) return error;
        throw error;
      }),
    ]);
    if (result instanceof SemanticSearchUnavailable) {
      console.warn("shop search: search service unavailable", result.message);
      return answer({ mode: "unavailable" });
    }
    const floor = scoreFloor(photo ? "photo" : "description", result.reranked);
    if (floor === null) {
      // Cosine scores (reranker off or failed) have no calibrated text floor.
      console.warn("shop search: description search got cosine scores, falling back to the instant filter");
      return answer({ mode: "unavailable" });
    }

    const productIds = pickResults(result.hits, new Set(docs.map((doc) => doc.id)), floor);
    return answer({ mode: "semantic", productIds });
  } catch (error) {
    console.error("shop search failed", error);
    return fail(searchErrors.failed, 500);
  }
}
