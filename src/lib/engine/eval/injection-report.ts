// PB-17: a standalone HTML report of one injection eval run (Vietnamese, light and
// dark, phone width, no scripts). Pure, type imports only (see injection-results.ts).
import { CHECK_LABELS, summarize, weaknesses, type InjectionResults, type SavedCase, type Tally } from "./injection-results.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((n / d) * 100)}%`);
const SEVERITY: Record<string, string> = { critical: "Nghiêm trọng", medium: "Trung bình", low: "Thấp" };
const handoffLabel = (h: string | null) => h ?? "không chuyển";
const SOURCE: Record<InjectionResults["modelSource"], string> = {
  real: "Claude thật",
  "fake-refuse": "model giả (luôn từ chối) – chạy thử, không phải kết quả thật",
  "fake-comply": "model giả (luôn làm theo) – chạy thử, không phải kết quả thật",
  "fake-mixed": "model giả (nửa từ chối, nửa làm theo) – chạy thử, không phải kết quả thật",
};

function tallyRow(label: string, t: Tally, badge = "") {
  const ok = t.casesPassed === t.cases;
  return `<tr><td>${badge}${esc(label)}</td><td class="num">${t.casesPassed}/${t.cases}</td><td class="num">${pct(t.casesPassed, t.cases)}</td><td class="num">${t.runsPassed}/${t.runs}</td><td class="num"><span class="pill ${ok ? "ok" : "bad"}">${pct(t.runsPassed, t.runs)}</span></td></tr>`;
}

function caseRow(c: SavedCase) {
  return `<tr><td><a href="#${esc(c.id)}">${esc(c.id)}</a><div class="muted">${esc(c.description)}</div></td><td>${esc(c.categoryLabel)}</td><td><span class="sev ${c.severity}">${SEVERITY[c.severity]}</span></td><td class="num">${c.passes}/${c.runs.length}</td><td><span class="pill ${c.passed ? "ok" : "bad"}">${c.passed ? "Đạt" : "Không đạt"}</span></td></tr>`;
}

function failingRuns(c: SavedCase) {
  const failed = c.runs.map((r, i) => ({ r, i })).filter(({ r }) => !r.passed);
  if (failed.length === 0) return "";
  return `<section class="case" id="${esc(c.id)}">
<h3>${esc(c.id)} <span class="sev ${c.severity}">${SEVERITY[c.severity]}</span> <span class="pill ${c.passed ? "ok" : "bad"}">${c.passes}/${c.runs.length} lần đạt</span></h3>
<p>${esc(c.description)}</p>
<p class="muted">Tin cuối của khách (${c.turns} tin trong lịch sử): </p><pre>${esc(c.lastMessage)}</pre>
<p class="muted">Cho phép: ${esc(c.allowedHandoffs.map(handoffLabel).join(", "))}</p>
${failed
  .map(
    ({ r, i }) => `<details><summary>Lần ${i + 1}: ${esc(r.failures.map((f) => CHECK_LABELS[f.check]).join("; "))}</summary>
<ul>${r.failures.map((f) => `<li><b>${esc(CHECK_LABELS[f.check])}</b>: ${esc(f.detail)}</li>`).join("")}</ul>
<p><b>Trả lời:</b></p><pre>${esc(r.replyText)}</pre>
${r.quickReplies.length ? `<p><b>Gợi ý nhanh:</b> ${esc(r.quickReplies.join(" | "))}</p>` : ""}
<p><b>Chuyển nhân viên:</b> ${esc(handoffLabel(r.handoffReason))} · <b>mode sau lượt:</b> ${esc(r.modeAfter ?? "–")}</p>
<p><b>Tool đã gọi:</b></p><pre>${esc(r.calls.length ? r.calls.map((t) => `${t.name}(${JSON.stringify(t.input)})${t.error ? ` -> lỗi ${t.error}` : ` -> ${JSON.stringify(t.output ?? null).slice(0, 400)}`}`).join("\n") : "(không gọi tool)")}</pre>
</details>`,
  )
  .join("\n")}
</section>`;
}

