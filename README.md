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

### The live environment

| | |
| --- | --- |
| Supabase project | `ltauxadznuvzzojtuujp`, region `eu-central-1` (Frankfurt) |
| API URL | `https://ltauxadznuvzzojtuujp.supabase.co` |
| Cloudflare Worker | `stash` — https://stash.steff-093.workers.dev |

Auth redirect configuration lives in the Supabase dashboard under
**Authentication → URL Configuration**, not in this repo. Site URL is the
Worker URL, and the redirect allowlist is `https://stash.steff-093.workers.dev/**`
— a glob, so it covers `/confirm`, `/nl/confirm` and `/fr/confirm` together.
Narrowing that to just `/confirm` reintroduces the locale-loss bug described
below, in production only.

### How deploys happen

Merging to `main` deploys. The `deploy` job in `.github/workflows/ci.yml`
runs after both test jobs pass, pushes any new migrations, builds, deploys
the Worker, and then asks `/api/health` whether the new commit is actually
answering. A red migration stops the deploy; a deploy that uploads but never
goes live fails the job rather than passing quietly.

Schema before code, deliberately. The reverse order ships code that expects a
column which does not exist yet. The first real run proved the point in the
other direction: `supabase db push` failed, and because it runs first nothing
was deployed — production kept serving the previous version instead of code
written against a schema that had not landed.

The migration step runs `supabase link` before `db push`, and that is not
redundant even though `db push` takes a `--project-ref`. Without linking, the
CLI connects straight to `db.<ref>.supabase.co`, which newer projects expose
over IPv6 only, while GitHub runners are IPv4-only. `link` sets up the pooler
connection instead.

`npm run deploy` still works from a laptop and is the escape hatch when CI
cannot run. Prefer the pipeline: a manual deploy bakes in whatever is in your
local `.env`, which is how production and `main` drift apart.

Nitro writes its own `wrangler.json` into `.output/server/` during the build
and a redirect at `.wrangler/deploy/config.json`, so `wrangler deploy` from
the repo root uses the generated config rather than the `wrangler.jsonc`
checked in here. That matters: the generated one adds the
`no_nodejs_compat_v2` compatibility flag, which the checked-in file does not.
Wrangler prints which config it picked; `npx wrangler deploy --dry-run` shows
it without deploying.

### Where the credentials live

`@nuxtjs/supabase` reads `SUPABASE_URL`/`SUPABASE_KEY` **at build time** and
bakes them into the bundle. Nitro can override those at runtime, but only via
variables carrying the exact `NUXT_PUBLIC_` prefix.

CI builds with the production values, so what ships is already correct and
**the Worker needs no runtime secrets**. That is a deliberate choice: two
places holding the same value is two places that can disagree, and this
project has already been bitten by it — a stale `NUXT_PUBLIC_APP_VERSION`
secret kept overriding the built-in version, so `/api/health` reported a
commit that was no longer anywhere near `main`.

If you ever do set a Worker secret, remember it wins over whatever CI built.

Repository **variables** (not secrets — every one of these is public by
design and ships in the browser bundle; keeping them unmasked makes CI logs
readable):

| Variable | Value |
| --- | --- |
| `SUPABASE_PROJECT_REF` | the project ref, used by `supabase db push` |
| `SUPABASE_URL` | the project API URL |
| `SUPABASE_ANON_KEY` | the anon/publishable key |
| `PRODUCTION_URL` | the deployed base URL, used by the health check |

Repository **secrets**:

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → My Profile → API Tokens → template "Edit Cloudflare Workers" |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `SUPABASE_DB_PASSWORD` | the project's database password (Project Settings → Database; reset it there if it was never recorded) |

### Auth redirect URLs

Not in this repo. They live in the Supabase dashboard under **Authentication
→ URL Configuration**, and they have to be set before the first real sign-in.

`emailRedirectTo` is locale-aware — `/confirm`, `/nl/confirm` or
`/fr/confirm`, depending on where the user signed in (see
`app/pages/login.vue`). Locally this is invisible because
`supabase/config.toml`'s `additional_redirect_urls` is a glob
(`http://localhost:3000/*`) covering all three. In production, set the Site
URL to the deployed URL and the allowlist to that URL plus `/**`. Narrow it
to just `/confirm` and Dutch and French magic links silently fall back to the
Site URL, dropping the user's language — the exact bug plan 2 fixed, brought
back in production only.

`DATABASE_URL` and `NUXT_SUPABASE_SECRET_KEY` are not part of this list.
`DATABASE_URL` is used only by the test harness. The secret key is read by
`@nuxtjs/supabase` into server-side runtime config, but nothing in this app
asks for the service role yet, so it never leaves the server and is not
needed for a deploy.

(The module also accepts the older `SUPABASE_SERVICE_KEY` name, but warns on
every run that it is deprecated in favour of the key above.)
