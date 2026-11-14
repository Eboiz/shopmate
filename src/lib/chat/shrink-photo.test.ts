import { randomFillSync } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { PHOTO_SHRINK_ABOVE_BYTES, PHOTO_SHRINK_EDGE, shrinkPhoto } from "./shrink-photo";

// Random pixels do not compress, so a 1200 px PNG is well above the byte limit,
// like the 0.8-1.4 MB screenshots that took 16-25 s per Claude call.
async function noisyPng(width: number, height: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  randomFillSync(pixels);
  return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer());
}

describe("shrinkPhoto", () => {
  it("re-encodes a big PNG as a JPEG of at most PHOTO_SHRINK_EDGE px", async () => {
    const png = await noisyPng(1200, 900);
    expect(png.length).toBeGreaterThan(PHOTO_SHRINK_ABOVE_BYTES);
    const out = await shrinkPhoto(png, "image/png");
    expect(out.mediaType).toBe("image/jpeg");
    expect(out.bytes.length).toBeLessThan(png.length);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(PHOTO_SHRINK_EDGE);
    expect(meta.width! / meta.height!).toBeCloseTo(1200 / 900, 1);
  });

  it("applies the EXIF rotation: a portrait photo stays portrait", async () => {
    const pixels = Buffer.alloc(1200 * 900 * 3);
    randomFillSync(pixels);
    // Stored 1200 x 900 with orientation 6 (rotate 90°): shown as 900 x 1200.
    const jpeg = await sharp(pixels, { raw: { width: 1200, height: 900, channels: 3 } })
      .jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer();
    expect(jpeg.length).toBeGreaterThan(PHOTO_SHRINK_ABOVE_BYTES);
    const meta = await sharp((await shrinkPhoto(new Uint8Array(jpeg), "image/jpeg")).bytes).metadata();
    expect(meta.height).toBe(PHOTO_SHRINK_EDGE);
    expect(meta.width).toBe(768);
  });

  it("puts a transparent background on white", async () => {
    const width = 1200;
    const pixels = Buffer.alloc(width * width * 4);
    randomFillSync(pixels);
    // The top-left 50 x 50 px are fully transparent.
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) pixels[(y * width + x) * 4 + 3] = 0;
    const png = await sharp(pixels, { raw: { width, height: width, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
    expect(png.length).toBeGreaterThan(PHOTO_SHRINK_ABOVE_BYTES);
    const out = await shrinkPhoto(new Uint8Array(png), "image/png");
    const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]].every((v) => v! > 240)).toBe(true);
  });

  it("refuses to decode a photo above the pixel limit and keeps the original", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const png = await noisyPng(1200, 900);
    const out = await shrinkPhoto(png, "image/png", { maxPixels: 1000 * 1000 });
    expect(out.bytes).toBe(png);
    expect(out.mediaType).toBe("image/png");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps a small photo as it is, without decoding it", async () => {
    const tiny = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(1)]);
    const out = await shrinkPhoto(tiny, "image/jpeg");
    expect(out).toEqual({ bytes: tiny, mediaType: "image/jpeg" });
  });

  it("keeps the original when the bytes can't be decoded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const junk = new Uint8Array(PHOTO_SHRINK_ABOVE_BYTES + 1).fill(7);
    junk.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const out = await shrinkPhoto(junk, "image/png");
    expect(out.bytes).toBe(junk);
    expect(out.mediaType).toBe("image/png");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
