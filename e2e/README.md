# End-to-end tests (Playwright)

## Where they run

| Run | When | Against | Tests |
|---|---|---|---|
| `E2E nightly` / `local` | every day 02:00 Vietnam time, or by hand (Actions tab) | a throwaway Supabase with every migration and the demo shop seeded, `pnpm build && pnpm start` | all |
| `E2E nightly` / `production-smoke` | same time | `https://shopmate-beige.vercel.app` | only `@smoke` (read-only) |
| `E2E nightly` / `agent` | same time, only if `src/` or `supabase/` changed in the last 24 hours | throwaway stack | plans and writes new tests |
| `E2E nightly` / `report` | after the jobs above | — | writes `docs/e2e-reports/<date>.md`, opens a PR with it and the new tests; never merges |

CI on every PR runs unit tests (`pnpm test`) and database tests (`pnpm db:test`), not these.

## Run them on a laptop

```bash
pnpm db:start && pnpm db:seed           # local Supabase with the demo shop
pnpm exec playwright install chromium   # once
# Point the app and the tests at local Supabase (values from `supabase status -o env`):
export E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_SECRET_KEY=<local SECRET_KEY>
export NEXT_PUBLIC_SUPABASE_URL=$E2E_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local PUBLISHABLE_KEY> SUPABASE_SECRET_KEY=$E2E_SUPABASE_SECRET_KEY
# plus the DEMO_*, META_*, MESSENGER_PAGE_*, TELEGRAM_* values you seeded with
pnpm test:e2e
```

Never set `E2E_SUPABASE_*` to the team's shared project: these tests write conversations.

## Conventions

- One spec file per feature; inside it, happy path first, then edge cases, then worst cases.
- A test that writes data starts with `test.skip(!db, NEEDS_DB)`. A test that is safe on production is read-only and has `@smoke` in its title.
- Unique ids per test (`uid()`, `fakeChatId()`); webhooks answer before they work, so wait with `waitForConversation()`, and use `settle()` before asserting that nothing was stored.
- No real Claude, Meta or Telegram calls, no secrets, no hard-coded shop ids.
- Features not on `main` yet are listed as `test.fixme` in `backlog.spec.ts`; turn them into real tests when the story merges.

## The test agent

The `agent` job of `.github/workflows/e2e-nightly.yml` uses Playwright's own test agents (`playwright init-agents --loop=claude`) with Claude Code, through the team's Anthropic-compatible gateway:

1. **Plan, Claude Opus** (`.github/e2e-agent/plan.md`): reads the last 24 hours of `src/` and `supabase/` changes, the acceptance criteria of the backlog items they name (PB-xx), and the existing tests; writes at most 10 cases (happy, edge, worst) to `e2e/plans/<date>.md`. No browser, no shell.
2. **Write and heal, Claude Sonnet** (`.github/e2e-agent/generate.md`): the generator and healer subagents write the tests against the running throwaway app and fix test-side failures. A real app bug stays as `test.fail()` with a comment; assertions are never loosened.
3. The whole suite runs again without the key; the `report` job writes `docs/e2e-reports/<date>.md` and opens a PR. A person reviews and merges it in the morning.

Secrets: `ANTHROPIC_API_KEY` (gateway key, with a spending limit) and `DOCUMENTS_READ_TOKEN` (fine-grained, Issues: Read on `Eboiz/Documents`). Safeguards: the agent has no shell, reads only the workspace and writes only `e2e/`; the MCP server that runs the app and the tests starts without the key; the patch and results are scanned for the key before leaving the job; the job that opens the PR has the only write token and applies changes under `e2e/` only. The PR is opened by the workflow token, so GitHub does not start CI on it by itself: push any commit to the branch (or close and reopen it) to run CI before merging.
