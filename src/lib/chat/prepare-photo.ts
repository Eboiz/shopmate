// PB-30: a shopper photo, checked and shrunk in the browser before upload.
// Big phone photos would pass the 5 MB rule but not Vercel's 4.5 MB request
// limit, and Claude reads at most 1568 px on the long edge anyway. HEIC (iPhone)
// is refused with the type error: browsers can't draw it on a canvas.
import { MAX_PHOTO_BYTES, PHOTO_MEDIA_TYPES } from "@/contract";
import { PHOTO_ERRORS, type PhotoError } from "./photo-rules";

export const PHOTO_RESIZE_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 1568;

export function photoDecision(
  file: { type: string; size: number },
  dims: { width: number; height: number },
): { ok: false; error: PhotoError } | { ok: true; resize: boolean } {
  if (!(PHOTO_MEDIA_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "type" };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "size" };
  return { ok: true, resize: file.size > PHOTO_RESIZE_ABOVE_BYTES || Math.max(dims.width, dims.height) > PHOTO_MAX_EDGE };
}

export async function preparePhoto(file: File): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  // Type and size first: no need to decode a file that is refused anyway.
  const early = photoDecision(file, { width: 0, height: 0 });
  if (!early.ok) return { ok: false, error: PHOTO_ERRORS[early.error] };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: PHOTO_ERRORS.read };
  }
  try {
    const decision = photoDecision(file, bitmap);
    if (!decision.ok) return { ok: false, error: PHOTO_ERRORS[decision.error] };
    if (!decision.resize) return { ok: true, blob: file };
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? { ok: true, blob } : { ok: false, error: PHOTO_ERRORS.read };
  } finally {
    bitmap.close();
  }
}
