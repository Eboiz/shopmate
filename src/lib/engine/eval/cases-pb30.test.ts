import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evalCases } from "./cases";
import { pb05EvalCases } from "./cases-pb05";
import { pb06Cases } from "./cases-pb06";
import { pb09Cases } from "./cases-pb09";
import { pb14Cases } from "./cases-pb14";
import { PB30_CODES, PB30_PHOTOS, pb30Cases } from "./cases-pb30";
import { pb31Cases } from "./cases-pb31";

const photos = path.resolve(__dirname, "photos");
const cases = pb30Cases((code) => `id-${code}`);

describe("PB-30 photo eval cases (offline)", () => {
  it("every fixture photo exists and is at most 200 KB", () => {
    for (const name of PB30_PHOTOS) expect(statSync(path.join(photos, name)).size).toBeLessThanOrEqual(200_000);
  });

  it("every photo a case sends is a fixture", () => {
    const sent = cases.flatMap((c) => c.history.flatMap((m) => m.photoPaths ?? []));
    expect(sent.length).toBeGreaterThan(0);
    for (const p of sent) expect(PB30_PHOTOS).toContain(p);
  });

  it("every product code exists in the eval shop's seed", () => {
    const codes = readFileSync(path.resolve(__dirname, "../../../../supabase/seed/demo/products.csv"), "utf8")
      .split("\n").slice(1).map((l) => l.split(",")[0]);
    for (const code of PB30_CODES) expect(codes).toContain(code);
  });

  it("ids are unique across every case set", () => {
    const ids = [...evalCases, ...pb05EvalCases, ...pb06Cases, ...pb09Cases, ...pb14Cases, ...pb31Cases, ...cases].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the last message of every case is the shopper's", () => {
    for (const c of cases) expect(c.history.at(-1)?.sender).toBe("shopper");
  });
});
