// Stand-in for PB-30 (spec §3.3). Task 8 replaces every body with re-exports; do not add names here.

// Media types a search photo may use, exactly as PB-30 defines them.
export const PHOTO_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];

// 5 MB, the same decoded ceiling PB-30 applies to photos (spec section 3.1).
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// A photo ready for the embedder: standard base64 and a known media type.
export type PhotoInput = { base64: string; mediaType: PhotoMediaType };

// Vietnamese messages PB-30 shows for photo problems (spec section 3.3).
export const PHOTO_ERRORS = {
  type: "Chỉ gửi được ảnh JPEG, PNG hoặc WebP.",
  size: "Ảnh tối đa 5 MB.",
  read: "Không đọc được ảnh. Vui lòng chọn ảnh khác.",
} as const;

// Shrinking keeps big phone photos under the Vercel body limit and the embedder's
// long edge; smaller photos are uploaded as-is.
const PHOTO_RESIZE_ABOVE_BYTES = 1.5 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1568;

const EXT_BY_MEDIA_TYPE: Record<PhotoMediaType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Magic bytes of the accepted formats; anything else (GIF, HEIC, ...) is "type".
function detectMediaType(bytes: Uint8Array): PhotoMediaType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // "RIFF"
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 && // "WEBP"
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

// Checks the raw bytes of a photo: size first, then the magic bytes (PB-30's rule).
export function checkPhoto(
  bytes: Uint8Array,
): { ok: true; mediaType: PhotoMediaType; ext: "jpg" | "png" | "webp" } | { ok: false; error: keyof typeof PHOTO_ERRORS } {
  if (bytes.length === 0) return { ok: false, error: "read" };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: "size" };
  const mediaType = detectMediaType(bytes);
  if (!mediaType) return { ok: false, error: "type" };
  return { ok: true, mediaType, ext: EXT_BY_MEDIA_TYPE[mediaType] };
}

// Decides what to do with a decoded photo: accept as-is, resize, or reject.
export function photoDecision(
  file: { type: string; size: number },
  dims: { width: number; height: number },
): { ok: false; error: keyof typeof PHOTO_ERRORS } | { ok: true; resize: boolean } {
  if (!PHOTO_MEDIA_TYPES.includes(file.type as PhotoMediaType)) return { ok: false, error: "type" };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "size" };
  const longEdge = Math.max(dims.width, dims.height);
  return { ok: true, resize: file.size > PHOTO_RESIZE_ABOVE_BYTES || longEdge > PHOTO_MAX_EDGE };
}

// Browser-only: decodes the file and shrinks it when needed, so the upload stays
// under the Vercel body limit and the embedder's 1568 px long edge.
export async function preparePhoto(file: File): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  // Cheap checks first: a HEIC photo can't be decoded by most browsers and would
  // otherwise show the "read" message instead of the "type" one.
  if (!PHOTO_MEDIA_TYPES.includes(file.type as PhotoMediaType)) return { ok: false, error: PHOTO_ERRORS.type };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: PHOTO_ERRORS.size };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: PHOTO_ERRORS.read };
  }
  try {
    const decision = photoDecision(
      { type: file.type, size: file.size },
      { width: bitmap.width, height: bitmap.height },
    );
    if (!decision.ok) return { ok: false, error: PHOTO_ERRORS[decision.error] };
    if (!decision.resize) return { ok: true, blob: file };
    // Scale so the long edge is at most 1568, keeping the aspect ratio (never upscale).
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, error: PHOTO_ERRORS.read };
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return { ok: false, error: PHOTO_ERRORS.read };
    return { ok: true, blob };
  } finally {
    bitmap.close();
  }
}
