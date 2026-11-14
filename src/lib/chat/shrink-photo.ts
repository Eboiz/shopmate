import "server-only";
import sharp from "sharp";
import type { PhotoMediaType } from "@/contract";

// A shopper photo goes to Claude in every model call of the turn (2-3 calls)
// and to the photo search. The gateway's time grows with the bytes: measured
// 2026-11-14 on the same 1200 px photo, PNG 1.4 MB 16-25 s per call, JPEG
// 277 KB 5-7 s, JPEG 1024 px 159 KB 2.9-3.5 s. The browser only shrinks photos
// above 1.5 MB or 1568 px, and other channels don't shrink at all, so the server
// shrinks before sending. The stored original is kept for staff.
export const PHOTO_SHRINK_ABOVE_BYTES = 200 * 1024;
export const PHOTO_SHRINK_EDGE = 1024;
const JPEG_QUALITY = 80;
// Refused before decoding: a tiny PNG can claim a huge raster (16000 px a side
// is ~1 GB decoded). 60 M pixels covers a 50 MP phone photo (8160 x 6144).
export const PHOTO_DECODE_MAX_PIXELS = 60_000_000;

export type ShrunkPhoto = { bytes: Uint8Array; mediaType: PhotoMediaType };

// A small photo is returned as it is. A bigger one becomes a JPEG of at most
// PHOTO_SHRINK_EDGE px on the long edge (EXIF rotation applied, transparency on
// white). If it can't be decoded, the original is sent: slow beats no photo.
export async function shrinkPhoto(
  bytes: Uint8Array,
  mediaType: PhotoMediaType,
  opts: { maxPixels?: number } = {},
): Promise<ShrunkPhoto> {
  if (bytes.length <= PHOTO_SHRINK_ABOVE_BYTES) return { bytes, mediaType };
  try {
    const out = await sharp(bytes, { limitInputPixels: opts.maxPixels ?? PHOTO_DECODE_MAX_PIXELS })
      .rotate()
      .resize({ width: PHOTO_SHRINK_EDGE, height: PHOTO_SHRINK_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    if (out.length >= bytes.length) return { bytes, mediaType };
    return { bytes: new Uint8Array(out), mediaType: "image/jpeg" };
  } catch (e) {
    console.warn("chat photo: could not shrink, sending the original", e instanceof Error ? e.message : String(e));
    return { bytes, mediaType };
  }
}
