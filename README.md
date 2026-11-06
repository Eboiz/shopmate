# ShopMate

AI sales assistant for small Vietnamese fashion shops. Next.js (App Router) + TypeScript, Supabase, Claude API, deployed on Vercel.

Backlog and specs: [Eboiz/Documents](https://github.com/Eboiz/Documents) · [Project board](https://github.com/orgs/Eboiz/projects/2).

## Setup

Requires Node 24 and pnpm (`corepack enable`).

```bash
pnpm install
cp .env.example .env.local   # fill in the Supabase URL and publishable key
pnpm dev                     # http://localhost:3000
```

There is no sign-up page. `pnpm db:seed` creates the demo owner and staff accounts (see [Demo shop](#demo-shop-pb-02)); other staff accounts are created in Supabase Dashboard > Authentication > Users.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate route types, then `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest, `src/**/*.test.ts`) |
| `pnpm test:int` | Integration tests (`src/**/*.int.test.ts`) against local Supabase. Needs `pnpm db:start` and a `.env.test.local` with the local `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` printed by `db:start` (all three: the admin client checks both public values too). Refuses to run unless the URL is `127.0.0.1` or `localhost`, because the fixture deletes and recreates its shops |
| `pnpm test:e2e` | End-to-end tests (Playwright, `e2e/`). Run `pnpm exec playwright install chromium` once. Set `E2E_BASE_URL` to test a preview deployment |
| `pnpm db:start` / `pnpm db:stop` | Local Supabase in Docker (prints local URL and keys) |
| `pnpm db:reset` | Recreate the local database from `supabase/migrations/` |
| `pnpm db:test` | Database tests (pgTAP, `supabase/tests/`): constraints and Row Level Security |
| `pnpm db:types` | Regenerate `src/contract/database.types.ts` from the local database |
| `pnpm engine:eval` | Labeled eval of the engine with real Claude (costs money; see [Engine eval](#engine-eval)) |
| `pnpm engine:metrics` | Engine latency, TTFT, tool success and token summary from `ai_turns` (see [Reading the metrics](#reading-the-metrics)) |
| `pnpm db:seed` | Load the demo shop, the eval shop and the demo accounts into local Supabase (see [Demo shop](#demo-shop-pb-02)) |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and `pnpm db:seed --check` on every pull request, and a separate `integration` job that starts local Supabase and runs `pnpm db:test` and `pnpm test:int`. Vercel builds a preview URL for every pull request.

## Shared contract (PB-00)

Tables, types, tool shapes, the reply shape and `sendToConversation` are defined once. Import them; don't redefine them.

- `supabase/migrations/`: every table, constraint and Row Level Security policy. Add a new migration for each change (`pnpm supabase migration new <name>`); never edit one that is already on `main`. Then run `pnpm db:reset`, `pnpm db:test` and `pnpm db:types`, and commit the regenerated types.
- `@/contract` (`src/contract/`): generated database types, Zod schemas for the 8 tools, the reply shape `{ text, products[], quickReplies[] }`, engine input/output, enums such as `conversations.mode`.
- `src/lib/supabase/admin.ts`: server-only client with the secret key. It bypasses RLS, so every query filters by `shop_id` itself.
- `src/lib/channels/send.ts`: `sendToConversation(conversationId, reply, { from })`. Each channel story implements its adapter in `src/lib/channels/adapters.ts`.

New tables and functions get **no** rights for `anon` or `authenticated` by default. A migration that adds one must `enable row level security`, then `grant` what signed-in users need and add the policies (see `supabase/migrations/20261103120100_pb00_rls.sql`), and add a case to `supabase/tests/`.

Code that imports `server-only` or the `@/` alias (the admin client, `sendToConversation`) runs in Vitest and Next as is, but not in plain Node scripts: Node knows neither the alias nor extensionless imports. A script such as `scripts/seed.ts` runs with `node` directly (Node 24 strips the types) and imports only relative paths ending in `.ts`, like `src/lib/seed/sheet.ts`.

Staff users who sent messages or confirmed orders can't be deleted (their rows point at them); disable them in Supabase Auth instead.

Migrations reach the shared Supabase project only after they are merged to `main`. Test unmerged migrations on local Supabase (`pnpm db:start`, needs Docker).

## Demo shop (PB-02)

`supabase/seed/demo/` holds the demo shop data, one CSV per sheet of the PB-02 format (Eboiz/Documents#2): `shop`, `products`, `variants`, `size_charts`, `pairings`, `policies`. Product photos are `images/<ma_sp>.jpg` (CC0, see `images/CREDITS.md`), at most 200 KB each.

```bash
pnpm db:start
pnpm db:seed                                   # local Supabase
pnpm db:seed --target=shared --confirm=<ref>   # the team's project; <ref> is the subdomain of NEXT_PUBLIC_SUPABASE_URL
pnpm db:seed --check                           # only check the CSV files
```

- It writes two shops with the same data: `may-boutique` (demo) and `may-boutique-eval` (PB-10 eval runs, so their draft orders never mix with the demo). It also creates the accounts in `DEMO_OWNER_EMAIL` / `DEMO_OWNER_PASSWORD` and `DEMO_STAFF_EMAIL` / `DEMO_STAFF_PASSWORD` (`.env.local`) as owner and staff of the demo shop.
- Wrong data stops the seed before anything is written, with the sheet, row and column of each error.
- It can run any number of times: rows are upserted, never deleted. Each run resets names, prices, descriptions, photos and stock to the CSV, so on the shared project it also undoes edits made in the app and stock taken by confirmed orders. Rows that are in the database but not in the CSV are reported, not removed. It never moves an existing account that belongs to another shop.
- It ends by signing in as the demo owner and staff and checking that the demo shop can't read or change the eval shop.

## Environment variables

All keys live in `.env.local` locally and in Vercel project settings for deployments. Never commit them. See `.env.example` for the full list.

- `ANTHROPIC_API_KEY` (server-only): Claude API key used by the AI engine.
- `ANTHROPIC_MODEL` (server-only, optional): overrides the engine's model, `claude-sonnet-5-5` by default.

## AI engine (PB-03)

`src/lib/engine/` (server-only): `runEngine(input, deps?)` takes the history and mode, calls Claude with the 8 contract tools, runs them on Supabase and returns an `EngineOutput`.

- `executeTool` is the only way a tool runs. It blocks `create_draft_order` and `handoff_to_staff` in `staff_draft` (`toolsForMode`), validates input and output with the contract schemas, and turns every error into an error `tool_result`. `toolDefinitions(mode)` only advertises the same set to the model.
- `shop_id` always comes from the server: from the conversation in `customer` mode, and from `deps.staffShopId` (filled from `requireStaff()`) in `staff_draft`. Every admin-client query filters by it.
- More than 5 tool calls in one turn hands the conversation to staff (`too_many_tool_calls`). A conversation not in mode `ai` is refused with `conversation_not_found`; routes must still gate before calling.
- The reply is returned before the turn is written to `ai_turns`: `result.turnLogged` resolves with the row id or `null` and never rejects. On Vercel, pass it to `after()`.

`pnpm test:int` includes `src/lib/engine/engine.int.test.ts`: the engine end to end on the two-shop fixture with a scripted model, plus a live Claude smoke test that runs only when `ANTHROPIC_API_KEY` is in `.env.test.local` (it costs real money; CI never runs it) and prints latency, TTFT, tokens and call counts.

### Engine eval

```bash
pnpm engine:eval                      # 8 cases x 3 runs
EVAL_RUNS=1 EVAL_CASE=size-advice pnpm engine:eval
```

Labeled basic cases (`src/lib/engine/eval/cases.ts`) on shop A of the two-shop fixture: for each case, which tools the model must call, with which arguments, and when it must call none. The table shows per case the pass rate, recall of required calls, argument accuracy and necessity precision (no extra or repeated calls), plus average latency, tokens and tool calls. Needs local Supabase running (`pnpm db:start`) and `ANTHROPIC_API_KEY` in `.env.test.local`. **Every run costs real money** (8 cases x 3 runs = 24 turns by default). It only reports, never fails on a low score, and CI doesn't run it.

### Engine metrics

Each turn prints one JSON line with `event: "engine_turn"` (`deps.onMetrics`, `console.info` by default). It holds measurements only, never message text, tool input or output, or customer details:

| Field | Meaning |
| --- | --- |
| `latencyMs` | Start of `runEngine` until the output is ready (the `ai_turns` write is not included) |
| `ttftMs` | Start of the turn until the first text token of the last model response, the one the shopper reads. `null` when the model didn't write the reply (handoff, truncated) |
| `modelCalls[]` | Per model call: `ms`, `ttftMs`, input/output tokens, `cacheReadTokens`, `cacheCreationTokens`, `stopReason` |
| `toolCalls[]` | Per tool call the model asked for: `name`, `ms`, `outcome` (`ok`, `unknown_tool`, `tool_not_allowed`, `invalid_input`, a tool error code such as `product_not_found`, or `internal_error`) |
| `duplicateToolCalls` | Calls repeating the same tool and input within the turn |
| `inputTokens`, `outputTokens` | Totals over all model calls, as written to `ai_turns` |
| `handoffReason`, `truncated` | Why the turn ended without a model reply, if it did |
| `promptVersion`, `model`, `mode`, `shopId` | To compare runs |

### Reading the metrics

```bash
pnpm engine:metrics                                  # every turn in ai_turns
pnpm engine:metrics --shop <uuid> --since 24h        # one shop, last 24 hours (or 7d)
pnpm engine:metrics --model claude-sonnet-5-5 --prompt v0   # compare models or prompt versions
```

Read only. It uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the environment or `.env.local`, and prints, per mode and separately for turns with no tool call and with at least one: latency and TTFT P50/P90/P99 (nearest rank), tool call success rate with the `invalid_input` and not-found rates, tokens, model and tool calls per finished turn (turns without a handoff), and handoff rate by reason. Everything comes from `ai_turns`; no log collection needed.

`ai_turns` stores `latency_ms`, `ttft_ms`, `input_tokens`, `output_tokens`, `model_calls`, `tool_calls`, `model` and `prompt_version`. Known limits: per-call timings, cache tokens and `duplicateToolCalls` are only in the log line; `unknown_tool` calls are not in `ai_turns.tool_calls`; the engine has no tuned prompt yet (`v0`, PB-10).

## Auth

- `/admin/*` needs a signed-in user. `src/proxy.ts` redirects signed-out visitors to `/login?next=...`, and `src/app/admin/layout.tsx` checks the user again on the server.
- `/login` signs in with Supabase Auth email + password.
- `/s/<shop-slug>` (customer web chat, PB-04) is public.
