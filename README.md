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

## Main flow test (PB-19)

`e2e/main-flow.spec.ts` plays the demo: a shopper on `/s/hanh-boutique` asks for a size (150 cm, 44 kg: the reply must name **S**), orders "Váy suông linen" be / S in the chat, the demo staff account finds that order on `/admin/orders` (one line: name, `be · Cỡ S · SL 1`), confirms it, and the stock shown on `/admin/products` is exactly one lower.

```bash
pnpm exec playwright install chromium                     # once
export DEMO_STAFF_EMAIL=... DEMO_STAFF_PASSWORD=...        # the seeded demo staff account (PB-02)
E2E_BASE_URL=https://<preview-url> pnpm test:e2e:main      # before each Sprint Review and the demo
```

- `test:e2e:main` runs the file three times with **one worker**: runs in parallel would confirm orders at the same time and make the stock check wrong.
- It talks to the real AI, so it checks facts (size M in the reply text, the order line, stock one lower), not sentences. The nightly job skips it (no Claude key there).
- Until the chat API (PB-03, PB-04, PB-11) and the orders API (PB-12) are deployed, it is reported as **skipped** with what is missing. Skipped is not passed.
- **Cleanup:** each run confirms one order, so stock of Váy suông linen be / S drops by 3 per `test:e2e:main`. `pnpm db:seed` (or `--target=shared` for the team project) puts stock back to the CSV. The confirmed orders and their conversations stay, under customer names starting with `E2E-`, so they are easy to tell apart from real ones.

## Rate limit (PB-17)

`receiveChannelMessage` (`src/lib/channels/receive.ts`) already applies it for every external channel (Messenger, Telegram, and later Instagram, WhatsApp). The web chat route (PB-04) stores the shopper's message, then calls it before the engine the same way:

```ts
import { replyIfRateLimited } from "@/lib/guard/rate-limit";

if (await replyIfRateLimited({ shopId, conversationId })) return; // "please wait" was sent, don't call the AI
```

Limit: 10 shopper messages per minute per conversation (one conversation per shopper), assumption A5. The rule is in `src/lib/guard/rate-limit-rule.ts`.

## Demo shop (PB-02)

The database holds two shops, each with an eval copy (`<slug>-eval`, PB-10):

