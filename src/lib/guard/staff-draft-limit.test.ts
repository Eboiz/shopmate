import { beforeEach, describe, expect, it, vi } from "vitest";

let counts: number[];
let queries: { filters: [string, unknown][] }[];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("ai_turns");
      const query = { filters: [] as [string, unknown][] };
      const index = queries.push(query) - 1;
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => (query.filters.push([key, value]), chain),
        gte: (key: string, value: unknown) => (query.filters.push([key, value]), chain),
        then: (resolve: (v: unknown) => void) => resolve({ count: counts[index], error: null }),
      };
      return chain;
    },
  }),
}));

const { isOverStaffDraftLimit, staffDraftLimitReached, STAFF_DRAFT_LIMITS } = await import("./staff-draft-limit");

beforeEach(() => {
  counts = [0, 0];
  queries = [];
});

describe("staff draft limit (PB-20)", () => {
  it("allows drafts under both budgets", () => {
    expect(isOverStaffDraftLimit([STAFF_DRAFT_LIMITS[0].max - 1, STAFF_DRAFT_LIMITS[1].max - 1])).toBe(false);
  });

  it("stops at the per-minute budget", () => {
    expect(isOverStaffDraftLimit([STAFF_DRAFT_LIMITS[0].max, 0])).toBe(true);
  });

  it("stops at the daily budget", () => {
    expect(isOverStaffDraftLimit([0, STAFF_DRAFT_LIMITS[1].max])).toBe(true);
  });

  it("counts this shop's staff_draft turns in each window", async () => {
    counts = [STAFF_DRAFT_LIMITS[0].max, 0];
    const now = new Date("2026-11-07T10:00:00Z");
    expect(await staffDraftLimitReached("shop-a", now)).toBe(true);
    expect(queries[0].filters).toEqual([
      ["shop_id", "shop-a"],
      ["mode", "staff_draft"],
      ["created_at", "2026-11-07T09:59:00.000Z"],
    ]);
    expect(queries[1].filters).toContainEqual(["created_at", "2026-11-06T10:00:00.000Z"]);
  });

  it("allows the draft when the counts are low", async () => {
    expect(await staffDraftLimitReached("shop-a")).toBe(false);
  });
});
