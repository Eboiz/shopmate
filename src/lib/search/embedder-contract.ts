import { z } from "zod";
import { PHOTO_MEDIA_TYPES } from "./pb30-shim";

// Wire contract with the PB-30 embedder: spec section 3.1. Shared by the browser
// and tests, so this file must not import "server-only".

export const EMBEDDER_MAX_LIMIT = 10;
export const EMBEDDER_TEXT_MAX = 200;

// 5 MB decoded, the same ceiling PB-30 applies to photos (spec section 3.1).
const IMAGE_BYTES_MAX = 5 * 1024 * 1024;

// Standard base64: no data URL, no whitespace, padding only at the end.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export const embedderSearchRequestSchema = z
  .strictObject({
    shopId: z.uuid(),
    imageBase64: z
      .string()
      .min(1)
      .regex(BASE64_PATTERN, "imageBase64 must be standard base64")
      .refine((value) => (value.length * 3) / 4 <= IMAGE_BYTES_MAX, "image decodes to over 5 MB")
      .nullish(),
    mediaType: z.enum(PHOTO_MEDIA_TYPES).nullish(),
    text: z
      .string()
      .refine(
        (value) => {
          const length = value.trim().length;
          return length >= 1 && length <= EMBEDDER_TEXT_MAX;
        },
        `text must be 1 to ${EMBEDDER_TEXT_MAX} characters after trim`,
      )
      .nullish(),
    limit: z.int().min(1).max(EMBEDDER_MAX_LIMIT).default(5),
  })
  // At least one of imageBase64 and text must be set, else the embedder answers 422.
  .refine((body) => body.imageBase64 != null || body.text != null, "at least one of imageBase64 and text is required")
  // mediaType is required iff imageBase64 is set: neither alone is valid.
  .refine((body) => (body.imageBase64 != null) === (body.mediaType != null), "mediaType is required iff imageBase64 is set");

export type EmbedderSearchRequest = z.output<typeof embedderSearchRequestSchema>;

// Not strict: an extra response key from the embedder must not turn into "unavailable".
export const embedderSearchResponseSchema = z.object({
  hits: z.array(z.object({ productId: z.string(), score: z.number() })),
  model: z.string(),
  dim: z.int(),
  // true: scores are the reranker's (0..1); false or missing (older service,
  // reranker off or failed): cosine scores, which need their own floors.
  reranked: z.boolean().optional(),
});

export type EmbedderSearchResponse = z.output<typeof embedderSearchResponseSchema>;
