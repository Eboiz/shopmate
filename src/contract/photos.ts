import { z } from "zod";

// PB-30: shopper photos. Shared by the browser, the channels, the engine and
// PB-34's search bar (Eboiz/Documents#35, spec section 3.3), so no server-only.

export const PHOTO_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const photoMediaTypeSchema = z.enum(PHOTO_MEDIA_TYPES);
export type PhotoMediaType = z.infer<typeof photoMediaTypeSchema>;

// Decoded size of one photo.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_MESSAGE = 4;

// A photo ready for Claude and the photo search: standard base64, known type.
export type PhotoInput = { base64: string; mediaType: PhotoMediaType };
