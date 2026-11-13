import { z } from "zod";
import { EMBEDDER_MAX_LIMIT } from "./embedder-contract";
import { MAX_PHOTO_BYTES } from "./pb30-shim";

// Wire shapes of POST /api/shops/[slug]/search, shared by the route and the
// shop page (no server-only import: the browser parses responses with it).

export const SEARCH_MIN_TEXT = 2;

// Whole multipart body: the largest photo plus room for the text and the
// multipart framing. The route stops reading past it.
export const MAX_SEARCH_BODY_BYTES = MAX_PHOTO_BYTES + 64 * 1024;

// Exact copy from the PB-34 spec (Global Constraints of the plan).
export const searchErrors = {
  empty: "Vui lòng nhập mô tả hoặc chọn ảnh.",
  tooShort: "Vui lòng nhập ít nhất 2 ký tự.",
  tooLong: "Mô tả tối đa 200 ký tự.",
  rateLimited: "Bạn tìm hơi nhanh rồi. Vui lòng thử lại sau một phút.",
  photoUnavailable: "Tìm bằng ảnh đang tạm ngưng. Bạn thử mô tả bằng chữ nhé.",
  failed: "Không tìm được lúc này. Vui lòng thử lại.",
} as const;

// "semantic": the ranked products of this shop (may be empty: nothing above the
// floor). "unavailable": the search service is off, down or slow (AC4).
export const searchResponseSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("semantic"), productIds: z.array(z.uuid()).max(EMBEDDER_MAX_LIMIT) }),
  z.object({ mode: z.literal("unavailable") }),
]);

export type SearchResponse = z.infer<typeof searchResponseSchema>;
