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

Staff accounts are created in Supabase Dashboard > Authentication > Users (email + password). There is no sign-up page.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate route types, then `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest, `src/**/*.test.ts`) |
| `pnpm db:start` / `pnpm db:stop` | Local Supabase in Docker (prints local URL and keys) |
| `pnpm db:reset` | Recreate the local database from `supabase/migrations/` |
| `pnpm db:test` | Database tests (pgTAP, `supabase/tests/`): constraints and Row Level Security |
| `pnpm db:types` | Regenerate `src/contract/database.types.ts` from the local database |

CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests on every pull request. Vercel builds a preview URL for every pull request.

## Shared contract (PB-00)

Tables, types, tool shapes, the reply shape and `sendToConversation` are defined once. Import them; don't redefine them.

- `supabase/migrations/`: every table, constraint and Row Level Security policy. Add a new migration for each change (`pnpm supabase migration new <name>`); never edit one that is already on `main`. Then run `pnpm db:reset`, `pnpm db:test` and `pnpm db:types`, and commit the regenerated types.
- `@/contract` (`src/contract/`): generated database types, Zod schemas for the 8 tools, the reply shape `{ text, products[], quickReplies[] }`, engine input/output, enums such as `conversations.mode`.
- `src/lib/supabase/admin.ts`: server-only client with the secret key. It bypasses RLS, so every query filters by `shop_id` itself.
- `src/lib/channels/send.ts`: `sendToConversation(conversationId, reply, { from })`. Each channel story implements its adapter in `src/lib/channels/adapters.ts`.

New tables and functions get **no** rights for `anon` or `authenticated` by default. A migration that adds one must `enable row level security`, then `grant` what signed-in users need and add the policies (see `supabase/migrations/20261103120100_pb00_rls.sql`), and add a case to `supabase/tests/`.

Code that imports `server-only` (the admin client, `sendToConversation`) runs in Vitest as is (aliased in `vitest.config.ts`). Plain Node scripts that import it, such as seed or eval runners, need `node --conditions=react-server`.

Staff users who sent messages or confirmed orders can't be deleted (their rows point at them); disable them in Supabase Auth instead.

Migrations reach the shared Supabase project only after they are merged to `main`. Test unmerged migrations on local Supabase (`pnpm db:start`, needs Docker).

## Environment variables

All keys live in `.env.local` locally and in Vercel project settings for deployments. Never commit them. See `.env.example` for the full list.

## Auth

- `/admin/*` needs a signed-in user. `src/proxy.ts` redirects signed-out visitors to `/login?next=...`, and `src/app/admin/layout.tsx` checks the user again on the server.
- `/login` signs in with Supabase Auth email + password.
- `/s/<shop-slug>` (customer web chat, PB-04) is public.
