import { describe, expect, it, vi } from "vitest";
import type { ToolRun } from "./execute-tool";
import type { CatalogItem } from "./jev";
import { cachedCatalog, turnToolCache } from "./turn-cache";

const run = (content: string, isError = false): ToolRun => ({ log: null, content, isError });

describe("turnToolCache", () => {
  it("the same input hits, whatever the key order", () => {
    const cache = turnToolCache();
    const r = run("ok");
    cache.set("get_stock", { productId: "p", size: "M" }, r);
    expect(cache.get("get_stock", { size: "M", productId: "p" })).toBe(r);
  });

  it("a different input misses", () => {
    const cache = turnToolCache();
    cache.set("search_products", { query: "váy" }, run("ok"));
    expect(cache.get("search_products", { query: "áo" })).toBeUndefined();
  });

  it("write tools and the handoff are never cached", () => {
    const cache = turnToolCache();
    for (const name of ["create_draft_order", "handoff_to_staff"]) {
      cache.set(name, {}, run("ok"));
      expect(cache.get(name, {})).toBeUndefined();
    }
  });

  it("a failed run is not cached", () => {
    const cache = turnToolCache();
    cache.set("get_stock", { productId: "p" }, run("err", true));
    expect(cache.get("get_stock", { productId: "p" })).toBeUndefined();
  });
});

describe("cachedCatalog", () => {
  const items: CatalogItem[] = [{ id: "p", name: "Váy", category: null, colors: [], sizes: [] }];

  it("a second call within the TTL does not load; after the TTL it loads again", async () => {
    let t = 0;
    const load = vi.fn(async () => items);
    const catalog = cachedCatalog(load, 30_000, () => t);
    await catalog("shop");
    t = 29_999;
    await catalog("shop");
    expect(load).toHaveBeenCalledTimes(1);
    t = 30_000;
    await catalog("shop");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("one in-flight load per shop, and shops are separate", async () => {
    const load = vi.fn<(shopId: string) => Promise<CatalogItem[]>>(async () => items);
    const catalog = cachedCatalog(load, 30_000, () => 0);
    await Promise.all([catalog("a"), catalog("a"), catalog("b")]);
    expect(load.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("a rejected load is retried on the next call", async () => {
    const load = vi.fn<(shopId: string) => Promise<CatalogItem[]>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(items);
    const catalog = cachedCatalog(load, 30_000, () => 0);
    await expect(catalog("shop")).rejects.toThrow("db down");
    await expect(catalog("shop")).resolves.toEqual(items);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