export function renderInjectionReport(results: InjectionResults): string {
  const s = summarize(results);
  const ws = weaknesses(results);
  const failedCases = results.cases.filter((c) => !c.passed);
  const date = new Date(results.at);
  const when = `${date.toLocaleDateString("vi-VN")} ${date.toLocaleTimeString("vi-VN")}`;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo prompt injection</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6862;--card:#fff;--line:#e4e1da;--ok:#1f7a4d;--okbg:#e3f3ea;--bad:#b42318;--badbg:#fde8e6;--mid:#9a6700;--midbg:#fdf3d7;--code:#f3f1ec;--accent:#3655b3}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141412;--fg:#ecebe6;--muted:#a19e96;--card:#1d1c1a;--line:#34322e;--ok:#5cc58f;--okbg:#14301f;--bad:#f2867a;--badbg:#3a1714;--mid:#e3b341;--midbg:#352a0c;--code:#262522;--accent:#8ea8ff}}
:root[data-theme="dark"]{--bg:#141412;--fg:#ecebe6;--muted:#a19e96;--card:#1d1c1a;--line:#34322e;--ok:#5cc58f;--okbg:#14301f;--bad:#f2867a;--badbg:#3a1714;--mid:#e3b341;--midbg:#352a0c;--code:#262522;--accent:#8ea8ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.6rem;margin:0 0 4px}h2{margin:32px 0 12px;font-size:1.25rem}h3{font-size:1.05rem;margin:0 0 8px}
a{color:var(--accent)}
.muted{color:var(--muted);font-size:.9em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card b{display:block;font-size:1.5rem}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:520px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.85em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:.85em;font-weight:600;white-space:nowrap}
.pill.ok{background:var(--okbg);color:var(--ok)}.pill.bad{background:var(--badbg);color:var(--bad)}
.sev{display:inline-block;padding:1px 7px;border-radius:6px;font-size:.8em;font-weight:600;white-space:nowrap}
.sev.critical{background:var(--badbg);color:var(--bad)}.sev.medium{background:var(--midbg);color:var(--mid)}.sev.low{background:var(--code);color:var(--muted)}
.case,.weak{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0}
pre{background:var(--code);padding:10px;border-radius:8px;white-space:pre-wrap;word-break:break-word;font-size:.85em;margin:6px 0}
details{border-top:1px solid var(--line);padding:8px 0}summary{cursor:pointer;font-weight:600}
.banner{background:var(--midbg);color:var(--mid);border-radius:10px;padding:10px 14px;margin:12px 0}
</style>
</head>
<body><main>
<h1>Báo cáo prompt injection – ShopMate (PB-17)</h1>
<p class="muted">Chạy lúc ${esc(when)} · prompt ${esc(results.promptVersion)} · model <b>${esc(results.model)}</b> (${esc(SOURCE[results.modelSource])}) · ${results.runsPerCase} lần mỗi câu · đạt khi ≥ ${Math.round(results.passShare * 100)}% số lần · ${Math.round(results.durationMs / 60000)} phút</p>
${results.modelSource !== "real" ? `<div class="banner">Đây là lần chạy thử với model giả để kiểm tra bộ chấm và báo cáo. Kết quả không nói gì về Claude.</div>` : ""}
${results.filters.cases || results.filters.categories || results.filters.severities ? `<p class="muted">Lọc: ${esc(JSON.stringify(results.filters))}</p>` : ""}
<div class="cards">
<div class="card"><span class="muted">Câu đạt</span><b>${s.total.casesPassed}/${s.total.cases}</b></div>
<div class="card"><span class="muted">Lượt đạt</span><b>${pct(s.total.runsPassed, s.total.runs)}</b><span class="muted">${s.total.runsPassed}/${s.total.runs}</span></div>
<div class="card"><span class="muted">Câu nghiêm trọng không đạt</span><b>${failedCases.filter((c) => c.severity === "critical").length}</b></div>
<div class="card"><span class="muted">Lần gọi model</span><b>${s.modelCalls}</b></div>
<div class="card"><span class="muted">Giá/tồn kho/chính sách trong DB bị đổi</span><b>${results.integrity.length}</b></div>
</div>

<h2>Theo mức độ</h2>
<div class="table-wrap"><table><thead><tr><th>Mức độ</th><th class="num">Câu đạt</th><th class="num">%</th><th class="num">Lượt đạt</th><th class="num">% lượt</th></tr></thead><tbody>
${s.bySeverity.filter((x) => x.cases > 0).map((x) => tallyRow(SEVERITY[x.key], x, "")).join("\n")}
</tbody></table></div>

<h2>Theo nhóm tấn công</h2>
<div class="table-wrap"><table><thead><tr><th>Nhóm</th><th class="num">Câu đạt</th><th class="num">%</th><th class="num">Lượt đạt</th><th class="num">% lượt</th></tr></thead><tbody>
${s.byCategory.map((x) => tallyRow(x.label, x)).join("\n")}
</tbody></table></div>

<h2>Điểm yếu tìm thấy và cách sửa</h2>
${ws.length === 0 ? "<p>Không lượt nào trượt kiểm tra nào.</p>" : ws
  .map(
    (w) => `<div class="weak"><h3>${esc(CHECK_LABELS[w.check])} <span class="muted">(${w.runs} lượt trượt, ${w.cases.length} câu)</span></h3>
<p class="muted">Câu: ${w.cases.map((c) => `<a href="#${esc(c.id)}">${esc(c.id)}</a> <span class="sev ${c.severity}">${SEVERITY[c.severity]}</span> ${c.failedRuns} lượt`).join(" · ")}</p>
<p><b>Ví dụ:</b></p><pre>${esc(w.example)}</pre>
<p><b>Đề xuất sửa:</b> ${esc(w.fix)}</p></div>`,
  )
  .join("\n")}
<h3>Số lượt trượt theo loại kiểm tra</h3>
<div class="table-wrap"><table><thead><tr><th>Kiểm tra</th><th class="num">Lượt trượt</th></tr></thead><tbody>
${s.checkCounts.length ? s.checkCounts.map(([c, n]) => `<tr><td>${esc(CHECK_LABELS[c])}</td><td class="num">${n}</td></tr>`).join("") : `<tr><td colspan="2">Không có</td></tr>`}
</tbody></table></div>
${results.integrity.length ? `<h3>Dữ liệu trong DB bị đổi trong lúc chạy</h3><pre>${esc(results.integrity.map((d) => `${d.table} ${d.id}: ${d.before} -> ${d.after}`).join("\n"))}</pre>` : ""}

<h2>Kết quả từng câu</h2>
<div class="table-wrap"><table><thead><tr><th>Câu</th><th>Nhóm</th><th>Mức độ</th><th class="num">Lần đạt</th><th>Kết quả</th></tr></thead><tbody>
${results.cases.map(caseRow).join("\n")}
</tbody></table></div>

<h2>Các lượt trượt (nguyên văn)</h2>
${results.cases.some((c) => c.runs.some((r) => !r.passed)) ? results.cases.map(failingRuns).join("\n") : "<p>Không có lượt nào trượt.</p>"}
</main></body></html>
`;
}
