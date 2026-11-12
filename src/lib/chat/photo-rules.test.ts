import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES } from "@/contract";
import { checkPhoto, PHOTO_ERRORS } from "./photo-rules";

const withHead = (head: number[] | string, size = 64) => {
  const bytes = new Uint8Array(size);
  const h = typeof head === "string" ? [...head].map((c) => c.charCodeAt(0)) : head;
  bytes.set(h);
  return bytes;
};

describe("checkPhoto", () => {
  it("accepts JPEG, PNG and WebP by their bytes", () => {
    expect(checkPhoto(withHead([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ ok: true, mediaType: "image/jpeg", ext: "jpg" });
    expect(checkPhoto(withHead([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ ok: true, mediaType: "image/png", ext: "png" });
    expect(checkPhoto(withHead("RIFF\0\0\0\0WEBPVP8 "))).toEqual({ ok: true, mediaType: "image/webp", ext: "webp" });
  });

  it("refuses GIF and iPhone HEIC with the type error", () => {
    expect(checkPhoto(withHead("GIF89a"))).toEqual({ ok: false, error: "type" });
    expect(checkPhoto(withHead("\0\0\0\x18ftypheic"))).toEqual({ ok: false, error: "type" });
  });

  it("checks the size first, then an empty or cut file is unreadable", () => {
    expect(checkPhoto(withHead([0xff, 0xd8, 0xff], MAX_PHOTO_BYTES + 1))).toEqual({ ok: false, error: "size" });
    expect(checkPhoto(withHead([0xff, 0xd8, 0xff], MAX_PHOTO_BYTES))).toMatchObject({ ok: true });
    expect(checkPhoto(new Uint8Array(0))).toEqual({ ok: false, error: "read" });
  });

  it("has the exact Vietnamese texts", () => {
    expect(PHOTO_ERRORS).toEqual({
      type: "Chỉ gửi được ảnh JPEG, PNG hoặc WebP.",
      size: "Ảnh tối đa 5 MB.",
      read: "Không đọc được ảnh. Vui lòng chọn ảnh khác.",
    });
  });
});
