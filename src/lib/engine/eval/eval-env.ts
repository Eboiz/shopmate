// The environment `pnpm eval:injection` (scripts/eval-injection.ts) runs the
// eval in. Pure and import-free, so the plain-node script can load it.
//
// Safety rule (07/11): the eval writes to the database (fixture shops, orders,
// ai_turns), so it must only ever see the LOCAL Supabase stack. `.env.local` points
// at the shared production project, so nothing Supabase-related is read from env
// files or the shell: URL and keys come from `supabase status` of the local stack,
// and the result is refused unless the URL is 127.0.0.1 / localhost. From the env
// files only the Anthropic variables are copied.

export const ANTHROPIC_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_API_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_BACKUP_API_KEY",
  "ANTHROPIC_BACKUP_API_URL",
] as const;
// Same model as production (ANTHROPIC_MODEL on Vercel), used when no file or shell sets one.
export const EVAL_DEFAULT_MODEL = "claude-haiku-5-5";
// The Jev router (jev.ts), as on production. Copied from the env files like the
// Anthropic ones; without OPENROUTER_API_KEY the engine falls back to the LLM loop.
export const JEV_VARS = ["OPENROUTER_API_KEY", "OPENROUTER_API_URL", "JEV_MODEL"] as const;

// The evals run like production unless the shell says otherwise: Haiku, and the
// Jev router on (it is off under vitest by default; JEV_IN_TESTS=false turns it off).
export function productionDefaults(
  shell: Record<string, string | undefined>,
  fromFiles: Record<string, string | undefined> = {},
): { ANTHROPIC_MODEL: string; JEV_IN_TESTS: string } {
  return {
    ANTHROPIC_MODEL: shell.ANTHROPIC_MODEL?.trim() || fromFiles.ANTHROPIC_MODEL?.trim() || EVAL_DEFAULT_MODEL,
    JEV_IN_TESTS: shell.JEV_IN_TESTS?.trim() || fromFiles.JEV_IN_TESTS?.trim() || "true",
  };
}
// Removed from the inherited shell env before the local values are set.
const SUPABASE_VAR = /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|DATABASE_URL$|POSTGRES)/;

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

// `supabase status -o env` prints KEY="value" lines (and warnings, ignored).
export function parseStatusEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export type EvalEnvInput = {
  // The shell's environment (process.env).
  shell: Record<string, string | undefined>;
  // Parsed env files, lowest priority first (.env.local, then .env.test.local).
  files: Record<string, string | undefined>[];
  // parseStatusEnv of the local stack.
  status: Record<string, string>;
};

// --plan: no database at all. The shell env without any Supabase variable, plus
// the Anthropic ones (for the model name in the plan).
export function buildPlanEnv({ shell, files }: Omit<EvalEnvInput, "status">): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(shell)) if (v !== undefined && !SUPABASE_VAR.test(k)) env[k] = v;
  for (const name of [...ANTHROPIC_VARS, ...JEV_VARS]) {
    const fromShell = shell[name]?.trim();
    const fromFiles = files.map((f) => f[name]?.trim()).filter(Boolean).at(-1);
    const value = fromShell || fromFiles;
    if (value) env[name] = value;
  }
  Object.assign(env, productionDefaults(shell, env));
  return env;
}

export function buildEvalEnv({ shell, files, status }: EvalEnvInput): Record<string, string> {
  const url = status.API_URL;
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(`Refusing to run: Supabase URL from \`supabase status\` is ${url ?? "missing"}, not 127.0.0.1/localhost.`);
  }
  const secret = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  const publishable = status.PUBLISHABLE_KEY || status.ANON_KEY;
  if (!secret || !publishable) throw new Error("`supabase status` printed no SECRET_KEY / PUBLISHABLE_KEY.");

  const env = buildPlanEnv({ shell, files });
  env.NEXT_PUBLIC_SUPABASE_URL = url!;
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishable;
  env.SUPABASE_SECRET_KEY = secret;
  if (status.DB_URL) env.DATABASE_URL = status.DB_URL;
  return env;
}
