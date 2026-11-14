import { describe, expect, it, vi } from "vitest";
import { MAX_PHOTO_BYTES } from "@/contract";
import { messengerPhoto, telegramPhoto } from "./photo-download";

const bytesResponse = (size: number, status = 200) => new Response(new Uint8Array(size).fill(7), { status });

describe("photo-download", () => {
  it("messenger: downloads the attachment URL", async () => {
    const fetch = vi.fn(async () => bytesResponse(100));
    const bytes = await messengerPhoto("https://cdn.fb/x.jpg", fetch)();
    expect(bytes).toHaveLength(100);
    expect(fetch).toHaveBeenCalledWith("https://cdn.fb/x.jpg", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("telegram: getFile, then the file URL", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/getFile?file_id=F%201")
        ? new Response(JSON.stringify({ ok: true, result: { file_path: "photos/f.jpg" } }))
        : bytesResponse(50));
    const bytes = await telegramPhoto("TOKEN", "F 1", fetch as unknown as typeof globalThis.fetch)();
    expect(bytes).toHaveLength(50);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      "https://api.telegram.org/botTOKEN/getFile?file_id=F%201",
      "https://api.telegram.org/file/botTOKEN/photos/f.jpg",
    ]);
  });

  it("a non-2xx answer or a failed getFile throws", async () => {
    await expect(messengerPhoto("u", async () => bytesResponse(10, 404))()).rejects.toThrow(/404/);
    await expect(telegramPhoto("T", "f", async () => new Response(JSON.stringify({ ok: false })))()).rejects.toThrow(/getFile/);
  });

  it("stops reading one byte past the limit, so the size check refuses it", async () => {
    const bytes = await messengerPhoto("u", async () => bytesResponse(MAX_PHOTO_BYTES + 5000))();
    expect(bytes).toHaveLength(MAX_PHOTO_BYTES + 1);
  });
});
