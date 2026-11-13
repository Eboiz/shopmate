import { describe, expect, it } from "vitest";
import type { PhotoInput } from "./pb30-shim";
import { mockSemanticSearch, type SearchDoc } from "./mock-search";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const photo: PhotoInput = { base64: "AAAA", mediaType: "image/png" };

const docs: SearchDoc[] = [
  {
    id: "22222222-2222-4222-8222-222222222201",
    name: "Áo sơ mi trắng",
    category: "ao",
    description: null,
    colors: ["Trắng"],
  },
  {
    id: "22222222-2222-4222-8222-222222222202",
    name: "Váy suông linen",
    category: "vay",
    description: "Váy dài đi biển",
    colors: ["Be"],
  },
  {
    id: "22222222-2222-4222-8222-222222222203",
    name: "Quần jean xanh",
    category: "quan",
    description: null,
    colors: ["Xanh"],
  },
];

const search = mockSemanticSearch(async () => docs);

describe("mockSemanticSearch", () => {
  it("ranks the matching doc first with score 1", async () => {
    const { hits, reranked } = await search({ shopId: SHOP_ID, text: "vay be", photo: null, limit: 10 });
    expect(reranked).toBe(true);

    expect(hits[0]).toEqual({ productId: docs[1].id, score: 1 });
  });

  it("returns hits below the floor when nothing matches", async () => {
    const { hits } = await search({ shopId: SHOP_ID, text: "túi xách da", photo: null, limit: 10 });

    expect(hits).toHaveLength(docs.length);
    expect(hits.every((hit) => hit.score < 0.5)).toBe(true);
  });

  it("returns the first limit docs with descending scores for a photo only", async () => {
    const { hits } = await search({ shopId: SHOP_ID, text: null, photo, limit: 3 });

    expect(hits).toEqual([
      { productId: docs[0].id, score: 0.9 },
      { productId: docs[1].id, score: 0.85 },
      { productId: docs[2].id, score: 0.8 },
    ]);
  });
});
