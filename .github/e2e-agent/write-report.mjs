// Writes the nightly E2E report (docs/e2e-reports/<date>.md) from Playwright JSON results.
// node write-report.mjs --date 2026-11-07 --suite results.json [--smoke smoke.json]
//   [--summary summary.md] [--agent ran|skipped|failed]
//   [--ai ran|skipped|failed] [--injection injection.json] [--main-flow main-flow.json]
//   --out docs/e2e-reports/2026-11-07.md
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
// Only type imports in that file, so plain node loads it without the app's dependencies.
import { CHECK_LABELS } from "../../src/lib/engine/eval/injection-results.ts";

const { values: a } = parseArgs({
  options: {
    date: { type: "string" },
    suite: { type: "string" },
    smoke: { type: "string" },
    summary: { type: "string" },
    agent: { type: "string" },
    run: { type: "string" },
    ai: { type: "string" },
    injection: { type: "string" },
    "main-flow": { type: "string" },
    out: { type: "string" },
  },
});

// Inputs come from another job: read regular files only, never symlinks.
const regular = (path) => Boolean(path) && existsSync(path) && lstatSync(path).isFile();
const readJson = (path) => {
  if (!regular(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const readText = (path) => (regular(path) ? readFileSync(path, "utf8").trim().slice(0, 20_000) : "");

// Flatten Playwright's nested suites into one row per test.
function rows(report) {
  const out = [];
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.at(-1);
        const status =
          t.status === "skipped" ? (t.annotations?.some((x) => x.type === "fixme") ? "fixme" : "skipped")
          : t.status === "flaky" ? "flaky"
          : t.status === "expected" ? "passed"
          : "failed";
        const error = (last?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim()) ?? "";
        out.push({ file: spec.file ?? file, title: spec.title, status, error: error.slice(0, 200) });
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.file ?? file);
  };
  for (const s of report?.suites ?? []) walk(s, s.file);
  return out;
}

const count = (list, status) => list.filter((r) => r.status === status).length;
const statuses = ["passed", "failed", "flaky", "skipped", "fixme"];

function section(title, report) {
  if (!report) return [`## ${title}`, "", "Không có kết quả (job không chạy hoặc lỗi trước khi chạy test).", ""];
  const list = rows(report);
  const files = [...new Set(list.map((r) => r.file))].sort();
  const lines = [
    `## ${title}`,
    "",
    `**${count(list, "passed")} pass · ${count(list, "failed")} hỏng · ${count(list, "flaky")} chập chờn · ${count(list, "skipped")} bỏ qua · ${count(list, "fixme")} chờ tính năng**`,
    "",
    "| File | " + statuses.join(" | ") + " |",
    "|---|" + statuses.map(() => "---:").join("|") + "|",
    ...files.map((f) => `| \`${f}\` | ` + statuses.map((s) => count(list.filter((r) => r.file === f), s)).join(" | ") + " |"),
    "",
  ];
  const bad = list.filter((r) => r.status === "failed" || r.status === "flaky");
  if (bad.length) {
    lines.push("**Test hỏng hoặc chập chờn:**", "");
    for (const r of bad) lines.push(`- ${r.status === "failed" ? "❌" : "⚠️"} \`${r.file}\` › ${r.title}${r.error ? ` — ${r.error}` : ""}`);
    lines.push("");
  }
  return lines;
}

const agentLine = {
  ran: "Có code mới trong 24 giờ qua: agent đã lên kế hoạch (Opus) và viết test (Sonnet). Test mới nằm trong PR này.",
  skipped: "Không có code mới trong 24 giờ qua: agent không chạy.",
  failed: "Agent chạy lỗi giữa chừng: xem log workflow.",
}[a.agent ?? "skipped"];

const lines = [
  `# Báo cáo E2E ${a.date}`,
  "",
  `Chạy lúc 02:00 (giờ Việt Nam).${a.run ? ` Log: ${a.run}` : ""}`,
  "",
  ...section("Toàn bộ test trên stack tạm", readJson(a.suite)),
  ...section("Smoke trên production (chỉ đọc)", readJson(a.smoke)),
  "## Agent sinh test",
  "",
  agentLine,
  "",
];
const summary = readText(a.summary);
if (summary) lines.push("### Agent đã làm", "", summary, "");

const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
// Ids and check names only: replies are model text and stay in the artifact.
const safe = (v) => String(v ?? "").replace(/[^\p{L}\p{N} ._:/-]/gu, "").slice(0, 80);

// The PB-17 injection eval (critical cases), from the ai job's injection.json.
function injection(results) {
  const title = ["### Prompt injection (câu critical)", ""];
  if (!Array.isArray(results?.cases)) return [...title, "Không có kết quả (eval lỗi trước khi ghi kết quả).", ""];
  const cases = results.cases;
  const passed = cases.filter((c) => c.status === "passed").length;
  const failed = cases.filter((c) => c.status === "failed");
  const notRun = cases.reduce((s, c) => s + (Number(c.notRun) || 0), 0);
  const t = results.tokens ?? {};
  const tokens = ["input", "output", "cacheCreation", "cacheRead"].reduce((s, k) => s + (Number(t[k]) || 0), 0);
  const out = [
    ...title,
    `**${passed}/${cases.length} câu đạt · ${failed.length} không đạt · ${notRun} lượt chưa chạy** · model \`${safe(results.model)}\` · prompt \`${safe(results.promptVersion)}\` · ${fmtTokens(tokens)}/${fmtTokens(Number(results.maxTokens) || 0)} token`,
    "",
  ];
  // Production decides most turns with the Jev router; 0 router runs means the
  // OPENROUTER_API_KEY secret is missing or Jev failed, so the night tested the LLM loop only.
  const runs = cases.flatMap((c) => c.runs ?? []);
  const routes = runs.filter((r) => r.route !== undefined);
  if (routes.length) {
    const viaJev = routes.filter((r) => r.route === "router").length;
    out.push(`Đường xử lý: router Jev ${viaJev} lượt · vòng LLM ${routes.length - viaJev} lượt.`, "");
    if (viaJev === 0) out.push("⚠️ Không lượt nào qua router Jev như production: kiểm tra secret `OPENROUTER_API_KEY`.", "");
  }
  if (results.stopped) {
    out.push(`⚠️ Dừng giữa chừng: ${results.stopped.reason === "quota" ? "gateway trả 429 (hết quota)" : "chạm ngân sách token"}.`, "");
  }
  if (results.integrity?.length) out.push(`❌ DB bị đổi sau khi chạy: ${results.integrity.length} dòng (giá, tồn kho hoặc chính sách).`, "");
  if (failed.length) {
    out.push("**Câu không đạt:**", "");
    for (const c of failed) {
      const checks = [...new Set((c.runs ?? []).flatMap((r) => (r.failures ?? []).map((f) => f.check)))];
      out.push(`- ❌ \`${safe(c.id)}\` — ${checks.map((k) => CHECK_LABELS[k] ?? safe(k)).join(", ")}`);
    }
    out.push("");
  }
  out.push("Từng câu trả lời: báo cáo HTML trong artifact `e2e-ai` của lần chạy.", "");
  return out;
}

lines.push("## AI thật (chỉ khi engine đổi)", "");
if (a.ai === "ran" || a.ai === "failed") {
  if (a.ai === "failed") lines.push("Job AI lỗi giữa chừng: xem log workflow.", "");
  lines.push(...injection(readJson(a.injection)));
  lines.push(...section("Luồng chính: hỏi size → đơn nháp → nhân viên xác nhận", readJson(a["main-flow"])).map((l) => l.replace(/^## /, "### ")));
} else {
  lines.push("Không có thay đổi trong `src/lib/engine/` hay `src/contract/` 24 giờ qua: không gọi Claude.", "");
}

mkdirSync(dirname(a.out), { recursive: true });
writeFileSync(a.out, lines.join("\n"));
console.log(`wrote ${a.out}`);
