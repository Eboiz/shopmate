import { describe, expect, it } from "vitest";
import { liveCases } from "./live-cases";
import { formatCountdown, groupTotals, HOUR, hourlyBudget, LIMITS, planRows, planTotals, sendDelay, waitForBudget } from "./live-pacing";

describe("sendDelay", () => {
  it("keeps 4 s between sends", () => {
    expect(sendDelay([], 10_000)).toBe(0);
    expect(sendDelay([10_000], 11_000)).toBe(3000);
    expect(sendDelay([10_000], 20_000)).toBe(0);
  });

  it("never sends more than 12 in a rolling minute (production allows 15)", () => {
    const sent = Array.from({ length: 12 }, (_, i) => i * 4000); // 0 .. 44 s
    expect(sendDelay(sent, 48_000)).toBe(12_000); // the first send leaves the window at 60 s
    expect(sendDelay(sent, 60_000)).toBe(0);
  });
});

describe("hourly new-shopper budget", () => {
  const now = 10 * HOUR;
  it("counts only the last hour", () => {
    expect(hourlyBudget([now - HOUR - 1, now - 1000, now - 2000], now)).toEqual({ used: 2, remaining: 18 });
  });

  it("waits until enough entries leave the window", () => {
    const ledger = Array.from({ length: 18 }, (_, i) => now - HOUR + 60_000 * (i + 1)); // 1..18 min into the window
    expect(waitForBudget(ledger, now, 2)).toBe(0);
    // 5 needed, 2 left: the 3rd oldest entry must expire (3 min after the window start) + 1 s margin.
    expect(waitForBudget(ledger, now, 5)).toBe(3 * 60_000 + 1000);
    expect(waitForBudget([], now, LIMITS.newShoppersPerHour + 1)).toBe(Infinity);
  });

  it("formats a countdown", () => {
    expect(formatCountdown(3 * 60_000 + 1000)).toBe("03:01");
  });
});

describe("plan", () => {
  it("fits every group in one hour's budget at the default 3 runs", () => {
    const groups = groupTotals(liveCases, 3);
    expect(groups.map((g) => g.group)).toEqual([1, 2, 3, 4]);
    for (const g of groups) expect(g.newShoppers).toBeLessThanOrEqual(LIMITS.newShoppersPerHour);
  });

  it("counts one new shopper per run and every turn as a message", () => {
    const order = liveCases.filter((c) => c.id === "pb11-order");
    const t = planTotals(planRows(order, 3));
    expect(t).toMatchObject({ cases: 1, runs: 3, newShoppers: 3, messages: 12 });
    expect(t.tokens).toBeGreaterThan(0);
  });

  it("has unique case ids and the scratch run's wording for PB-04/05/09", () => {
    const ids = liveCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const first = (id: string) => liveCases.find((c) => c.id === id)!.turns[0];
    expect(first("pb05-instock")).toBe("vay suong linen mau be size M con khong shop?");
    expect(first("pb05-soldout")).toBe("Váy babydoll tay bồng màu trắng size M còn không shop?");
    expect(first("pb09-discount")).toBe("Mình lấy 2 cái, shop bớt cho mình 50k được không?");
  });
});
