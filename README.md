# Stash

Stash is a grocery receipt scanner and pantry tracker. You photograph a
receipt, the app reads it and matches the lines against a shared product
catalogue, and you get an overview of what you have at home, where it is
stored and when it expires. The product catalogue and price history are
shared across all users; your own inventory and receipts stay private to
your household.

Stack: Nuxt 4 (Vue 3, SSR) with Nuxt UI, Supabase (Postgres, Auth, Storage,
RLS), hosted on Cloudflare Workers. See
`docs/superpowers/specs/2026-09-21-stash-design.md` for the full design.

## Prerequisites

- [Docker](https://www.docker.com/) — runs the local Supabase stack
- [Node.js](https://nodejs.org/) 20 or later

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the local Supabase stack (Postgres, Auth, Storage, Mailpit for
   test emails):

   ```bash
   npx supabase start
   ```

   This prints local API/DB URLs and keys. `npx supabase status` shows them
   again later.

3. Copy the environment file and fill it in with the values from the
   previous step:

   ```bash
   cp .env.example .env
   ```

   `.env.example` documents which variables are for local development only
   and which ones matter when deploying — see "Deploying" below.

4. Start the dev server:

   ```bash
   npm run dev
   ```

   The app runs at `http://localhost:3000`.

## Tests

Three separate suites, each with different requirements:

| Command | What it runs | Requires |
|---|---|---|
| `npm test` | Unit tests (Vitest, `test/**` excluding `test/db` and `e2e`) | Nothing extra |
| `npm run test:db` | Database/RLS tests (`test/db/**`), against a real Postgres connection | Local Supabase running (`npx supabase start`) and `.env` present; run `npx supabase db reset` first to apply migrations cleanly |
| `npm run test:e2e` | End-to-end tests (Playwright, `e2e/**`) | Local Supabase running, `.env` present, and the dev server (Playwright starts it automatically via `npm run dev`); magic links are read from Mailpit at `http://127.0.0.1:54324` |

`npm run test:all` runs the unit and database suites together.

## Deploying

`npm run deploy` runs `nuxt build && wrangler deploy`.

This matters because of how Supabase credentials flow through the build:
`@nuxtjs/supabase` reads `SUPABASE_URL`/`SUPABASE_KEY` (or their
`NUXT_PUBLIC_`-prefixed equivalents) from `.env` **at build time** and bakes
them into the deployed bundle as defaults. Nitro can override those defaults
**at runtime**, but only via environment variables that use the exact
`NUXT_PUBLIC_` prefix — plain `SUPABASE_URL`/`SUPABASE_KEY` are never read by
the running Worker, only by the build.

Before running `npm run deploy` against a real project, set these on the
Cloudflare Worker (not in `.env`, which stays local-only):

```bash
npx wrangler secret put NUXT_PUBLIC_SUPABASE_URL
npx wrangler secret put NUXT_PUBLIC_SUPABASE_KEY
npx wrangler secret put NUXT_PUBLIC_APP_VERSION
```

- `NUXT_PUBLIC_SUPABASE_URL` — the production Supabase project URL
- `NUXT_PUBLIC_SUPABASE_KEY` — the production Supabase anon/publishable key
- `NUXT_PUBLIC_APP_VERSION` — the version being deployed, e.g. the commit SHA
  (without this, the Worker falls back to the `.env` value used at build
  time, typically `dev` — and then `/api/health` reports version `dev` in
  production, misleading once more than one version is running)

Redirect URLs need the same attention before that first deploy. Since this
branch, `emailRedirectTo` is locale-aware — `/confirm`, `/nl/confirm`, or
`/fr/confirm`, depending on which locale the user was on when they signed in
(see `app/pages/login.vue`) — instead of the single fixed URL it used to be.
Locally this is invisible because `supabase/config.toml`'s
`additional_redirect_urls` is a glob (`http://localhost:3000/*`) that covers
all three. In production, the redirect URL allowlist lives in the Supabase
dashboard (Authentication → URL Configuration), outside this repo, and has
to be set explicitly — add all three confirm URLs (or an equivalent glob)
for the deployed domain before going live. Miss `/nl` or `/fr` there and
those magic links silently fall back to the Site URL, dropping the guest's
language exactly like the bug this branch fixed, just resurrected in
production instead of locally.

These three are safe to expose this way: all of them end up in
`runtimeConfig.public` and ship to the browser regardless, the same anon key
that's already public by design. `wrangler secret put` is used here purely
to get them into the Worker's environment reliably; declaring them as plain
`vars` in `wrangler.jsonc` instead works the same way.

`DATABASE_URL` and `NUXT_SUPABASE_SECRET_KEY` are not part of this list.
`DATABASE_URL` is used only by the test harness. The secret key is read by
`@nuxtjs/supabase` into server-side runtime config, but nothing in this app
asks for the service role yet, so it never leaves the server and is not
needed for a deploy.

(The module also accepts the older `SUPABASE_SERVICE_KEY` name, but warns on
every run that it is deprecated in favour of the key above.)
