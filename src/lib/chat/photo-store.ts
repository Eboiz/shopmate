import "server-only";
import { randomUUID } from "node:crypto";
import type { PhotoInput } from "@/contract";
import type { Db } from "@/lib/engine/types";
import { checkPhoto } from "./photo-rules";
import { shrinkPhoto } from "./shrink-photo";

// PB-30: shopper photos in the private `chat-photos` bucket, at
// <shop_id>/<conversation_id>/<uuid>.<ext>. Server code uses the secret key, so
// every function here takes the shop id from the server, never from a request.
export const PHOTO_BUCKET = "chat-photos";

// The stored path, or null when the bytes are not an accepted photo.
export async function storeShopperPhoto(
  db: Db,
  args: { shopId: string; conversationId: string; bytes: Uint8Array },
): Promise<string | null> {
  const check = checkPhoto(args.bytes);
  if (!check.ok) return null;
  const path = `${args.shopId}/${args.conversationId}/${randomUUID()}.${check.ext}`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, args.bytes, { contentType: check.mediaType });
  if (error) throw new Error(`chat photo upload: ${error.message}`);
  return path;
}

const inShop = (shopId: string, path: string) => path.startsWith(`${shopId}/`) && !path.includes("..");

// The photos as base64 for Claude and the photo search, big ones shrunk (see
// shrink-photo.ts). A path outside the
// shop's folder is a bug, not a missing photo: it throws.
export async function loadPhotos(db: Db, shopId: string, paths: string[]): Promise<PhotoInput[]> {
  const bad = paths.find((p) => !inShop(shopId, p));
  if (bad !== undefined) throw new Error(`chat photo ${bad} is not in shop ${shopId}`);
  const downloaded = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
      if (error || !data) throw new Error(`chat photo download ${path}: ${error?.message ?? "no data"}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const check = checkPhoto(bytes);
      if (!check.ok) throw new Error(`chat photo ${path} is not a photo`);
      return { bytes, mediaType: check.mediaType };
    }),
  );
  // One decode at a time: up to 4 photos decoded together could exhaust memory.
  const photos: PhotoInput[] = [];
  for (const { bytes, mediaType } of downloaded) {
    const photo = await shrinkPhoto(bytes, mediaType);
    photos.push({ base64: Buffer.from(photo.bytes).toString("base64"), mediaType: photo.mediaType });
  }
  return photos;
}

// Signed URLs for the web chat history (1 hour). A path that fails to sign is "".
export async function signPhotoUrls(db: Db, paths: string[], seconds = 3600): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, seconds);
  if (error || !data) {
    console.error("chat photo signing failed", error);
    return paths.map(() => "");
  }
  return paths.map((path) => data.find((d) => d.path === path)?.signedUrl ?? "");
}
