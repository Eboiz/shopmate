---
name: testing-chat-pipeline
description: Use when testing the ShopMate AI chat end to end, before opening or merging a PR that touches src/lib/engine, src/lib/chat, src/lib/channels or the prompt, or when asked to re-run the production AI test ("kiểm thử AI", "test pipeline chat", pass rate by AC, latency, handoff reasons).
---

# Testing the chat pipeline

## Overview

Run the gates from free to paid, then replay labeled shopper conversations through the real web chat API and grade each turn from the reply **and** its `ai_turns` row. The replay tool and the labeled cases live next to this file.

## Ladder (stop at the first red step)

| # | Step | Command | Cost / writes |
|---|---|---|---|
| 1 | Static + unit | `pnpm lint && pnpm typecheck && pnpm test` | free |
| 2 | DB + integration | `pnpm db:start && pnpm db:reset && pnpm db:test && pnpm test:int` | free, local DB only (no `ANTHROPIC_API_KEY` in `.env.test.local` = no paid smoke) |
| 3 | Labeled eval | `EVAL_RUNS=3 pnpm engine:eval` (Jev: add `OPENROUTER_API_KEY=… JEV_IN_TESTS=true EVAL_LABEL=jev-router`) | **paid**, local DB |
| 4 | Replay | `node --env-file=<env of the target DB> .claude/skills/testing-chat-pipeline/replay.mjs --base <url> --runs 3 --label <name>` | **paid**, writes shoppers/conversations/`ai_turns` to the target DB |

Ask the developer before steps 3 and 4 and say what each costs (step 3: cases × runs turns; step 4: `cases.json` has 7 cases, 8 turns × runs).

## Choosing the replay target

- **Local:** `pnpm db:reset && pnpm db:seed`, then `pnpm dev`; `--base http://localhost:3000`, env `.env.local` pointing at local Supabase. No rate-limit wait (the tool sends a fresh `x-real-ip` per shopper, which only local dev trusts).
- **PR preview:** the Vercel preview URL of the branch (ask the developer), env of the database the preview uses.
- **Production** (`https://shopmate-beige.vercel.app`): only when the developer explicitly asks for a baseline of what is deployed. It runs the deployed code, not the branch, so the post-fix expectations in `cases.json` will fail where the fix is missing. It writes real rows in the shop's inbox and handoff cases switch conversations to `needs_human`.

Any target other than local allows 20 new shoppers per IP per hour (3 runs = 24): the tool stops at 20, counting the resumed file too, and prints the `--resume` command for the next hour.

The env must belong to the same database as `--base`: the tool prints the Supabase URL it reads; check its host with the developer before a paid run. A mismatch shows as `ai_turns row not found` on every turn. `--no-db` grades the reply only (no tools, handoff, PB-07 numbers). Test rows stay in the target database; delete them only if the developer asks.

## Reading the result

The tool prints a Markdown summary (pass per case, client and engine latency, handoff reasons, cases to read by hand) and saves everything to `replay-runs/<date>-<label>.json` (created on first run, gitignored). A `HARNESS ERROR` (429, missing product) is not a fail: fix and `--resume`. The 07/11 baseline in `cases.json` (16/19) ran the same 7 questions, 3 runs each except the first: compare per case, not the totals. `pnpm engine:eval` results go to `eval-runs/` when step 3 has run.

Every reply is also checked for English words, quick replies naming a garment the shop doesn't sell, and prices/stock not returned by a tool. Add a case by appending to `cases.json` (`turns[]` with `text`, `handoff`, `tools`, `replyIncludesAny`, `replyExcludesAny`, `cardsIncludeAny`, `questionMarks`; case-level `viewing`, `manual`).

## Report

1. Target URL, commit, prompt version, date, turns run.
2. Table: case · story/AC · pass/runs · failure causes.
3. Latency and handoff reasons vs baseline.
4. What was not run (skipped steps, `--no-db`, manual cases not read).
5. Ready / not ready, with the failing ACs.

If the developer keeps a `JOURNAL.md` (rules in `CLAUDE.local.md` of the main checkout, not of worktrees), add a `Kết quả` entry there: numbers only, no customer text.

## Common mistakes

- Replaying production to test a branch: production does not have the fix.
- Taking handoff reasons from the reply text or from `pnpm engine:metrics` (totals only); per-turn reasons are in the replay JSON from `ai_turns`.
- Reusing one cookie across runs: every run must be a new shopper, or PB-14/PB-17 state leaks between runs.
- Reporting "no regression" without a baseline run on `main`.
