import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { embedderSearchRequestSchema, embedderSearchResponseSchema } from "./embedder-contract";

const fixturesDir = path.join(import.meta.dirname, "contract-fixtures");

describe("request fixtures", () => {
  // The fixtures are the PB-30/PB-34 contract examples: every file must parse
  // exactly when the embedder would accept the body (spec section 3.1).
  it("parses every request fixture iff expectStatus is 200", () => {
    const files = readdirSync(fixturesDir).filter((name) => /^request-.*\.json$/.test(name));
    expect(files).toHaveLength(5);
    for (const name of files) {
      const { expectStatus, body } = JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8"));
      expect(embedderSearchRequestSchema.safeParse(body).success, name).toBe(expectStatus === 200);
    }
  });
});

describe("response fixture", () => {
  it("response-ok parses and hits are sorted by score descending", () => {
    const body = JSON.parse(readFileSync(path.join(fixturesDir, "response-ok.json"), "utf8"));
    const parsed = embedderSearchResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const scores = parsed.data!.hits.map((hit) => hit.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe("field limits", () => {
  const base = { shopId: "11111111-1111-4111-8111-111111111111", text: "váy dài màu be đi biển" };

  it("rejects text over 200 chars and limit 11", () => {
    expect(embedderSearchRequestSchema.safeParse({ ...base, text: "a".repeat(201) }).success).toBe(false);
    expect(embedderSearchRequestSchema.safeParse({ ...base, limit: 11 }).success).toBe(false);
    expect(embedderSearchRequestSchema.safeParse({ ...base, text: "a".repeat(200) }).success).toBe(true);
  });
});