| `--data` | Shop | Data | Accounts (`.env.local`) | Chat channels |
| --- | --- | --- | --- | --- |
| `demo` (default) | Hạnh Boutique, `hanh-boutique` | the PO's workbook and its 60 test questions (PB-28) | `DEMO_OWNER_*`, `DEMO_STAFF_*` | Messenger, Telegram |
| `may-boutique` | Mây Boutique, `may-boutique` | 60 products SP01-SP60 (PR #41) | `MAY_BOUTIQUE_OWNER_*`, `MAY_BOUTIQUE_STAFF_*` | web chat only |

A Facebook Page or Telegram bot belongs to one shop, so only `demo` stores channels. Photos are stored in Storage by product code, so the two data sets never share a code.

`supabase/seed/demo/` holds the demo shop data, one CSV per sheet of the PB-02 format (Eboiz/Documents#2): `shop`, `products`, `variants`, `size_charts`, `pairings`, `policies`. Product photos are `images/<ma_sp>.jpg` (CC0, see `images/CREDITS.md`), at most 200 KB each.

PB-28 uses the PO's workbook, version 02/11/2026. Its source checksum, counts and export procedure are in `supabase/seed/demo/SOURCE.md`. The current source has 30 products and 10 pairings; the final 60-product / 20-pairing target awaits the PO's additions. `test_questions.csv` contains all 60 fixtures. `--check` verifies their size, stock, price and available-pairing labels against the catalog, including earlier customer turns, and checks every JPEG. PB-10 evaluates the AI replies.

`supabase/seed/may-boutique/` holds the Mây Boutique catalog as merged in PR #41 (SP01-SP60, 616 variants, 30 pairings), with its photos and credits. It has no test set; the PO can compare it with the workbook when extending `demo/` to 60 products.

Apply migration `20261107110000_pb28_po_catalog.sql` before seeding an existing database. It keeps the shop IDs and their user/channel bindings, changes the slugs to `hanh-boutique` and `hanh-boutique-eval` (skipped when `hanh-boutique` already exists, so `may-boutique` stays a separate shop), and removes SP01-SP30 from the Hạnh Boutique shops with their dependent catalog rows and test draft orders. A decided order referencing those products stops the migration. Keep the SP01-SP60 Storage objects: Mây Boutique uses them.

```bash
pnpm db:start
pnpm db:seed                                   # local Supabase
pnpm db:seed --target=shared --confirm=<ref>   # the team's project; <ref> is the subdomain of NEXT_PUBLIC_SUPABASE_URL
pnpm db:seed --target=shared --confirm=<ref> --accounts=existing # reuse the existing owner/staff accounts and credentials
pnpm db:seed --data=may-boutique [--target=shared --confirm=<ref>]  # the second shop, Mây Boutique
pnpm db:seed --check [--data=may-boutique]     # only check the CSV files
pnpm db:seed --only=channels                   # only the chat channel accounts (PB-15, PB-21), safe on the shared project
```

- It writes the PO catalog to `hanh-boutique` (demo) and `hanh-boutique-eval` (PB-10 eval runs, so their draft orders never mix with the demo). It also creates the accounts in `DEMO_OWNER_EMAIL` / `DEMO_OWNER_PASSWORD` and `DEMO_STAFF_EMAIL` / `DEMO_STAFF_PASSWORD` (`.env.local`) as owner and staff of the demo shop. `--accounts=existing` verifies and reuses their existing profiles and credentials.
- Wrong data stops the seed before anything is written, with the sheet, row and column of each error.
- It can run any number of times: rows are upserted, never deleted. Each run resets names, prices, descriptions, photos and stock to the CSV, so on the shared project it also undoes edits made in the app and stock taken by confirmed orders. Rows that are in the database but not in the CSV are reported, not removed. It never moves an existing account that belongs to another shop.
- It ends by signing in as the demo owner and staff and checking that the demo shop can't read or change the eval shop.

Optional activity fixtures are in `supabase/seed/demo-activity.sql`. After the catalog seed, execute this file with `pnpm exec supabase db query --db-url "$DATABASE_URL" --file supabase/seed/demo-activity.sql` from a shell with `DATABASE_URL` loaded. It uses the existing `owner@shopmate.test` and `staff@shopmate.test` profiles of `hanh-boutique` and fills the shop to totals of 100 customers, 100 conversations, 500 messages, 50 orders and 150 order lines. Conversations total 60 AI, 30 staff and 10 awaiting staff. Orders total 20 draft, 25 confirmed and 5 cancelled. Two mock conversations have 60 messages each. Fixtures cover web chat over 90 days and use the `demo-activity-v1-` customer prefix for identification.

Confirmed and cancelled fixtures represent historical orders before the PO's current inventory snapshot. The transaction verifies inventory equality before committing. Existing activity counts determine how many new rows are needed. A second execution detects the reserved customer prefix and retains the existing fixtures. Requests that exceed the configured totals fail for review.

## Messenger channel (PB-15)

Shoppers message the demo shop's Facebook Page; the webhook `/api/webhooks/messenger` answers with the same engine and reply shape as web chat. Before Meta App Review, only people with a role on the Meta app (admins, developers, testers) can get answers.

**Code:** `src/app/api/webhooks/messenger/route.ts` (signature check, Page lookup, `after()`), `src/lib/channels/messenger.ts` (payload parsing, Send API: text, then a carousel of product cards, quick replies on the last message), `src/lib/channels/receive.ts` (shared by every external channel: dedupe by message id, find or create the shopper and conversation, store the message, call the engine while the conversation is in `ai` mode). A photo hands the conversation to staff; stickers are ignored. If the engine fails, the conversation is handed to staff with a short notice to the shopper.

**Set it up again:**

1. Create a Facebook Page and a Meta app (developers.facebook.com, use case "Engage with customers on Messenger from Meta", no business portfolio, stay in Development mode).
2. App > Messenger API Settings > Generate access tokens: connect the Page, then **Generate** the Page token. Note the Page ID shown next to it (not the id in the Page's profile URL).
3. App settings > Basic: copy the App secret.
4. `.env.local`: `META_APP_SECRET`, `META_VERIFY_TOKEN` (any random string, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`), `MESSENGER_PAGE_ID`, `MESSENGER_PAGE_ACCESS_TOKEN`.
5. Store the Page in the database: `pnpm db:seed --only=channels` (local) or `pnpm db:seed --only=channels --target=shared --confirm=<ref>`. This only upserts the `channel_accounts` row; it doesn't touch products, stock, photos or accounts.
6. Vercel (Production and Preview): add `META_APP_SECRET` and `META_VERIFY_TOKEN`. The Page token is read from the database, not from Vercel.
7. App > Messenger API Settings > Configure webhooks: Callback URL `https://<deployment>/api/webhooks/messenger`, Verify token = `META_VERIFY_TOKEN`, **Verify and save**. Then next to the Page, **Add subscriptions**: `messages`, `messaging_postbacks`.
8. App roles > Roles > Add people > Tester for each teammate; they accept at developers.facebook.com/requests.

## Telegram channel (PB-21)

Shoppers message the demo shop's Telegram bot; the webhook `/api/webhooks/telegram/<channel account id>` answers with the same engine and reply shape as web chat and Messenger: text, then each product as a photo with its price and sizes, with the quick replies as a keyboard under the input box (tapping one sends its text). `/start` gets a fixed greeting; a photo hands the conversation to staff; stickers are ignored.

**Code:** `src/app/api/webhooks/telegram/[accountId]/route.ts` (secret token check, account lookup, `after()`), `src/lib/channels/telegram.ts` (update parsing, Bot API sending). Messages go through the shared `src/lib/channels/receive.ts` (see the Messenger section).

**Set it up again:**

1. In Telegram, open @BotFather: `/newbot`, pick a name and a username ending in `bot`, copy the token.
2. `.env.local`: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` (any random string of `A-Z a-z 0-9 _ -`, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`).
3. Store the bot and point its webhook at a deployment: `pnpm db:seed --only=channels --target=shared --confirm=<ref> --telegram-webhook=https://<deployment>` (use a preview URL to test a branch, `https://shopmate-beige.vercel.app` for production). Nothing goes to Vercel: the token and secret are read from the database.
4. Check with `https://api.telegram.org/bot<token>/getWebhookInfo` (`last_error_message` should be empty).

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

## Customer shop and web chat (PB-04)

The page at `/s/<shop-slug>` (PB-25 shared UI components) talks only to these
same-origin endpoints (`src/app/api/shops/[slug]/`):

- `GET /api/shops/<slug>/catalog` → `{ shop: { name }, products: [{ id, name, price, imageUrl, colors, sizesInStock }] }`. Colors and sizes are the in-stock ones; 404 for an unknown shop.
- `GET /api/shops/<slug>/chat` → `{ messages: [{ id, sender, text, reply, createdAt }] }` (latest 100, oldest first); `reply` is the PB-00 shared reply shape or `null`. A visitor without the cookie gets `[]`.
- `POST /api/shops/<slug>/chat` with `{ text, productId, clientMessageId }` → `{ status }` (`answered`, `stored`, `handed_off`, `rate_limited`, `duplicate`) once the shopper message is stored and, in `ai` mode, the AI reply too. `text` is 1–1000 characters; `productId` must belong to the shop. Errors are `{ error }` in Vietnamese, ready to show.

How it works:

- **Shopper identity:** no account. The first POST sets the httpOnly cookie `shopmate_shopper` (random 256-bit id plus its HMAC, signed with the server secret, path `/api/shops`, 180 days; a cookie with a wrong signature counts as no cookie); `shoppers.external_id` stores only its SHA-256. The shop always comes from the slug, never from the body.
- **Same core as the other channels:** POST calls `receiveChannelMessage` (`src/lib/channels/receive.ts`) with `{ channel: "web", shopId }`: dedupe by `clientMessageId` (unique `messages(conversation_id, client_message_id)`), PB-17 rate limit, no AI unless the conversation is `ai`, engine with the asked-about `productId`, handoff on engine failure.
- **Limits the browser can't reset:** PB-17 counts per conversation, and dropping the cookie makes a new one. So before any shopper, conversation or AI turn, POST asks `web_chat_take` (`src/lib/guard/web-chat-limit.ts`, table `web_chat_hits`): at most 30 messages per minute per client IP (all shops), 15 per minute per IP in one shop, 20 requests without a valid cookie (new shoppers) per hour per IP, and 60 messages per minute per shop. The IP is `x-real-ip`, else the first hop of `x-forwarded-for` (set by Vercel), stored only as an HMAC. Over a limit: 429 with a Vietnamese `{ error }`, nothing stored. `maxDuration` of the chat route is 120 s (a whole AI turn runs inside the POST).
- **Staff replies and order updates:** `sendToConversation` stores them as messages (the web adapter has nothing to push); the open chat polls GET every 3 seconds and shows them without a reload. The browser never reads Supabase.
- **Tests:** `src/app/api/shops/[slug]/**/route.test.ts` (validation, cookie, slug), `src/lib/chat/web-chat.int.test.ts` (`pnpm test:int`), `e2e/shop-front.spec.ts` (mocked API) and `e2e/shop-front-live.spec.ts` (real API on the seeded demo shop; the staff-message part needs `E2E_SUPABASE_URL` / `E2E_SUPABASE_SECRET_KEY`).
- **Local photos:** `next.config.ts` allows the photo host of `NEXT_PUBLIC_SUPABASE_URL` when it is local Supabase (`next dev`, or `pnpm build` + `pnpm start` in the CI e2e job); deployments built against `*.supabase.co` never allow local IPs.
