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
| `pnpm eval:injection` | PB-17 prompt-injection eval with real Claude on local Supabase, live progress and an HTML report (see [Prompt-injection eval](#prompt-injection-eval-pb-17)) |
| `pnpm eval:live` | Acceptance run of the AI on the deployed web chat (production), read-only checks against the database, HTML report (see [Live acceptance run](#live-acceptance-run-on-production-pb-04--pb-17)) |
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
| `demo` (default) | Hạnh Boutique, `hanh-boutique` | the PO's workbook and its 60 test questions (PB-28) | `DEMO_OWNER_*`, `DEMO_STAFF_*` | Messenger, Telegram, WhatsApp |
| `may-boutique` | Mây Boutique, `may-boutique` | 60 products SP01-SP60 (PR #41) | `MAY_BOUTIQUE_OWNER_*`, `MAY_BOUTIQUE_STAFF_*` | web chat only |

A Facebook Page, Telegram bot or WhatsApp number belongs to one shop, so only `demo` stores channels. Photos are stored in Storage by product code, so the two data sets never share a code.

`supabase/seed/demo/` holds the demo shop data, one CSV per sheet of the PB-02 format (Eboiz/Documents#2): `shop`, `products`, `variants`, `size_charts`, `pairings`, `policies`. Product photos are `images/<ma_sp>.jpg` (CC0, see `images/CREDITS.md`), at most 200 KB each.

PB-28 uses the PO's workbook, version 02/11/2026. Its source checksum, counts and export procedure are in `supabase/seed/demo/SOURCE.md`. The catalog has 60 products and 20 pairings: the PO's 30 products and 10 pairings, plus 30 products and 10 pairings taken from the Mây Boutique catalog under Hạnh Boutique codes (`VAY09`…, `AO10`…, `QUAN06`…, `CV06`, `AK04`, `AK05`); the added rows await the PO's review. Migration `20261111150000_pb28_catalog_60.sql` removes the legacy SP31-SP60 rows from the Hạnh Boutique shops before seeding an existing database. `test_questions.csv` contains all 60 fixtures. `--check` verifies their size, stock, price and available-pairing labels against the catalog, including earlier customer turns, and checks every JPEG. PB-10 evaluates the AI replies.

`supabase/seed/may-boutique/` holds the Mây Boutique catalog as merged in PR #41 (SP01-SP60, 616 variants, 30 pairings), with its photos and credits. It has no test set; the PO can compare it with the workbook when extending `demo/` to 60 products.

Apply migration `20261107110000_pb28_po_catalog.sql` before seeding an existing database. It keeps the shop IDs and their user/channel bindings, changes the slugs to `hanh-boutique` and `hanh-boutique-eval` (skipped when `hanh-boutique` already exists, so `may-boutique` stays a separate shop), and removes SP01-SP30 from the Hạnh Boutique shops with their dependent catalog rows and test draft orders. A decided order referencing those products stops the migration. Keep the SP01-SP60 Storage objects: Mây Boutique uses them.

```bash
pnpm db:start
pnpm db:seed                                   # local Supabase
pnpm db:seed --target=shared --confirm=<ref>   # the team's project; <ref> is the subdomain of NEXT_PUBLIC_SUPABASE_URL
pnpm db:seed --target=shared --confirm=<ref> --accounts=existing # reuse the existing owner/staff accounts and credentials
pnpm db:seed --data=may-boutique [--target=shared --confirm=<ref>]  # the second shop, Mây Boutique
pnpm db:seed --check [--data=may-boutique]     # only check the CSV files
pnpm db:seed --only=channels                   # only the chat channel accounts (PB-15, PB-21, PB-27), safe on the shared project
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

## WhatsApp channel (PB-27)

Shoppers message the demo shop's WhatsApp number; deliveries come to the same webhook as Messenger, `/api/webhooks/messenger`, signed with the same app secret, and are told apart by `object = whatsapp_business_account`. The reply is the same as on web chat: text, then each product as a photo with its name, price and sizes as the caption. Quick replies become reply buttons on the last message (up to 3, the last product photo as their header), or a list ("Chọn nhanh") when there are more; tapping one sends its title as the shopper's message. A photo hands the conversation to staff; stickers, voice notes and delivery/read statuses are ignored. Before the number is verified, the Cloud API test number can only message the recipients added in the Meta app.

**Code:** `src/app/api/webhooks/messenger/route.ts` (signature check, `object` dispatch, phone number lookup in `channel_accounts`, `after()`), `src/lib/channels/whatsapp.ts` (payload parsing, Cloud API sending, read receipt with typing indicator). Messages go through the shared `src/lib/channels/receive.ts` (dedupe by WhatsApp message id `wamid…`), and `sendToConversation` reaches WhatsApp through `adapters.whatsapp`, so orders (PB-11, PB-12) and staff replies (PB-13) work there too.

**Set it up again** (the Meta app and its webhook from the Messenger section):

1. Meta app > Add product > **WhatsApp** > Set up. Meta creates a test business account and a test phone number.
2. WhatsApp > API Setup: under **To**, add each teammate's phone number and confirm it with the code WhatsApp sends (at most 5 recipients). Copy the **Phone number ID** of the test number (not the number itself) and generate an access token. The token on this page expires after 24 hours; for longer tests, Business Settings > Users > System users > Generate token with `whatsapp_business_messaging` and `whatsapp_business_management`, and assign the app and the WhatsApp account to the system user.
3. `.env.local`: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (`META_APP_SECRET` and `META_VERIFY_TOKEN` are the Messenger ones).
4. Store the number in the database: `pnpm db:seed --only=channels --target=shared --confirm=<ref>` (or local without the flags). It upserts the `channel_accounts` row (`channel = whatsapp`, `external_account_id` = phone number ID, `access_token`); run it again after changing the token. Nothing new goes to Vercel: the token is read from the database.
5. WhatsApp > Configuration > Webhook > Edit: Callback URL `https://<deployment>/api/webhooks/messenger`, Verify token = `META_VERIFY_TOKEN`, **Verify and save**. Then under Webhook fields, **Subscribe** to `messages`.
6. From a recipient phone, send a message to the test number (WhatsApp > API Setup shows it). A message to an unknown phone number ID shows `whatsapp: unknown phone number …` in the Vercel logs; a refused send (for example a recipient not in the list) shows `whatsapp: message … not delivered` or `whatsapp_send_failed`.

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
- `ANTHROPIC_BACKUP_API_KEY`, `ANTHROPIC_BACKUP_API_URL` (server-only, optional): a second key the engine switches to when the primary fails with 429 (quota), 5xx, 401/403 or a connection error. The primary then gets no SDK retries. Each switch logs `{"event":"anthropic_backup","status":...}`. URL empty means api.anthropic.com.

## AI engine (PB-03)

`src/lib/engine/` (server-only): `runEngine(input, deps?)` takes the history and mode, calls Claude with the 8 contract tools, runs them on Supabase and returns an `EngineOutput`.

- `executeTool` is the only way a tool runs. It blocks `create_draft_order` and `handoff_to_staff` in `staff_draft` (`toolsForMode`), validates input and output with the contract schemas, and turns every error into an error `tool_result`. `toolDefinitions(mode)` only advertises the same set to the model.
- `shop_id` always comes from the server: from the conversation in `customer` mode, and from `deps.staffShopId` (filled from `requireStaff()`) in `staff_draft`. Every admin-client query filters by it.
- More than 5 tool calls in one turn hands the conversation to staff (`too_many_tool_calls`). A conversation not in mode `ai` is refused with `conversation_not_found`; routes must still gate before calling.
- The reply is returned before the turn is written to `ai_turns`: `result.turnLogged` resolves with the row id or `null` and never rejects. On Vercel, pass it to `after()`.

### Jev router (PB-10)

With `OPENROUTER_API_KEY` set, each turn is first decided by Jev (`typesafe/jev-1.13`, OpenRouter Decisions API; `src/lib/engine/jev.ts`): the intent, which shop product, the policy kind, and whether it is a discount trick. Jev returns probabilities only, so code fills the tool arguments (size, color, height/weight) and runs a fixed tool sequence per intent (`route.ts`); the model then only writes the reply from those facts, with no tools, and the server picks the product cards. The same post-checks as the tool loop apply (PB-06 size, PB-09 discount, one retry each). Orders, unsure intents (confidence < 0.6) and any Jev error fall back to the LLM tool loop; without the key every turn uses it. Each turn's metrics line has a `route` field (`router` or `llm_loop`, the intent, Jev latency and cost). The recent conversation is sent to OpenRouter/TypeSafe.

`pnpm test:int` includes `src/lib/engine/engine.int.test.ts`: the engine end to end on the two-shop fixture with a scripted model, plus a live Claude smoke test that runs only when `ANTHROPIC_API_KEY` is in `.env.test.local` (it costs real money; CI never runs it) and prints latency, TTFT, tokens and call counts.

### Engine eval

```bash
pnpm engine:eval                      # every case x 3 runs, like production: Haiku + Jev router
EVAL_RUNS=1 EVAL_CASE=size-advice pnpm engine:eval
JEV_IN_TESTS=false EVAL_LABEL=llm-loop pnpm engine:eval   # LLM tool loop only
```

Each run is saved to `eval-runs/<date>-<label>.json` (summary table, every run's score, route, tool calls and reply) so runs can be compared.

`pnpm engine:eval` and `pnpm eval:injection` run like production: `ANTHROPIC_MODEL` defaults to `claude-haiku-5-5` and the Jev router is on (`JEV_IN_TESTS=true`), with `OPENROUTER_API_KEY` from `.env.test.local` or `.env.local`. Without that key every turn uses the LLM tool loop, and the eval prints a warning. The shell wins: `ANTHROPIC_MODEL=…` or `JEV_IN_TESTS=false` changes one run. Unit and integration tests are unchanged: Jev stays off there. The injection token budget (`EVAL_MAX_TOKENS`) counts Claude tokens only; Jev calls go to OpenRouter.

PB-31 groups (`src/lib/engine/eval/cases-pb31.ts`): `replay-*` holds the 18 shopper messages of the handoff table in Eboiz/Documents#32, each with its expected result (answer, offer of staff + reason, or handoff + reason); `near-*` holds typos, missing diacritics, other names (đầm/váy, quần bò/quần jean, somi, jacket) and measurements just outside the size chart. Run one group with `EVAL_GROUP=replay- pnpm engine:eval` (or `near-`). Every case is labeled `shouldHandOff`, and the summary has three more columns: **handoff rate** (runs handed to staff), **offer rate** (runs that asked "Bạn có muốn mình nhờ nhân viên…"), and **correct decision** (runs whose answer / offer / handoff matches the label). Report both the handoff rate and correct decision, so a lower handoff rate can't come from the AI making answers up.

### Prompt-injection eval (PB-17)

```bash
pnpm eval:injection --plan                       # cases, runs, estimated tokens; no Claude, no database
pnpm eval:injection                              # 85 attack cases x 10 runs, LOCAL Supabase only
EVAL_RUNS_BY_SEVERITY=critical:3,medium:2,low:1 pnpm eval:injection
EVAL_RUNS=3 EVAL_CATEGORY=leak,owner pnpm eval:injection
EVAL_CASE=pb17-override-dan pnpm eval:injection
EVAL_MAX_TOKENS=400000 pnpm eval:injection       # hard token budget (default 400000)
EVAL_FAKE_MODEL=refuse pnpm eval:injection       # dry run, no Claude call (also comply|mixed|quota)
pnpm eval:injection --out report.html            # default: ../Bao cao prompt injection <dd-mm>.html
pnpm eval:injection --report-only eval-runs/<file>.json
```

Every model call's tokens (input, output, cache write, cache read) are counted. The progress line shows the running total, and the JSON/HTML show tokens per run, per case and in total. A run that would go over `EVAL_MAX_TOKENS` is not started. A 429 from the gateway stops the eval at once, with no retries, and is not counted as a failure. Either way the runs not started are marked "chưa chạy" and the report is still written.

Supabase URL and keys always come from `supabase status` of the local stack (never from `.env.local`, which points at production); the run stops unless the URL is 127.0.0.1/localhost. Only `ANTHROPIC_API_KEY`, `ANTHROPIC_API_URL`, `ANTHROPIC_MODEL` and the two `ANTHROPIC_BACKUP_*` variables are read from `.env.local` / `.env.test.local` (model default `claude-haiku-5-5`, same as production). Cases: `src/lib/engine/eval/cases-pb17-injection.ts`; checks: `injection-score.ts`; a case passes with at least 9 of 10 runs.

Labeled basic cases (`src/lib/engine/eval/cases.ts`) on shop A of the two-shop fixture: for each case, which tools the model must call, with which arguments, and when it must call none. The table shows per case the pass rate, recall of required calls, argument accuracy and necessity precision (no extra or repeated calls), plus average latency, tokens and tool calls. Needs local Supabase running (`pnpm db:start`) and `ANTHROPIC_API_KEY` in `.env.test.local`. **Every run costs real money** (8 cases x 3 runs = 24 turns by default). It only reports, never fails on a low score, and CI doesn't run it.

### Live acceptance run on production (PB-04 … PB-17)

```bash
pnpm eval:live --plan                      # cases, groups, new shoppers, estimated tokens; no request
pnpm eval:live --group 1                   # one group (<= 20 new shoppers), 3 runs per case
pnpm eval:live --group 2 --wait            # waits (countdown) until this hour's budget allows the group
EVAL_ISSUE=PB-06 pnpm eval:live            # one issue (EVAL_CASE=<id>[,<id>] for cases, EVAL_RUNS=1)
pnpm eval:live --group 1 --compare eval-runs/<previous>.json
pnpm eval:live --fake                      # replays src/lib/engine/eval/fixtures/live-fake.json: no network, no Claude
pnpm eval:live --report-only eval-runs/<file>.json [--compare <json>] [--out <html>]
```

Talks to the deployed web chat like a shopper (`--base`, default `https://shopmate-beige.vercel.app`; `--shop`, default `may-boutique-eval`; a shop without `-eval` needs `--allow-demo-shop`). Each run is a new shopper (no cookie); follow-up turns keep the cookie. Each turn is then checked against the database, **read only** and only for conversations the run created: the `ai_turns` row (tools, `handoff_reason`, model, prompt version, tokens), the conversation mode, orders and stock. `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` come from the shell or `.env.local` (only these two) and must be the deployment's project.

Expected prices, stock, sizes (`recommendSize` on the chart) and pairings come from the shop's data read at the start, never from the case file. Every case also gets the data checks: every amount in a reply is a shop price, a policy amount, a tool result or the shopper's own number; card prices and sizes match; stock counts match.

Production allows 20 new shoppers per hour and 15 messages per minute per IP and shop (`web-chat-limit.ts`). The runner sends at most 12 a minute, 4 s apart, counts its new shoppers in `eval-runs/.live-new-shoppers.json` and refuses a plan that doesn't fit the hour (or waits with `--wait`). Cases are in 4 groups of at most 18 new shoppers at 3 runs: run one group per hour. HTTP 429/5xx or the engine-failure notice without an `ai_turns` row is an infra error, not an AI failure; two in a row stop the run. Output: `eval-runs/<date>-live-<shop>[-g<n>].json` and an HTML report (default `../Bao cao kiem thu AI production <dd-mm>.html`). Cases: `src/lib/engine/eval/live-cases.ts`.

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
