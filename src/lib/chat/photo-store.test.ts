import { randomFillSync } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/engine/types";
import { loadPhotos, signPhotoUrls, storeShopperPhoto } from "./photo-store";

const SHOP = "a0000000-0000-4000-8000-000000000001";
const CONV = "a0000000-0000-4000-8000-000000000031";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(1)]);

function fakeDb(files: Record<string, Uint8Array> = {}) {
  const upload = vi.fn(async (path: string, bytes: Uint8Array) => {
    files[path] = bytes;
    return { data: { path }, error: null };
  });
  const download = vi.fn(async (path: string) =>
    files[path] ? { data: new Blob([files[path] as BlobPart]), error: null } : { data: null, error: { message: "not found" } });
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
    error: null,
  }));
  const from = vi.fn(() => ({ upload, download, createSignedUrls }));
  return { db: { storage: { from } } as unknown as Db, from, upload, download, files };
}

describe("photo-store", () => {
  it("stores an accepted photo under <shop>/<conversation>/<uuid>.<ext> with its type", async () => {
    const { db, from, upload } = fakeDb();
    const path = await storeShopperPhoto(db, { shopId: SHOP, conversationId: CONV, bytes: JPEG });
    expect(path).toMatch(new RegExp(`^${SHOP}/${CONV}/[0-9a-f-]{36}\\.jpg$`));
    expect(from).toHaveBeenCalledWith("chat-photos");
    expect(upload).toHaveBeenCalledWith(path, JPEG, { contentType: "image/jpeg" });
  });

  it("does not store a file that is not an accepted photo", async () => {
    const { db, upload } = fakeDb();
    expect(await storeShopperPhoto(db, { shopId: SHOP, conversationId: CONV, bytes: new TextEncoder().encode("GIF89a........") })).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("loads stored photos as base64 with their type", async () => {
    const path = `${SHOP}/${CONV}/p.jpg`;
    const { db } = fakeDb({ [path]: JPEG });
    expect(await loadPhotos(db, SHOP, [path])).toEqual([{ base64: Buffer.from(JPEG).toString("base64"), mediaType: "image/jpeg" }]);
  });

  it("loads a big stored photo shrunk to a JPEG", async () => {
    const width = 1200;
    const pixels = Buffer.alloc(width * width * 3);
    randomFillSync(pixels);
    const png = new Uint8Array(await sharp(pixels, { raw: { width, height: width, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer());
    const path = `${SHOP}/${CONV}/p.png`;
    const { db } = fakeDb({ [path]: png });
    const [photo] = await loadPhotos(db, SHOP, [path]);
    expect(photo!.mediaType).toBe("image/jpeg");
    expect(Buffer.from(photo!.base64, "base64").length).toBeLessThan(png.length);
  });

  it("refuses a path outside the shop's folder", async () => {
    const { db, download } = fakeDb();
    await expect(loadPhotos(db, SHOP, ["b0000000-0000-4000-8000-000000000001/x/p.jpg"])).rejects.toThrow(/not in shop/);
    await expect(loadPhotos(db, SHOP, [`${SHOP}/../other/p.jpg`])).rejects.toThrow(/not in shop/);
    expect(download).not.toHaveBeenCalled();
  });

  it("signs URLs in path order", async () => {
    const { db } = fakeDb();
    expect(await signPhotoUrls(db, ["a/1.jpg", "a/2.jpg"])).toEqual(["https://signed/a/1.jpg", "https://signed/a/2.jpg"]);
    expect(await signPhotoUrls(db, [])).toEqual([]);
  });
});
