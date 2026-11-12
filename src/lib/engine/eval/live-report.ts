// Standalone HTML report of a live acceptance run (Vietnamese, light and dark,
// phone width, no scripts). Same look as #53's injection report. Pure.
import { ISSUE_TITLES } from "./live-cases.ts";
import { issueVerdicts, modelsSeen, tallyCase, totals, type Verdict } from "./live-results.ts";
import { formatVnd } from "./live-score.ts";
import type { CaseResults, LiveResults, RunResult, TurnRecord } from "./live-types.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const tokens = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("vi-VN")} ${d.toLocaleTimeString("vi-VN")}`;
};

const VERDICT: Record<Verdict, { text: string; cls: string }> = {
  pass: { text: "Đạt", cls: "ok" },
  fail: { text: "Không đạt", cls: "bad" },
  open: { text: "Chưa kết luận", cls: "warn" },
};
const OUTCOME: Record<RunResult["outcome"], { text: string; cls: string }> = {
  pass: { text: "Đạt", cls: "ok" },
  fail: { text: "Trượt", cls: "bad" },
  infra: { text: "Lỗi hạ tầng", cls: "warn" },
  skip: { text: "Bỏ qua", cls: "warn" },
};
const SENDER: Record<string, string> = { ai: "Trợ lý AI", system: "Shop (hệ thống)", staff: "Nhân viên" };

function turnHtml(t: TurnRecord, i: number) {
  const calls = t.aiTurn?.toolCalls ?? [];
  return `<div class="turn">
<div class="msg shopper"><span class="who">Khách · lượt ${i + 1}</span>${esc(t.shopper)}</div>
${t.replies
  .map(
    (r) => `<div class="msg shop"><span class="who">${esc(SENDER[r.sender] ?? r.sender)}</span>${esc(r.text)}${
      r.products.length
        ? `<ul class="cards-mini">${r.products.map((p) => `<li>${esc(p.name)} · ${esc(formatVnd(p.price))}${p.sizesInStock.length ? ` · size ${esc(p.sizesInStock.join(", "))}` : ""}</li>`).join("")}</ul>`
        : ""
    }${r.quickReplies.length ? `<div class="muted">Gợi ý nhanh: ${esc(r.quickReplies.join(" | "))}</div>` : ""}</div>`,
  )
  .join("\n")}
${t.replies.length === 0 ? `<div class="msg shop muted">(không có tin trả lời)</div>` : ""}
<p class="muted">HTTP ${esc(t.httpStatus ?? "lỗi mạng")} · status ${esc(t.status ?? "–")}${t.error ? ` · lỗi: ${esc(t.error)}` : ""} · ${secs(t.wallMs)} · chuyển nhân viên: <b>${esc(t.aiTurn ? (t.aiTurn.handoffReason ?? "không") : "–")}</b> · mode sau lượt: ${esc(t.modeAfter ?? "–")}${t.aiTurn ? ` · ai_turn ${esc(t.aiTurn.latencyMs)} ms, ${esc(t.aiTurn.model ?? "?")}, prompt ${esc(t.aiTurn.promptVersion ?? "?")}, token ${tokens(t.aiTurn.inputTokens)}/${tokens(t.aiTurn.outputTokens)}` : " · không có ai_turns"}</p>
${calls.length ? `<pre>${esc(calls.map((c) => `${c.name}(${JSON.stringify(c.input)})${c.error ? ` -> lỗi ${c.error}` : ` -> ${JSON.stringify(c.output ?? null).slice(0, 400)}`}`).join("\n"))}</pre>` : `<p class="muted">Không gọi tool.</p>`}
</div>`;
}

