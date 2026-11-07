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
| `pnpm test:e2e` | End-to-end tests (Playwright, `e2e/`). Run `pnpm exec playwright install chromium` once. Set `E2E_BASE_URL` to test a preview deployment |
| `pnpm db:start` / `pnpm db:stop` | Local Supabase in Docker (prints local URL and keys) |
| `pnpm db:reset` | Recreate the local database from `supabase/migrations/` |
| `pnpm db:test` | Database tests (pgTAP, `supabase/tests/`): constraints and Row Level Security |
| `pnpm db:types` | Regenerate `src/contract/database.types.ts` from the local database |
| `pnpm db:seed` | Load the demo shop, the eval shop and the demo accounts into local Supabase (see [Demo shop](#demo-shop-pb-02)) |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and `pnpm db:seed --check` on every pull request. Vercel builds a preview URL for every pull request.

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

`e2e/main-flow.spec.ts` plays the demo: a shopper on `/s/may-boutique` asks for a size (158 cm, 50 kg: the reply must name **M**), orders "Váy suông linen" Trắng / M in the chat, the demo staff account finds that order on `/admin/orders` (one line: name, `Trắng · Cỡ M · SL 1`), confirms it, and the stock shown on `/admin/products` is exactly one lower.

```bash
pnpm exec playwright install chromium                     # once
export DEMO_STAFF_EMAIL=... DEMO_STAFF_PASSWORD=...        # the seeded demo staff account (PB-02)
E2E_BASE_URL=https://<preview-url> pnpm test:e2e:main      # before each Sprint Review and the demo
```

- `test:e2e:main` runs the file three times with **one worker**: runs in parallel would confirm orders at the same time and make the stock check wrong.
- It talks to the real AI, so it checks facts (size M in the reply text, the order line, stock one lower), not sentences. The nightly job skips it (no Claude key there).
- Until the chat API (PB-03, PB-04, PB-11) and the orders API (PB-12) are deployed, it is reported as **skipped** with what is missing. Skipped is not passed.
- **Cleanup:** each run confirms one order, so stock of Váy suông linen Trắng / M drops by 3 per `test:e2e:main`. `pnpm db:seed` (or `--target=shared` for the team project) puts stock back to the CSV. The confirmed orders and their conversations stay, under customer names starting with `E2E-`, so they are easy to tell apart from real ones.

## Demo shop (PB-02)

`supabase/seed/demo/` holds the demo shop data, one CSV per sheet of the PB-02 format (Eboiz/Documents#2): `shop`, `products`, `variants`, `size_charts`, `pairings`, `policies`. Product photos are `images/<ma_sp>.jpg` (CC0, see `images/CREDITS.md`), at most 200 KB each.

```bash
pnpm db:start
pnpm db:seed                                   # local Supabase
pnpm db:seed --target=shared --confirm=<ref>   # the team's project; <ref> is the subdomain of NEXT_PUBLIC_SUPABASE_URL
pnpm db:seed --check                           # only check the CSV files
pnpm db:seed --only=channels                   # only the chat channel accounts (PB-15, PB-21), safe on the shared project
```

- It writes two shops with the same data: `may-boutique` (demo) and `may-boutique-eval` (PB-10 eval runs, so their draft orders never mix with the demo). It also creates the accounts in `DEMO_OWNER_EMAIL` / `DEMO_OWNER_PASSWORD` and `DEMO_STAFF_EMAIL` / `DEMO_STAFF_PASSWORD` (`.env.local`) as owner and staff of the demo shop.
- Wrong data stops the seed before anything is written, with the sheet, row and column of each error.
- It can run any number of times: rows are upserted, never deleted. Each run resets names, prices, descriptions, photos and stock to the CSV, so on the shared project it also undoes edits made in the app and stock taken by confirmed orders. Rows that are in the database but not in the CSV are reported, not removed. It never moves an existing account that belongs to another shop.
- It ends by signing in as the demo owner and staff and checking that the demo shop can't read or change the eval shop.

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

## Auth

- `/admin/*` needs a signed-in user. `src/proxy.ts` redirects signed-out visitors to `/login?next=...`, and `src/app/admin/layout.tsx` checks the user again on the server.
- `/login` signs in with Supabase Auth email + password.
- `/s/<shop-slug>` (customer web chat, PB-04) is public.
