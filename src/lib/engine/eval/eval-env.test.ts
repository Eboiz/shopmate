import { describe, expect, it } from "vitest";
import { buildEvalEnv, buildPlanEnv, EVAL_DEFAULT_MODEL, isLocalSupabaseUrl, parseStatusEnv } from "./eval-env";

const PROD = "https://yhleogzpoonndbyphueu.supabase.co";
const status = parseStatusEnv(
  [
    "Stopped services: [supabase_imgproxy_shopmate]",
    'API_URL="http://127.0.0.1:54321"',
    'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    'PUBLISHABLE_KEY="sb_publishable_local"',
    'SECRET_KEY="sb_secret_local"',
  ].join("\n"),
);
// What the main checkout's .env.local looks like: production Supabase plus the key.
const envLocal = {
  NEXT_PUBLIC_SUPABASE_URL: PROD,
  SUPABASE_SECRET_KEY: "sb_secret_PRODUCTION",
  DATABASE_URL: "postgresql://prod",
  MESSENGER_PAGE_ACCESS_TOKEN: "EAAG-page-token",
  ANTHROPIC_API_KEY: "sk-ant-from-env-local",
  ANTHROPIC_API_URL: "https://gateway.example/v1/messages",
};

describe("eval:injection env (local Supabase only)", () => {
  it("accepts only 127.0.0.1 and localhost", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl(PROD)).toBe(false);
    expect(isLocalSupabaseUrl("http://127.0.0.1.evil.example")).toBe(false);
    expect(isLocalSupabaseUrl(undefined)).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });

  it("parses `supabase status -o env`, ignoring warnings", () => {
    expect(status.API_URL).toBe("http://127.0.0.1:54321");
    expect(status.SECRET_KEY).toBe("sb_secret_local");
    expect(Object.keys(status)).not.toContain("Stopped services: [supabase_imgproxy_shopmate]");
  });

  it("takes Supabase from the local stack even when .env.local and the shell point at production", () => {
    const env = buildEvalEnv({
      shell: { PATH: "/bin", NEXT_PUBLIC_SUPABASE_URL: PROD, SUPABASE_SECRET_KEY: "sb_secret_SHELL", EVAL_RUNS: "3" },
      files: [envLocal, {}],
      status,
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.SUPABASE_SECRET_KEY).toBe("sb_secret_local");
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_local");
    expect(env.DATABASE_URL).toContain("127.0.0.1");
    expect(JSON.stringify(env)).not.toContain("PRODUCTION");
    expect(JSON.stringify(env)).not.toContain(PROD);
    // Only the Anthropic variables come from the files.
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-from-env-local");
    expect(env.ANTHROPIC_API_URL).toBe(envLocal.ANTHROPIC_API_URL);
    expect(env.MESSENGER_PAGE_ACCESS_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.EVAL_RUNS).toBe("3");
  });

  it("refuses to run when the stack's URL is not local", () => {
    expect(() => buildEvalEnv({ shell: {}, files: [], status: { ...status, API_URL: PROD } })).toThrow(/Refusing to run/);
    expect(() => buildEvalEnv({ shell: {}, files: [], status: {} })).toThrow(/Refusing to run/);
    expect(() => buildEvalEnv({ shell: {}, files: [], status: { API_URL: "http://127.0.0.1:54321" } })).toThrow(/SECRET_KEY/);
  });

  it("--plan gets no Supabase variable at all", () => {
    const env = buildPlanEnv({ shell: { PATH: "/bin", NEXT_PUBLIC_SUPABASE_URL: PROD, DATABASE_URL: "postgresql://prod" }, files: [envLocal] });
    expect(Object.keys(env).filter((k) => /SUPABASE|DATABASE/.test(k))).toEqual([]);
    expect(env.ANTHROPIC_MODEL).toBe(EVAL_DEFAULT_MODEL);
  });

  it("model: shell first, then the later file, then Haiku (same as production)", () => {
    expect(buildEvalEnv({ shell: {}, files: [], status }).ANTHROPIC_MODEL).toBe(EVAL_DEFAULT_MODEL);
    expect(EVAL_DEFAULT_MODEL).toBe("claude-haiku-5-5");
    const files = [{ ANTHROPIC_MODEL: "from-env-local" }, { ANTHROPIC_MODEL: "from-env-test-local" }];
    expect(buildEvalEnv({ shell: {}, files, status }).ANTHROPIC_MODEL).toBe("from-env-test-local");
    expect(buildEvalEnv({ shell: { ANTHROPIC_MODEL: "from-shell" }, files, status }).ANTHROPIC_MODEL).toBe("from-shell");
  });
});
