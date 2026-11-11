import { describe, expect, it } from "vitest";
import { EMBEDDER_MAX_LIMIT } from "./embedder-contract";
import { DESCRIPTION_MIN_SCORE, PHOTO_MIN_SCORE, pickResults } from "./rank";
import type { SemanticHit } from "./semantic-search";

const shop = new Set(["p1", "p2", "p3", "p4"]);

describe("pickResults", () => {
  it("keeps hit order and drops scores below the floor", () => {
    const hits: SemanticHit[] = [
      { productId: "p3", score: 0.9 },
      { productId: "p1", score: DESCRIPTION_MIN_SCORE - 0.01 },
      { productId: "p2", score: 0.7 },
    ];

    expect(pickResults(hits, shop, "description")).toEqual(["p3", "p2"]);
  });

  it("drops ids that are not products of the shop", () => {
    const hits: SemanticHit[] = [
      { productId: "p2", score: 0.9 },
      { productId: "other-shop", score: 0.95 },
      { productId: "deleted", score: 0.8 },
      { productId: "p1", score: 0.6 },
    ];

    expect(pickResults(hits, shop, "description")).toEqual(["p2", "p1"]);
  });

  it("dedupes repeated ids", () => {
    const hits: SemanticHit[] = [
      { productId: "p2", score: 0.9 },
      { productId: "p1", score: 0.8 },
      { productId: "p2", score: 0.7 },
      { productId: "p1", score: 0.6 },
    ];

    expect(pickResults(hits, shop, "description")).toEqual(["p2", "p1"]);
  });

  it("uses PHOTO_MIN_SCORE for photo searches", () => {
    const hits: SemanticHit[] = [
      { productId: "p1", score: PHOTO_MIN_SCORE },
      { productId: "p2", score: PHOTO_MIN_SCORE - 0.01 },
      { productId: "p3", score: 0.8 },
    ];

    expect(pickResults(hits, shop, "photo")).toEqual(["p1", "p3"]);
  });

  it("empty hits give []", () => {
    expect(pickResults([], shop, "description")).toEqual([]);
  });

  it("keeps at most EMBEDDER_MAX_LIMIT results", () => {
    const ids = Array.from({ length: EMBEDDER_MAX_LIMIT + 2 }, (_, index) => `limit-${index}`);
    const hits: SemanticHit[] = ids.map((productId, index) => ({ productId, score: 1 - index / 100 }));

    expect(pickResults(hits, new Set(ids), "description")).toEqual(ids.slice(0, EMBEDDER_MAX_LIMIT));
  });
});
