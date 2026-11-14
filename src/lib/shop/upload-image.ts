import { createClient } from "@/lib/supabase/client";
import { fitWithin } from "./gallery";

// Browser side of PB-32 uploads. A phone photo is several MB; the buckets take
// 200 KB (product photos) or 500 KB (banners). So the photo is redrawn at most
// `maxSide` wide/high and re-encoded (WebP, or JPEG where the browser cannot
// write WebP) until it fits, then uploaded with the owner's own session. The
// Storage policy lets the owner write only into their shop's folder.

export const UPLOAD_FAILED = "Tải ảnh lên không được. Hãy thử lại hoặc chọn ảnh khác.";
export const NOT_AN_IMAGE = "Tệp này không phải ảnh JPG, PNG hoặc WebP.";
const TOO_DETAILED = "Ảnh quá nặng, không thu nhỏ được. Hãy chọn ảnh khác.";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPT_ATTRIBUTE = ACCEPTED.join(",");

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function shrinkImage(file: File, maxSide: number, maxBytes: number): Promise<Blob> {
  if (!ACCEPTED.includes(file.type)) throw new Error(NOT_AN_IMAGE);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(NOT_AN_IMAGE);
  });
  try {
    let side = maxSide;
    // Lower the quality first, then the size, until the file fits.
    for (let round = 0; round < 4; round += 1) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(UPLOAD_FAILED);
      context.fillStyle = "#ffffff"; // a transparent PNG gets a white background in JPEG
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.85, 0.75, 0.62]) {
        let blob = await encode(canvas, "image/webp", quality);
        if (blob?.type !== "image/webp") blob = await encode(canvas, "image/jpeg", quality);
        if (blob && blob.size <= maxBytes) return blob;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error(TOO_DETAILED);
  } finally {
    bitmap.close();
  }
}

// Uploads into <bucket>/<folder>/<random>.<ext> and returns the public URL.
export async function uploadImage(blob: Blob, bucket: string, folder: string): Promise<string> {
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const storage = createClient().storage.from(bucket);
  const { error } = await storage.upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(UPLOAD_FAILED);
  return storage.getPublicUrl(path).data.publicUrl;
}

export async function shrinkAndUpload(file: File, options: { bucket: string; folder: string; maxSide: number; maxBytes: number }) {
  const blob = await shrinkImage(file, options.maxSide, options.maxBytes);
  return uploadImage(blob, options.bucket, options.folder);
}

export function uploadErrorMessage(error: unknown): string {
  return error instanceof Error && [NOT_AN_IMAGE, TOO_DETAILED].includes(error.message) ? error.message : UPLOAD_FAILED;
}
