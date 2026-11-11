import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, PHOTO_ERRORS, PHOTO_MEDIA_TYPES, checkPhoto, photoDecision } from "./pb30-shim";

const pad = (length: number) => new Uint8Array(length).fill(0x11);

const jpegBytes = (length = 100) => {
  const bytes = pad(length);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};

const pngBytes = (length = 100) => {
  const bytes = pad(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};

const webpBytes = (length = 100) => {
  const bytes = pad(length);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
};

const gifBytes = (length = 100) => {
  const bytes = pad(length);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  return bytes;
};

// HEIC box: 4 size bytes, then "ftypheic".
const heicBytes = (length = 100) => {
  const bytes = pad(length);
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4);
  return bytes;
};

describe("checkPhoto", () => {
  it("accepts JPEG, PNG and WebP magic bytes with the right ext", () => {
    expect(checkPhoto(jpegBytes())).toEqual({ ok: true, mediaType: "image/jpeg", ext: "jpg" });
    expect(checkPhoto(pngBytes())).toEqual({ ok: true, mediaType: "image/png", ext: "png" });
    expect(checkPhoto(webpBytes())).toEqual({ ok: true, mediaType: "image/webp", ext: "webp" });
  });

  it("rejects GIF and HEIC magic bytes as type", () => {
    expect(checkPhoto(gifBytes())).toEqual({ ok: false, error: "type" });
    expect(checkPhoto(heicBytes())).toEqual({ ok: false, error: "type" });
  });

  it("rejects oversized bytes as size before checking the type", () => {
    expect(checkPhoto(jpegBytes(MAX_PHOTO_BYTES + 1))).toEqual({ ok: false, error: "size" });
    expect(checkPhoto(gifBytes(MAX_PHOTO_BYTES + 1))).toEqual({ ok: false, error: "size" });
  });

  it("reports empty bytes as read", () => {
    expect(checkPhoto(new Uint8Array(0))).toEqual({ ok: false, error: "read" });
  });
});

describe("photoDecision", () => {
  it("keeps a small photo without resize", () => {
    expect(photoDecision({ type: "image/jpeg", size: 100_000 }, { width: 800, height: 600 })).toEqual({
      ok: true,
      resize: false,
    });
  });

  it("resizes a 4.9 MB PNG and a 3000x2000 WebP of 800 KB", () => {
    expect(photoDecision({ type: "image/png", size: 4_900_000 }, { width: 1200, height: 900 })).toEqual({
      ok: true,
      resize: true,
    });
    expect(photoDecision({ type: "image/webp", size: 800_000 }, { width: 3000, height: 2000 })).toEqual({
      ok: true,
      resize: true,
    });
  });

  it("rejects unsupported and oversized photos", () => {
    expect(photoDecision({ type: "image/heic", size: 100_000 }, { width: 800, height: 600 })).toEqual({
      ok: false,
      error: "type",
    });
    expect(photoDecision({ type: "image/gif", size: 100_000 }, { width: 800, height: 600 })).toEqual({
      ok: false,
      error: "type",
    });
    expect(photoDecision({ type: "image/png", size: MAX_PHOTO_BYTES + 1 }, { width: 800, height: 600 })).toEqual({
      ok: false,
      error: "size",
    });
  });
});

describe("shared photo names", () => {
  it("exposes the PB-30 media types and exact Vietnamese errors", () => {
    expect(PHOTO_MEDIA_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(PHOTO_ERRORS).toEqual({
      type: "Chỉ gửi được ảnh JPEG, PNG hoặc WebP.",
      size: "Ảnh tối đa 5 MB.",
      read: "Không đọc được ảnh. Vui lòng chọn ảnh khác.",
    });
  });
});
