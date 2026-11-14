import { describe, expect, it } from "vitest";
import { EMBEDDER_MAX_LIMIT } from "./embedder-contract";
import { SCORE_FLOORS, pickResults, scoreFloor } from "./rank";
import type { SemanticHit } from "./semantic-search";

const shop = new Set(["p1", "p2", "p3", "p4"]);
const FLOOR = 0.5;

describe("pickResults", () => {
  it("keeps hit order and drops scores below the floor", () => {
    const hits: SemanticHit[] = [
      { productId: "p3", score: 0.9 },
      { productId: "p1", score: FLOOR - 0.01 },
      { productId: "p2", score: 0.7 },
      { productId: "p4", score: FLOOR },
    ];

    expect(pickResults(hits, shop, FLOOR)).toEqual(["p3", "p2", "p4"]);
  });

  it("drops ids that are not products of the shop", () => {
    const hits: SemanticHit[] = [
      { productId: "p2", score: 0.9 },
      { productId: "other-shop", score: 0.95 },
      { productId: "deleted", score: 0.8 },
      { productId: "p1", score: 0.6 },
    ];

    expect(pickResults(hits, shop, FLOOR)).toEqual(["p2", "p1"]);
  });

  it("dedupes repeated ids", () => {
    const hits: SemanticHit[] = [
      { productId: "p2", score: 0.9 },
      { productId: "p1", score: 0.8 },
      { productId: "p2", score: 0.7 },
      { productId: "p1", score: 0.6 },
    ];

    expect(pickResults(hits, shop, FLOOR)).toEqual(["p2", "p1"]);
  });

  it("returns an empty list for no hits", () => {
    expect(pickResults([], shop, FLOOR)).toEqual([]);
  });

  it("caps the list at EMBEDDER_MAX_LIMIT", () => {
    const ids = Array.from({ length: EMBEDDER_MAX_LIMIT + 5 }, (_, index) => `id-${index}`);
    const hits: SemanticHit[] = ids.map((productId, index) => ({ productId, score: 1 - index / 100 }));

    expect(pickResults(hits, new Set(ids), FLOOR)).toEqual(ids.slice(0, EMBEDDER_MAX_LIMIT));
  });
});

describe("scoreFloor", () => {
  it("uses the calibrated reranker floors (2026-11-13, CALIBRATION in the PB-34 spec)", () => {
    expect(scoreFloor("description", true)).toBe(0.47);
    expect(scoreFloor("photo", true)).toBe(0.65);
    expect(SCORE_FLOORS.reranked).toEqual({ description: 0.47, photo: 0.65 });
  });

  it("uses PB-30's cosine photo floor and trusts no cosine description score", () => {
    expect(scoreFloor("photo", false)).toBe(0.55);
    // Never calibrated: the route answers "unavailable" so the instant filter stays.
    expect(scoreFloor("description", false)).toBeNull();
  });
});
