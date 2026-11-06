# End-to-end tests (Playwright)

## Where they run

| Run | When | Against | Tests |
|---|---|---|---|
| `E2E nightly` / `local` | every day 02:00 Vietnam time, or by hand (Actions tab) | a throwaway Supabase with every migration and the demo shop seeded, `pnpm build && pnpm start` | all |
| `E2E nightly` / `production-smoke` | same time | `https://shopmate-beige.vercel.app` | only `@smoke` (read-only) |
| `E2E test agent` | after each nightly run | throwaway stack | writes new tests, opens a PR |

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

`.github/workflows/e2e-agent.yml` runs Claude Code headless with `.github/e2e-agent-prompt.md`. It needs the repository secret `ANTHROPIC_API_KEY`. It may only edit `e2e/`; anything else it touches is discarded. Its PR is opened with the workflow token, so GitHub does not start CI on it by itself: push any commit to the PR branch (or close and reopen it) to run CI before merging.
