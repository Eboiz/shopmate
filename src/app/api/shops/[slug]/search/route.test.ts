import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatErrors } from "@/lib/chat/request";
import { PHOTO_ERRORS } from "@/lib/search/pb30-shim";
import { searchErrors, searchResponseSchema } from "@/lib/search/request";

const SHOP = { id: "shop-a", name: "Mây Boutique" };
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/chat/web-chat", async (original) => ({
  ...(await original<typeof import("@/lib/chat/web-chat")>()),
  findShop: async (slug: string) => (slug === "may-boutique" ? SHOP : null),
}));

const takeSlot = vi.fn<(input: { shopId: string; clientHash: string }) => Promise<string>>();
vi.mock("@/lib/guard/search-limit", async (original) => ({
  ...(await original<typeof import("@/lib/guard/search-limit")>()),
  takeSearchSlot: (input: { shopId: string; clientHash: string }) => takeSlot(input),
}));

const loadDocs = vi.fn<(shopId: string) => Promise<{ id: string }[]>>();
vi.mock("@/lib/search/shop-docs", () => ({ loadSearchDocs: (shopId: string) => loadDocs(shopId) }));

const search = vi.fn<(query: unknown) => Promise<{ productId: string; score: number }[]>>();
let searchConfigured = true;
vi.mock("@/lib/search/semantic-search", async (original) => ({
  ...(await original<typeof import("@/lib/search/semantic-search")>()),
  semanticSearchFromEnv: () => (searchConfigured ? (query: unknown) => search(query) : null),
}));
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_unit_test";

const { POST } = await import("./route");
const { SemanticSearchUnavailable } = await import("@/lib/search/semantic-search");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function post(fields: { q?: string; photo?: Blob }, slug = "may-boutique") {
  const form = new FormData();
  if (fields.q !== undefined) form.set("q", fields.q);
  if (fields.photo) form.set("photo", fields.photo, "photo.jpg");
  return POST(
    new NextRequest(`https://shop.test/api/shops/${slug}/search`, { method: "POST", body: form }),
    { params: Promise.resolve({ slug }) },
  );
}

async function body(response: Response) {
  const json = await response.json();
  // Every answer is either a valid search response or an error message.
  if (!("error" in json)) expect(searchResponseSchema.safeParse(json).success).toBe(true);
  return json;
}

beforeEach(() => {
  searchConfigured = true;
  takeSlot.mockReset().mockResolvedValue("ok");
  loadDocs.mockReset().mockResolvedValue([{ id: P1 }, { id: P2 }]);
  search.mockReset().mockResolvedValue([
    { productId: P2, score: 0.9 },
    { productId: OTHER, score: 0.85 },
    { productId: P1, score: 0.8 },
  ]);
});

describe("POST /api/shops/[slug]/search", () => {
  it("text search returns product ids of the shop in hit order", async () => {
    const response = await post({ q: "  váy be đi biển " });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await body(response)).toEqual({ mode: "semantic", productIds: [P2, P1] });
    expect(search).toHaveBeenCalledWith({ shopId: SHOP.id, text: "váy be đi biển", photo: null, limit: 10 });
    expect(loadDocs).toHaveBeenCalledWith(SHOP.id);
  });

  it("photo plus text sends both to the search port with the shop id from findShop", async () => {
    const response = await post({ q: "màu đỏ", photo: new Blob([JPEG], { type: "image/jpeg" }) });
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith({
      shopId: SHOP.id,
      text: "màu đỏ",
      photo: { base64: Buffer.from(JPEG).toString("base64"), mediaType: "image/jpeg" },
      limit: 10,
    });
  });

  it("a photo alone is enough, with no text sent", async () => {
    const response = await post({ q: "", photo: new Blob([JPEG], { type: "image/jpeg" }) });
    expect(response.status).toBe(200);
    expect(search.mock.calls[0][0]).toMatchObject({ text: null, photo: { mediaType: "image/jpeg" } });
  });

  it("the media type comes from the bytes, not from the browser's label", async () => {
    await post({ photo: new Blob([JPEG], { type: "image/png" }) });
    expect(search.mock.calls[0][0]).toMatchObject({ photo: { mediaType: "image/jpeg" } });
  });

  it("unknown slug is 404 and calls no search", async () => {
    for (const slug of ["nope", "Bad Slug!"]) {
      const response = await post({ q: "váy be" }, slug);
      expect(response.status).toBe(404);
      expect(await body(response)).toEqual({ error: chatErrors.shopNotFound });
    }
    expect(takeSlot).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("empty, 1-char and 201-char queries return the matching 400 errors", async () => {
    const cases: [string | undefined, string][] = [
      [undefined, searchErrors.empty],
      ["   ", searchErrors.empty],
      [" a ", searchErrors.tooShort],
      ["a".repeat(201), searchErrors.tooLong],
    ];
    for (const [q, error] of cases) {
      const response = await post({ q });
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ error });
    }
    // 200 characters is still fine, and so is 1 character next to a photo.
    expect((await post({ q: "a".repeat(200) })).status).toBe(200);
    expect((await post({ q: "a", photo: new Blob([JPEG]) })).status).toBe(200);
    expect(takeSlot).toHaveBeenCalledTimes(2);
  });

  it("GIF photo returns 400 with PHOTO_ERRORS.type; 6 MB photo returns PHOTO_ERRORS.size without reading its bytes", async () => {
    const gif = await post({ photo: new Blob([GIF], { type: "image/gif" }) });
    expect(gif.status).toBe(400);
    expect(await body(gif)).toEqual({ error: PHOTO_ERRORS.type });

    const big = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" });
    const arrayBuffer = vi.spyOn(File.prototype, "arrayBuffer");
    const bytes = vi.spyOn(File.prototype, "bytes");
    const response = await post({ photo: big });
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: PHOTO_ERRORS.size });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(bytes).not.toHaveBeenCalled();
    arrayBuffer.mockRestore();
    bytes.mockRestore();

    const empty = await post({ photo: new Blob([]) });
    expect(await body(empty)).toEqual({ error: PHOTO_ERRORS.read });
    expect(search).not.toHaveBeenCalled();
  });

  it("a body that is not a form is 400", async () => {
    const response = await POST(
      new NextRequest("https://shop.test/api/shops/may-boutique/search", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ slug: "may-boutique" }) },
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: searchErrors.empty });
  });

  it("over the limit returns 429 rateLimited and calls no search", async () => {
    for (const result of ["client_shop", "shop"]) {
      takeSlot.mockResolvedValueOnce(result);
      const response = await post({ q: "váy be" });
      expect(response.status).toBe(429);
      expect(await body(response)).toEqual({ error: searchErrors.rateLimited });
    }
    expect(search).not.toHaveBeenCalled();
    expect(takeSlot.mock.calls[0][0]).toMatchObject({ shopId: SHOP.id });
  });

  it("a limit check that throws is 500 failed and calls no search", async () => {
    takeSlot.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post({ q: "váy be" });
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: searchErrors.failed });
    expect(search).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("embedder failure returns mode unavailable", async () => {
    search.mockRejectedValueOnce(new SemanticSearchUnavailable("timeout"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await post({ q: "váy be" });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ mode: "unavailable" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no embedder configured returns mode unavailable", async () => {
    searchConfigured = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await post({ q: "váy be" });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ mode: "unavailable" });
    expect(takeSlot).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a catalog read that fails is 500 failed", async () => {
    loadDocs.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post({ q: "váy be" });
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: searchErrors.failed });
    error.mockRestore();
  });
});