function runHtml(r: RunResult) {
  const o = OUTCOME[r.outcome];
  return `<details${r.outcome === "fail" ? " open" : ""}><summary>Lần ${r.run}: <span class="pill ${o.cls}">${o.text}</span> <span class="muted">${secs(r.wallMs)} · ${esc(r.model ?? "–")} · prompt ${esc(r.promptVersion ?? "–")}</span></summary>
<p>${esc(r.reason)}</p>
${r.checks.length ? `<ul class="checks">${r.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✗"} ${esc(c.label)}${c.detail ? ` <span class="muted">– ${esc(c.detail)}</span>` : ""}</li>`).join("")}</ul>` : ""}
${r.record.orders.length ? `<p><b>Đơn trong DB:</b></p><pre>${esc(JSON.stringify(r.record.orders, null, 1))}</pre>` : ""}
${r.record.turns.map(turnHtml).join("\n")}
</details>`;
}

function caseHtml(c: CaseResults) {
  const t = tallyCase(c);
  return `<section class="case" id="${esc(c.id)}">
<h3>${esc(c.id)} <span class="muted">${esc(c.issue)}</span> <span class="pill ${t.fail ? "bad" : t.scored && t.pass === t.scored && !t.infra && !t.skip ? "ok" : "warn"}">${t.pass}/${t.scored} đạt</span></h3>
<p>${esc(c.title)}${c.viewing ? ` <span class="muted">(đang xem: ${esc(c.viewing)})</span>` : ""}</p>
${c.runs.map(runHtml).join("\n")}
</section>`;
}

function compareHtml(now: LiveResults, before: LiveResults) {
  const prev = new Map(before.cases.map((c) => [c.id, tallyCase(c)]));
  const rows = now.cases.map((c) => {
    const a = prev.get(c.id);
    const b = tallyCase(c);
    const rate = (x: { pass: number; scored: number }) => (x.scored ? x.pass / x.scored : null);
    const ra = a ? rate(a) : null;
    const rb = rate(b);
    const delta = ra === null || rb === null ? "–" : rb > ra ? "▲ tốt hơn" : rb < ra ? "▼ kém hơn" : "=";
    return `<tr><td>${esc(c.id)}</td><td class="num">${a ? `${a.pass}/${a.scored}` : "chưa có"}</td><td class="num">${b.pass}/${b.scored}</td><td>${delta}</td></tr>`;
  });
  const m = modelsSeen(before);
  return `<h2>So với lần chạy trước</h2>
<p class="muted">Lần trước: ${esc(when(before.startedAt))} · ${esc(before.base)} · shop ${esc(before.shop)} · model ${esc(m.models.join(", ") || "–")} · prompt ${esc(m.prompts.join(", ") || "–")}</p>
<div class="table-wrap"><table><thead><tr><th>Case</th><th class="num">Trước</th><th class="num">Nay</th><th>Thay đổi</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

export function renderLiveReport(results: LiveResults, previous: LiveResults | null = null): string {
  const s = totals(results);
  const verdicts = issueVerdicts(results);
  const m = modelsSeen(results);
  const infra = results.cases.flatMap((c) => c.runs.filter((r) => r.outcome === "infra"));
  const skipped = results.cases.flatMap((c) => c.runs.filter((r) => r.outcome === "skip"));
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kiểm thử AI production</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6862;--card:#fff;--line:#e4e1da;--ok:#1f7a4d;--okbg:#e3f3ea;--bad:#b42318;--badbg:#fde8e6;--mid:#9a6700;--midbg:#fdf3d7;--code:#f3f1ec;--accent:#3655b3;--bubble:#eef1fb}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141412;--fg:#ecebe6;--muted:#a19e96;--card:#1d1c1a;--line:#34322e;--ok:#5cc58f;--okbg:#14301f;--bad:#f2867a;--badbg:#3a1714;--mid:#e3b341;--midbg:#352a0c;--code:#262522;--accent:#8ea8ff;--bubble:#22283a}}
:root[data-theme="dark"]{--bg:#141412;--fg:#ecebe6;--muted:#a19e96;--card:#1d1c1a;--line:#34322e;--ok:#5cc58f;--okbg:#14301f;--bad:#f2867a;--badbg:#3a1714;--mid:#e3b341;--midbg:#352a0c;--code:#262522;--accent:#8ea8ff;--bubble:#22283a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.6rem;margin:0 0 4px}h2{margin:32px 0 12px;font-size:1.25rem}h3{font-size:1.05rem;margin:0 0 8px}
a{color:var(--accent)}
.muted{color:var(--muted);font-size:.9em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card b{display:block;font-size:1.5rem}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:480px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.85em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:.85em;font-weight:600;white-space:nowrap}
.pill.ok{background:var(--okbg);color:var(--ok)}.pill.bad{background:var(--badbg);color:var(--bad)}.pill.warn{background:var(--midbg);color:var(--mid)}
.case{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0}
pre{background:var(--code);padding:10px;border-radius:8px;white-space:pre-wrap;word-break:break-word;font-size:.85em;margin:6px 0}
details{border-top:1px solid var(--line);padding:8px 0}summary{cursor:pointer;font-weight:600}
.banner{background:var(--midbg);color:var(--mid);border-radius:10px;padding:10px 14px;margin:12px 0}
.turn{border-left:3px solid var(--line);padding:4px 0 4px 10px;margin:10px 0}
.msg{border-radius:10px;padding:8px 10px;margin:6px 0;white-space:pre-wrap;word-break:break-word}
.msg.shopper{background:var(--code)}.msg.shop{background:var(--bubble)}
.who{display:block;font-size:.8em;font-weight:600;color:var(--muted)}
.cards-mini{margin:6px 0 0;padding-left:18px;font-size:.9em}
.checks{list-style:none;padding:0;margin:6px 0}.checks li.ok{color:var(--ok)}.checks li.bad{color:var(--bad)}
</style>
</head>
<body><main>
<h1>Kiểm thử AI trên production – ShopMate</h1>
<p class="muted">Chạy lúc ${esc(when(results.startedAt))} · ${esc(results.base)} · shop <b>${esc(results.shop)}</b> · ${results.runsPerCase} lần mỗi case${results.group !== null ? ` · nhóm ${results.group}` : ""}${results.filters.issue ? ` · lọc ${esc(results.filters.issue)}` : ""}${results.filters.case ? ` · case ${esc(results.filters.case)}` : ""} · model ${esc(m.models.join(", ") || "–")} · prompt ${esc(m.prompts.join(", ") || "–")}</p>
${results.fake ? `<div class="banner">Chạy thử <b>--fake</b>: phát lại một bản ghi có sẵn, không gọi production hay Claude. Kết quả không nói gì về AI thật.</div>` : ""}
${results.stopped ? `<div class="banner"><b>Dừng sớm.</b> ${esc(results.stopped)}</div>` : ""}
<div class="cards">
<div class="card"><span class="muted">Lượt đạt</span><b>${s.pass}/${s.pass + s.fail}</b></div>
<div class="card"><span class="muted">Lượt trượt</span><b>${s.fail}</b></div>
<div class="card"><span class="muted">Lỗi hạ tầng</span><b>${s.infra}</b></div>
<div class="card"><span class="muted">Bỏ qua (dữ liệu)</span><b>${s.skip}</b></div>
<div class="card"><span class="muted">Token (ai_turns)</span><b>${tokens(s.tokens)}</b></div>
</div>
<h2>Kết luận theo issue</h2>
<div class="table-wrap"><table><thead><tr><th>Issue</th><th class="num">Case</th><th class="num">Lượt đạt</th><th class="num">Hạ tầng</th><th class="num">Bỏ qua</th><th>Kết luận</th></tr></thead><tbody>
${verdicts.map((v) => `<tr><td><b>${esc(v.issue)}</b> <span class="muted">${esc(ISSUE_TITLES[v.issue])}</span></td><td class="num">${v.cases}</td><td class="num">${v.pass}/${v.scored}</td><td class="num">${v.infra}</td><td class="num">${v.skip}</td><td><span class="pill ${VERDICT[v.verdict].cls}">${VERDICT[v.verdict].text}</span></td></tr>`).join("\n")}
</tbody></table></div>
<p class="muted">Đạt: mọi case của issue chạy đủ ${results.runsPerCase} lần và đều đạt. Lỗi hạ tầng (HTTP 429/5xx, engine lỗi) và case bỏ qua không tính là trượt nhưng làm issue “chưa kết luận”.</p>
<h2>Theo case</h2>
<div class="table-wrap"><table><thead><tr><th>Case</th><th>Issue</th><th class="num">Đạt</th><th class="num">Hạ tầng</th><th class="num">TB thời gian</th></tr></thead><tbody>
${results.cases.map((c) => {
  const t = tallyCase(c);
  return `<tr><td><a href="#${esc(c.id)}">${esc(c.id)}</a><div class="muted">${esc(c.title)}</div></td><td>${esc(c.issue)}</td><td class="num"><span class="pill ${t.fail ? "bad" : t.scored && t.pass === t.scored ? "ok" : "warn"}">${t.pass}/${t.scored}</span></td><td class="num">${t.infra}</td><td class="num">${t.wallMsAvg ? secs(t.wallMsAvg) : "–"}</td></tr>`;
}).join("\n")}
</tbody></table></div>
${previous ? compareHtml(results, previous) : ""}
${infra.length ? `<h2>Lỗi hạ tầng (không tính là AI trượt)</h2><ul>${infra.map((r) => `<li><a href="#${esc(r.caseId)}">${esc(r.caseId)}</a> lần ${r.run}: ${esc(r.reason)}</li>`).join("")}</ul>` : ""}
${skipped.length ? `<h2>Bỏ qua vì dữ liệu shop</h2><ul>${[...new Map(skipped.map((r) => [r.caseId, r])).values()].map((r) => `<li>${esc(r.caseId)}: ${esc(r.reason)}</li>`).join("")}</ul>` : ""}
<h2>Từng cuộc trò chuyện</h2>
${results.cases.map(caseHtml).join("\n")}
</main></body></html>
`;
}
