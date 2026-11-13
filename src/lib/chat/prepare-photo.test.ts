import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PHOTO_BYTES } from "@/contract";
import { PHOTO_ERRORS } from "./photo-rules";
import { photoDecision, preparePhoto } from "./prepare-photo";

const MB = 1024 * 1024;

describe("photoDecision", () => {
  it("keeps a small photo as it is", () => {
    expect(photoDecision({ type: "image/jpeg", size: 300_000 }, { width: 1200, height: 900 })).toEqual({ ok: true, resize: false });
  });
  it("shrinks a big file or a long edge over 1568 px", () => {
    expect(photoDecision({ type: "image/png", size: 4.9 * MB }, { width: 1000, height: 800 })).toEqual({ ok: true, resize: true });
    expect(photoDecision({ type: "image/webp", size: 800_000 }, { width: 3000, height: 2000 })).toEqual({ ok: true, resize: true });
  });
  it("refuses HEIC and GIF with the type error, and a file over 5 MB with the size error", () => {
    expect(photoDecision({ type: "image/heic", size: 1000 }, { width: 10, height: 10 })).toEqual({ ok: false, error: "type" });
    expect(photoDecision({ type: "image/gif", size: 1000 }, { width: 10, height: 10 })).toEqual({ ok: false, error: "type" });
    expect(photoDecision({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 }, { width: 10, height: 10 })).toEqual({ ok: false, error: "size" });
  });
});

describe("preparePhoto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a photo it can't draw (no 2D canvas) instead of sending a blank one", async () => {
    const toBlob = vi.fn((done: (blob: Blob | null) => void) => done(new Blob(["blank"], { type: "image/jpeg" })));
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close: () => {} }));
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => null, toBlob }) });
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });

    expect(await preparePhoto(big)).toEqual({ ok: false, error: PHOTO_ERRORS.read });
    expect(toBlob).not.toHaveBeenCalled();
  });
});
