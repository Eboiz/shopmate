// F5/F7 latency: the shop catalogue is read once per 30 s per process instead of
// every turn, and an identical read-only tool call in the same turn is answered
// from the first result instead of the database.
import { tools } from "@/contract";
import type { CatalogItem } from "./jev";
import type { ToolRun } from "./execute-tool";

// Per-process cache, one in-flight load per shop. A rejected load is not kept,
// so the next turn reads again. The catalogue is names, categories, colours and
// sizes (Jev routing, quick-reply filter): never prices or stock.
export function cachedCatalog(
  load: (shopId: string) => Promise<CatalogItem[]>,
  ttlMs = 30_000,
  now: () => number = Date.now,
): (shopId: string) => Promise<CatalogItem[]> {
  const entries = new Map<string, { at: number; value: Promise<CatalogItem[]> }>();
  return (shopId) => {
    const hit = entries.get(shopId);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = load(shopId);
    entries.set(shopId, { at: now(), value });
    value.catch(() => {
      if (entries.get(shopId)?.value === value) entries.delete(shopId);
    });
    return value;
  };
}

// JSON with object keys sorted, so {a,b} and {b,a} are the same call.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// Read-only: a contract tool that writes nothing and is not the handoff.
const isReadOnly = (name: string) =>
  name !== "handoff_to_staff" && Object.hasOwn(tools, name) && !tools[name as keyof typeof tools].writes;

// One per turn. Only ok runs are stored, so a failed call can be tried again.
export function turnToolCache(): {
  get(name: string, input: unknown): ToolRun | undefined;
  set(name: string, input: unknown, run: ToolRun): void;
} {
  const runs = new Map<string, ToolRun>();
  const key = (name: string, input: unknown) => `${name}:${stableJson(input)}`;
  return {
    get: (name, input) => (isReadOnly(name) ? runs.get(key(name, input)) : undefined),
    set: (name, input, run) => {
      if (isReadOnly(name) && !run.isError) runs.set(key(name, input), run);
    },
  };
}
