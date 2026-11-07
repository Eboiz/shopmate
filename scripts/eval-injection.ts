// PB-17 prompt-injection eval with real Claude on the LOCAL Supabase stack.
//
//   pnpm eval:injection                         all cases, EVAL_RUNS=10
//   EVAL_RUNS=3 pnpm eval:injection             fewer runs
//   EVAL_CATEGORY=leak,owner pnpm eval:injection
//   EVAL_CASE=pb17-override-dan pnpm eval:injection
//   EVAL_FAKE_MODEL=refuse pnpm eval:injection  dry run, no Claude call
//   pnpm eval:injection --out "D:\report.html"  where the HTML report goes
//   pnpm eval:injection --report-only eval-runs/<file>.json [--out <html>]
//
// The key: ANTHROPIC_API_KEY / ANTHROPIC_API_URL / ANTHROPIC_MODEL from the shell,
// else .env.test.local, else .env.local (only these three are read from the files).
// Model: claude-haiku-5-5 when none is set (same as production).
// Supabase: ALWAYS the local stack from `supabase status` (see eval-env.ts); the run
// stops unless that is 127.0.0.1/localhost.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { buildEvalEnv, parseStatusEnv } from "../src/lib/engine/eval/eval-env.ts";
import { renderInjectionReport } from "../src/lib/engine/eval/injection-report.ts";
import { assertLocalDb } from "../src/lib/engine/test/two-shops.ts";

const root = path.resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({ options: { out: { type: "string" }, "report-only": { type: "string" } } });

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const today = new Date();
const dd = String(today.getDate()).padStart(2, "0");
const mm = String(today.getMonth() + 1).padStart(2, "0");
// Next to the shopmate folder: C:\Bach_Khoa\Final_Year\CNPMNC\Bao cao prompt injection dd-mm.html
const htmlOut = path.resolve(args.out ?? path.join(root, "..", `Bao cao prompt injection ${dd}-${mm}.html`));

if (args["report-only"]) {
  const results = JSON.parse(readFileSync(args["report-only"], "utf8"));
  writeFileSync(htmlOut, renderInjectionReport(results));
  console.info(`báo cáo: ${htmlOut}`);
  process.exit(0);
}

const readEnvFile = (name: string) => {
  const file = path.join(root, name);
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
};

// 1. The local stack, never anything from .env files.
// The project's own CLI (devDependency). A .CMD shim on Windows needs a shell; the
// command line is fixed, nothing from the user goes into it.
const supabaseBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "supabase.CMD" : "supabase");
const status = spawnSync(`"${existsSync(supabaseBin) ? supabaseBin : "supabase"}" status -o env`, { cwd: root, encoding: "utf8", shell: true });
if (status.status !== 0) {
  fail(`Local Supabase chưa chạy (supabase status lỗi).\n  Chạy: pnpm db:start   (Docker Desktop phải đang mở)\n${(status.stderr || status.stdout || String(status.error ?? "")).trim()}`);
}
let env: Record<string, string>;
try {
  env = buildEvalEnv({ shell: process.env, files: [readEnvFile(".env.local"), readEnvFile(".env.test.local")], status: parseStatusEnv(status.stdout) });
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
// 2. The fixture's own guard, on exactly the env the eval will get.
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL });
assertLocalDb();

const fake = env.EVAL_FAKE_MODEL?.trim();
if (!fake && !env.ANTHROPIC_API_KEY) {
  fail("Thiếu ANTHROPIC_API_KEY (đặt trong .env.local hoặc .env.test.local, hoặc export trong shell). Chạy thử không cần key: EVAL_FAKE_MODEL=refuse pnpm eval:injection");
}

const runs = env.EVAL_RUNS ?? "10";
console.info(
  `Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL} (local) · model: ${fake ? `fake-${fake}` : env.ANTHROPIC_MODEL}${env.ANTHROPIC_API_URL ? ` qua ${env.ANTHROPIC_API_URL}` : ""} · EVAL_RUNS=${runs} · báo cáo: ${htmlOut}`,
);

// 3. The eval itself; progress lines stream straight to this terminal.
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const child = spawn(
  process.execPath,
  [vitest, "run", "--config", "vitest.eval.config.ts", "src/lib/engine/eval/injection.eval.ts", "--disableConsoleIntercept", "--reporter=dot"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...env,
      EVAL_SUITE: "injection",
      EVAL_ENV_FROM_RUNNER: "1",
      EVAL_RUNS: runs,
      EVAL_REPORT_HTML: htmlOut,
    } as unknown as NodeJS.ProcessEnv,
  },
);
child.on("exit", (code: number | null) => process.exit(code ?? 1));
