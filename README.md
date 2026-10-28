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

CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests on every pull request. Vercel builds a preview URL for every pull request.

## Environment variables

All keys live in `.env.local` locally and in Vercel project settings for deployments. Never commit them. See `.env.example` for the full list.

## Auth

- `/admin/*` needs a signed-in user. `src/proxy.ts` redirects signed-out visitors to `/login?next=...`, and `src/app/admin/layout.tsx` checks the user again on the server.
- `/login` signs in with Supabase Auth email + password.
- `/s/<shop-slug>` (customer web chat, PB-04) is public.
