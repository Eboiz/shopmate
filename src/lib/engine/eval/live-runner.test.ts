import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { caseData, liveCases } from "./live-cases";
import { replayTransport } from "./live-fake";
import { HOUR } from "./live-pacing";
import { renderLiveReport } from "./live-report";
import { issueVerdicts, scoreLiveRun } from "./live-results";
import { memoryLedger, PlanRefused, runLive, virtualClock, type RunnerOptions } from "./live-runner";
import type { LiveResults, RunRecord } from "./live-types";

const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "live-fake.json"), "utf8")) as LiveResults;
const snapshot = fixture.snapshot;
const recorded = (id: string, i = 0): RunRecord => structuredClone(fixture.cases.find((c) => c.id === id)!.runs[i].record);
const caseOf = (id: string) => liveCases.find((c) => c.id === id)!;
const withShopper = (id: string, rec: RunRecord) => {
  const turns = caseOf(id).turns;
  rec.turns.forEach((t, i) => (t.shopper = typeof turns[i] === "string" ? turns[i] : turns[i].text));
  return rec;
};
const score = (id: string, rec = recorded(id)) => scoreLiveRun(caseOf(id), snapshot, withShopper(id, rec));

function options(over: Partial<RunnerOptions> = {}): RunnerOptions & { lines: string[] } {
  const clock = virtualClock(Date.parse("2026-11-11T09:00:00Z"));
  const lines: string[] = [];
  return {
    cases: liveCases.filter((c) => c.group === 1),
    runs: 3,
    snapshot,
    transport: replayTransport(fixture, clock),
    clock,
    ledger: memoryLedger(),
    log: (l) => lines.push(l),
    wait: false,
    meta: { base: "https://example.test", shop: "may-boutique-eval", group: 1, filters: { case: null, issue: null }, fake: true },
    lines,
    ...over,
  };
}

describe("cases on the recorded fixture", () => {
  it("every case passes on its first recorded run", () => {
    for (const c of liveCases) {
      const s = score(c.id);
      expect({ id: c.id, outcome: s.outcome, reason: s.reason }).toMatchObject({ id: c.id, outcome: "pass" });
    }
  });

  it("fails a wrong price (PB-05)", () => {
    const rec = recorded("pb05-instock");
    rec.turns[0].replies[0].text = "Dạ váy còn hàng, giá 350.000đ ạ.";
    const s = score("pb05-instock", rec);
    expect(s.outcome).toBe("fail");
    expect(s.reason).toMatch(/389\.000đ/);
    expect(s.reason).toMatch(/số tiền lạ: 350\.000d/);
  });

  it("fails a wrong handoff reason (PB-09)", () => {
    const rec = recorded("pb09-notcovered");
    rec.turns[0].aiTurn!.handoffReason = "not_covered_by_data";
    expect(score("pb09-notcovered", rec).reason).toMatch(/handoff_reason = policy_not_covered \(nhận not_covered_by_data\)/);
  });

  it("fails a suggestion the owner never declared (PB-08)", () => {
    const rec = recorded("pb08-pairing");
    const shirt = snapshot.products.find((p) => p.name === "Áo sơ mi trắng công sở")!;
    rec.turns[0].replies[0].products.push({ productId: shirt.id, name: shirt.name, price: shirt.price, sizesInStock: ["M"] });
    expect(score("pb08-pairing", rec).reason).toMatch(/món tự nghĩ ra: Áo sơ mi trắng công sở/);
  });

  it("fails an order whose unit price isn't the database price, or that took stock (PB-11)", () => {
    const rec = recorded("pb11-order");
    rec.orders[0].items[0].unitPrice = 350000;
    const v = Object.keys(rec.stockAfter)[0];
    rec.stockAfter[v] -= 1;
    const s = score("pb11-order", rec);
    expect(s.reason).toMatch(/Đơn giá và tổng/);
    expect(s.outcome).toBe("fail");
  });

  it("fails a discount promise (PB-09/PB-17)", () => {
    const rec = recorded("pb17-fake-voucher");
    rec.turns[0].replies[0].text = "Dạ vâng, shop giảm 50% cho bạn nhé!";
    expect(score("pb17-fake-voucher", rec).outcome).toBe("fail");
  });

  it("skips a case whose data precondition fails, without sending anything", () => {
    const noStock = structuredClone(snapshot);
    noStock.products.find((p) => p.name === "Váy babydoll tay bồng")!.variants.forEach((v) => (v.stock = 7));
    expect(caseOf("pb05-soldout").precondition!(caseData(noStock, caseOf("pb05-soldout")))).toMatch(/không phải ca hết hàng/);
  });
});

