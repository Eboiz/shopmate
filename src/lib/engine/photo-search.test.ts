import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyHits,
  EMBEDDER_TIMEOUT_MS,
  PHOTO_SIMILAR_MAX,
  PHOTO_SIMILAR_MIN,
  PhotoSearchUnavailable,
  searchByPhoto,
} from "./photo-search";

const SHOP = "a0000000-0000-4000-8000-000000000001";
const env = { EMBEDDER_URL: "https://gpu.test/", EMBEDDER_TOKEN: "tok" };
const photo = { base64: "aGVsbG8=", mediaType: "image/jpeg" as const };
const args = { shopId: SHOP, photo, text: "áo blazer trắng", limit: 10 };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const R = PHOTO_SIMILAR_MIN.reranked;
const C = PHOTO_SIMILAR_MIN.cosine;

afterEach(() => vi.useRealTimers());

describe("searchByPhoto", () => {
  it("posts shopId, image, text and limit with the bearer token", async () => {
    const fetch = vi.fn(async () => ok({ hits: [{ productId: "p1", score: 0.9 }], reranked: true, model: "m", dim: 768 }));
    const result = await searchByPhoto(args, { fetch, env });
    expect(result).toEqual({ hits: [{ productId: "p1", score: 0.9 }], reranked: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gpu.test/search");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["imageBase64", "limit", "mediaType", "shopId", "text"]);
    expect(body).toMatchObject({ shopId: SHOP, imageBase64: photo.base64, mediaType: "image/jpeg", text: "áo blazer trắng", limit: 10 });
  });

  it("leaves text out when there is none, and cuts it to 200 characters", async () => {
    const fetch = vi.fn(async () => ok({ hits: [], model: "m", dim: 768 }));
    await searchByPhoto({ ...args, text: "  " }, { fetch, env });
    await searchByPhoto({ ...args, text: "a".repeat(300) }, { fetch, env });
    const bodies = fetch.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0]).not.toHaveProperty("text");
    expect(bodies[1].text).toHaveLength(200);
  });

  it("reads a response without `reranked` as cosine scores", async () => {
    const fetch = vi.fn(async () => ok({ hits: [{ productId: "p1", score: 0.7 }], model: "m", dim: 768 }));
    expect(await searchByPhoto(args, { fetch, env })).toEqual({ hits: [{ productId: "p1", score: 0.7 }], reranked: false });
  });

  it("throws PhotoSearchUnavailable when not configured, on non-2xx and on a bad body", async () => {
    const never = vi.fn();
    await expect(searchByPhoto(args, { fetch: never, env: { EMBEDDER_URL: "", EMBEDDER_TOKEN: "tok" } })).rejects.toBeInstanceOf(PhotoSearchUnavailable);
    await expect(searchByPhoto(args, { fetch: never, env: { EMBEDDER_URL: "https://gpu.test", EMBEDDER_TOKEN: "" } })).rejects.toBeInstanceOf(PhotoSearchUnavailable);
    expect(never).not.toHaveBeenCalled();
    await expect(searchByPhoto(args, { fetch: async () => new Response("no", { status: 503 }), env })).rejects.toBeInstanceOf(PhotoSearchUnavailable);
    await expect(searchByPhoto(args, { fetch: async () => new Response("not json", { status: 200 }), env })).rejects.toBeInstanceOf(PhotoSearchUnavailable);
    await expect(searchByPhoto(args, { fetch: async () => ok({ hits: [{ productId: 1 }] }), env })).rejects.toBeInstanceOf(PhotoSearchUnavailable);
  });

  it("gives up after EMBEDDER_TIMEOUT_MS (a cold GPU container)", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
    const pending = searchByPhoto(args, { fetch: fetch as unknown as typeof globalThis.fetch, env });
    const assertion = expect(pending).rejects.toBeInstanceOf(PhotoSearchUnavailable);
    await vi.advanceTimersByTimeAsync(EMBEDDER_TIMEOUT_MS);
    await assertion;
  });
});

describe("classifyHits", () => {
  const hit = (productId: string, score: number) => ({ productId, score });

  it("never says exact: up to 3 hits at or above the reranker floor are similar, in order", () => {
    const hits = [0.99, 0.95, 0.9, 0.85].map((score, i) => hit(`s${i}`, score));
    expect(classifyHits({ hits, reranked: true })).toEqual(hits.slice(0, PHOTO_SIMILAR_MAX).map((h) => ({ ...h, match: "similar" })));
  });

  it("nothing below the floor (another kind of item, a non-clothing photo)", () => {
    expect(classifyHits({ hits: [hit("x", R - 0.01)], reranked: true })).toEqual([]);
    expect(classifyHits({ hits: [hit("x", R)], reranked: true })).toEqual([{ productId: "x", score: R, match: "similar" }]);
  });

  it("cosine scores use their own floor", () => {
    const hits = [hit("a", C), hit("b", C - 0.01)];
    expect(classifyHits({ hits, reranked: false })).toEqual([{ ...hits[0], match: "similar" }]);
  });
});
