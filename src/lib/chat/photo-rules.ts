// PB-30: which shopper photos are accepted. Used by the server (every channel)
// and the browser, so no server-only. Decided by the file's bytes, never by the
// type the sender declared.
import { MAX_PHOTO_BYTES, type PhotoMediaType } from "@/contract";

export const PHOTO_ERRORS = {
  type: "Chỉ gửi được ảnh JPEG, PNG hoặc WebP.",
  size: "Ảnh tối đa 5 MB.",
  read: "Không đọc được ảnh. Vui lòng chọn ảnh khác.",
} as const;

export type PhotoError = keyof typeof PHOTO_ERRORS;
export type PhotoExt = "jpg" | "png" | "webp";
export type PhotoCheck = { ok: true; mediaType: PhotoMediaType; ext: PhotoExt } | { ok: false; error: PhotoError };

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function checkPhoto(bytes: Uint8Array): PhotoCheck {
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: "size" };
  if (bytes.length < 12) return { ok: false, error: "read" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ok: true, mediaType: "image/jpeg", ext: "jpg" };
  if (PNG.every((b, i) => bytes[i] === b)) return { ok: true, mediaType: "image/png", ext: "png" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { ok: true, mediaType: "image/webp", ext: "webp" };
  return { ok: false, error: "type" };
}
