// Writes the nightly E2E report (docs/e2e-reports/<date>.md) from Playwright JSON results.
// node write-report.mjs --date 2026-11-07 --suite results.json [--smoke smoke.json]
//   [--summary summary.md] [--agent ran|skipped|failed] --out docs/e2e-reports/2026-11-07.md
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    date: { type: "string" },
    suite: { type: "string" },
    smoke: { type: "string" },
    summary: { type: "string" },
    agent: { type: "string" },
    run: { type: "string" },
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

mkdirSync(dirname(a.out), { recursive: true });
writeFileSync(a.out, lines.join("\n"));
console.log(`wrote ${a.out}`);