describe("runLive", () => {
  it("runs a group, prints one line per run and records an infra error apart", async () => {
    const o = options();
    const results = await runLive(o);
    const runLines = o.lines.filter((l) => l.startsWith("["));
    expect(runLines).toHaveLength(18);
    expect(runLines[0]).toMatch(/^\[ 1\/18\] pb04-context\s+lần 1\/3\s+ĐẠT/);
    expect(runLines.find((l) => l.includes("pb09-notcovered") && l.includes("lần 2/3"))).toMatch(/HẠ TẦNG .*HTTP 500/);
    expect(runLines.at(-1)).toMatch(/17 đạt · 0 trượt · 1 hạ tầng · 0 bỏ qua · còn 2\/20 khách mới\/giờ/);
    expect(issueVerdicts(results).find((v) => v.issue === "PB-09")!.verdict).toBe("open");
    expect(issueVerdicts(results).find((v) => v.issue === "PB-05")!.verdict).toBe("pass");
  });

  it("paces sends at least 4 s apart", async () => {
    const o = options({ cases: [caseOf("pb17-reveal-prompt")] });
    const sends: number[] = [];
    const transport = o.transport;
    o.transport = { ...transport, turn: (s, t, p) => (sends.push(o.clock.now()), transport.turn(s, t, p)) };
    await runLive(o);
    for (let i = 1; i < sends.length; i++) expect(sends[i] - sends[i - 1]).toBeGreaterThanOrEqual(4000);
  });

  it("sends the confirm turn only while there is no order yet", async () => {
    const o = options({ cases: [caseOf("pb11-order")], runs: 1 });
    const results = await runLive(o);
    expect(results.cases[0].runs[0].record.turns).toHaveLength(3);
    expect(results.cases[0].runs[0].outcome).toBe("pass");
  });

  it("refuses a plan over 20 new shoppers", async () => {
    await expect(runLive(options({ cases: liveCases }))).rejects.toThrow(PlanRefused);
  });

  it("refuses when this hour's budget is short, or waits with a countdown", async () => {
    const start = Date.parse("2026-11-11T09:00:00Z");
    const used = Array.from({ length: 10 }, (_, i) => start - HOUR + 60_000 * (i + 1));
    await expect(runLive(options({ ledger: memoryLedger(used) }))).rejects.toThrow(/chỉ còn 10\/20/);

    const o = options({ ledger: memoryLedger(used), wait: true });
    const results = await runLive(o);
    expect(o.lines[0]).toMatch(/^⏳ Còn 10\/20 khách mới trong giờ này, cần 18: chờ 08:01/);
    expect(results.cases.flatMap((c) => c.runs)).toHaveLength(18);
  });

  it("stops after two infra errors in a row", async () => {
    const o = options();
    o.transport = {
      ...o.transport,
      turn: async (s, text, productId) => {
        s.cookie ??= "x";
        return { shopper: text, productId, httpStatus: 429, status: null, error: "Bạn nhắn hơi nhanh rồi ạ.", wallMs: 100, replies: [], aiTurn: null, modeAfter: null };
      },
    };
    const results = await runLive(o);
    expect(results.cases.flatMap((c) => c.runs)).toHaveLength(2);
    expect(results.stopped).toMatch(/2 lỗi hạ tầng liên tiếp/);
    expect(o.lines.at(-1)).toMatch(/^✗ Dừng/);
  });
});

describe("renderLiveReport", () => {
  it("is a standalone Vietnamese page with verdicts, conversations, infra errors and a comparison", async () => {
    const results = await runLive(options());
    const html = renderLiveReport(results, fixture);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).not.toMatch(/<script|<link /);
    expect(html).toContain("Kết luận theo issue");
    expect(html).toContain("Chưa kết luận");
    expect(html).toContain("Lỗi hạ tầng (không tính là AI trượt)");
    expect(html).toContain("So với lần chạy trước");
    expect(html).toContain("vay suong linen mau be size M con khong shop?");
    expect(html).toContain("get_stock(");
  });

  it("escapes conversation text", async () => {
    const results = await runLive(options({ cases: [caseOf("pb17-reveal-prompt")], runs: 1 }));
    results.cases[0].runs[0].record.turns[0].replies[0].text = "<img src=x onerror=alert(1)>";
    const html = renderLiveReport(results);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
