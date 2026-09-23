# Task 7 report: Een huishouden starten vanuit de app

Status: **DONE**

## What was implemented

Exactly the brief's file list, in order:

1. `test/db/create-household.test.ts` — failing test first (TDD), verbatim from
   the brief except two `.rejects.toThrow()` assertions wrapped in
   `tx.savepoint(...)` (see "Deviations" below).
2. `supabase/migrations/20260922111430_create_household_rpc.sql` — the
   `create_household(household_name text) returns uuid` function: `security
   definer`, validates the caller is logged in and the name isn't blank,
   inserts the `household` row and the owner's `household_member` row
   together, revokes public execute and grants it to `authenticated`. Verbatim
   from the brief.
3. `app/composables/useHousehold.ts` — the `useHousehold()` composable with
   exactly the shape the brief specifies (`households`, `activeId`, `refresh`,
   `setActive`, `create`). One necessary fix vs. the brief's literal code (see
   "Deviations").
4. Locale keys added to `i18n/locales/en.json`, `nl.json`, `fr.json` — verbatim
   from the brief.
5. `app/pages/onboarding.vue` — verbatim from the brief.
6. `app/pages/app.vue` — replaced verbatim from the brief: redirects to
   `/onboarding` in `onMounted` when the user has no household, otherwise
   shows the active household's name.
7. `e2e/onboarding.spec.ts` — same three test cases and assertions as the
   brief, but a rewritten `signIn()` helper (see "Deviations" — the brief's
   literal helper cannot work against the versions actually installed).

`app/pages/index.vue`, `app/pages/login.vue`, `app/pages/confirm.vue`,
`test/db/helpers.ts`, and Task 6's migration were not modified (Task 6's
migration was edited temporarily for the RLS-off verification below and
restored — confirmed byte-for-byte identical via `git diff`, see below).

## Deviations from the brief's literal code, and why

The brief says to use its example values verbatim, and I did wherever the
example was runnable. Three places in the example, as written, do not
actually pass against what's installed in this project. Each is a mechanical
fact I verified directly (source reading + live reproduction), not a
judgment call about the brief's intent. I fixed each and documented it in
code comments at the point of the fix.

**1. `useHousehold()`: `user.value.id` does not exist.**
`useSupabaseUser()` in the installed `@nuxtjs/supabase` (2.x) returns the
return value of `auth.getClaims()` — a JWT payload (`sub`, `email`, `role`,
...) — not the classic Supabase `User` object. Confirmed by reading
`node_modules/@nuxtjs/supabase/dist/runtime/composables/useSupabaseUser.d.ts`
(`Ref<JwtPayload | null>`) and by reproducing live in the browser: with
`user.value.id`, the household query failed with `invalid input syntax for
type uuid: "undefined"` (`.eq('user_id', undefined)` stringifies to the text
`"undefined"`). Fixed by reading `user.value.sub` instead, with a comment at
the call site.

**2. The two `.rejects.toThrow()` assertions in `create-household.test.ts`
need a savepoint.**
Run verbatim, both tests that expect `create_household(...)` to reject
(empty name, no logged-in user) failed — not because the function didn't
reject (it did, with the right message), but because `withTx` propagated
that same `PostgresError` and failed the *whole* transaction anyway, even
though the test had already caught it via `expect().rejects`. Root cause,
confirmed by reading `node_modules/postgres/src/index.js`
(`sql.begin`/`scope`/`handler`, lines ~251–297): every query issued through a
transaction-scoped `sql` gets its own `.catch()` registered by the library
itself to track `uncaughtError`, independent of whatever the test does with
the same promise. If that flag is set when the callback resolves, `begin()`
throws it regardless. Fix: run the failing call inside `tx.savepoint(...)`.
A savepoint gets its own handler/`uncaughtError` closure, so its failure
rolls back to the savepoint and is contained there — proven by the fix
turning both tests green without changing what they assert.

**3. The e2e `signIn()` helper cannot use `admin.auth.admin.generateLink()`.**
Run verbatim, all three onboarding e2e tests failed — the first timed out
after 30s waiting on `/onboarding`'s form (never got there), the other two
landed on `/login` (not authenticated). Root cause, confirmed by reading
`@supabase/ssr`'s `createBrowserClient` source
(`node_modules/@supabase/ssr/dist/main/createBrowserClient.js:44`, `flowType:
"pkce"`, set unconditionally after spreading caller options — this project's
Nuxt client is built with this function since `useSsrCookies` defaults to
`true`) and by reproducing live in the browser: visiting an
`admin.generateLink()` action_link left `useSupabaseUser()` null, with
`client.auth.initializePromise` resolving to
`{"error":{"name":"AuthPKCEGrantCodeExchangeError","message":"Not a valid
PKCE flow url."}}`. `generateLink()` produces an implicit-grant link
(`#access_token=...`) because no browser with a `code_verifier` requested
it; a PKCE-only client rejects that outright — confirmed in
`@supabase/auth-js`'s `GoTrueClient._getSessionFromURL`
(`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:3264-3277`).
Fix: `signIn()` now drives the real `/login` form (which calls
`supabase.auth.signInWithOtp` from the browser's own PKCE-aware client, so it
sets a `code_verifier`), then retrieves the resulting email from Mailpit
(the local dev stack's built-in email catcher, already running at
`127.0.0.1:54324` — confirmed via `supabase status` and `docker ps`) via its
REST API, and visits the `pkce_`-prefixed link found there. Verified this
link redirects with `?code=...` (not a hash) and correctly establishes a
session end-to-end, manually in the browser, before rewriting the test. This
is arguably *closer* to the brief's own stated intent ("Dat is dezelfde flow
als een gebruiker doorloopt" / "the same flow a user goes through") since it
exercises the real `signInWithOtp` call in `login.vue` rather than bypassing
it. It also uncovered that the onboarding form itself needed the same
hydration-wait `login.spec.ts` already documents (a bare click before Vue
hydrates submits the HTML form natively) — added a small shared
`waitForHydration()` helper used both for `/login` and `/onboarding`.

I did not touch `nuxt.config.ts` (forbidden, and wouldn't have fixed the
PKCE issue anyway — `@supabase/ssr` forces `flowType: 'pkce'` unconditionally
regardless of client config) or `app/pages/confirm.vue` (forbidden).

## TDD evidence

**RED** — `npm run test:db` after writing `test/db/create-household.test.ts`,
before the migration existed:

```
 FAIL  test/db/create-household.test.ts > create_household > maakt het huishouden en het eigenaarslidmaatschap samen aan
PostgresError: function create_household(unknown) does not exist
...
 Test Files  1 failed | 3 passed (4)
      Tests  5 failed | 11 passed (16)
```
All 5 new tests failed with the same `function create_household(unknown)
does not exist` — exactly the expected failure (the function didn't exist
yet), and the 3 pre-existing test files (11 tests) were unaffected.

**GREEN** — `npm run test:db` after the migration + the savepoint fix
described above:

```
 Test Files  4 passed (4)
      Tests  16 passed (16)
```

## RLS-off / RLS-on evidence (resolution 1)

Temporarily edited `supabase/migrations/20260922105658_household.sql`,
commenting out both `enable row level security` lines, then
`npx supabase db reset` and `npm run test:db`:

```
 ❯ test/db/create-household.test.ts (5 tests | 2 failed) 597ms
     × verbergt de ledenlijst van een ander huishouden 150ms
     × laat een buitenstaander een huishouden niet hernoemen of verwijderen 156ms
 ❯ test/db/household.test.ts (3 tests | 1 failed) 482ms
     × verbergt het huishouden van iemand anders 166ms

 FAIL  test/db/create-household.test.ts > create_household > verbergt de ledenlijst van een ander huishouden
AssertionError: expected 1 to be +0 // Object.is equality
 FAIL  test/db/create-household.test.ts > create_household > laat een buitenstaander een huishouden niet hernoemen of verwijderen
AssertionError: expected 1 to be +0 // Object.is equality
 FAIL  test/db/household.test.ts > huishoudens en RLS > verbergt het huishouden van iemand anders
AssertionError: expected 1 to be +0 // Object.is equality

 Test Files  2 failed | 2 passed (4)
      Tests  3 failed | 13 passed (16)
```

Both new isolation tests failed exactly as required — proving they detect
missing RLS on `household_member` SELECT and `household` UPDATE. (One of
Task 6's own pre-existing tests also correctly failed the same way; that's
expected, not a problem — it already covered that specific path by
analysis-turned-test.) The other 3 new tests (which test the RPC's own
validation, not table RLS) correctly kept passing, as they should.

Restored the migration (`git diff supabase/migrations/20260922105658_household.sql`
showed no diff — byte-for-byte identical to HEAD), then
`npx supabase db reset` and `npm run test:db` again:

```
 Test Files  4 passed (4)
      Tests  16 passed (16)
```

## Full verification before commit

- `npm test` → `Test Files 2 passed (2)`, `Tests 5 passed (5)`.
- `npm run test:db` → `Test Files 4 passed (4)`, `Tests 16 passed (16)`.
- `npm run test:e2e` → `6 passed` (Task 4's 3 `login.spec.ts` tests + all 3
  new `onboarding.spec.ts` tests), run twice in a row for stability, both
  clean.

Noise beyond the pre-recorded list (`Using secrets defined in .env`,
`SUPABASE_SERVICE_KEY is deprecated`, missing-database-types notice, Postgres
NOTICE lines from `resetDb`'s cascade truncate): none in the final runs. One
run mid-investigation printed a single `Retrying fetch attempt 2 for
request: .../household_member?...` warning (the module's own
`fetchWithRetry` recovering from what looks like normal PostgREST/Kong
cold-start latency); it did not reappear in either of the two subsequent
full, clean `test:e2e` runs, so I'm treating it as transient rather than a
defect — flagging it here rather than silently dropping it.

## Files changed

Modified:
- `app/pages/app.vue`
- `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`

Created:
- `app/composables/useHousehold.ts`
- `app/pages/onboarding.vue`
- `e2e/onboarding.spec.ts`
- `supabase/migrations/20260922111430_create_household_rpc.sql`
- `test/db/create-household.test.ts`

Task 6's migration (`supabase/migrations/20260922105658_household.sql`) was
temporarily edited for the RLS-off check and fully restored; it carries no
diff in the commit.

## Self-review findings

- Diff matches the brief's file list exactly — nothing extra, nothing
  missing. No stray `console.log`/debug code in any new file (checked with
  grep).
- The composable's returned shape matches the brief's required interface
  exactly (`households: Ref<Household[]>`, `activeId: Ref<string|null>`,
  `refresh(): Promise<void>`, `setActive(id): void`, `create(name):
  Promise<string>`), which is what Task 8/9 and plan 3 depend on.
- `i18n/locales/*.json` still carry the pre-existing `appHome.title` key,
  now unused since `app.vue` was replaced to use `app.name` instead (per the
  brief). Leaving it: removing it wasn't asked for, doesn't affect any test
  (the locale-parity test only checks keys match across locales, not that
  they're consumed), and pruning it unprompted felt like scope creep beyond
  "exactly what the brief specifies." Flagging it here rather than silently
  deciding either way.
- Confirmed the two new isolation tests actually exercise RLS (not just
  trust the schema) via the RLS-off/RLS-on run above.
- Confirmed `household_member` truly has no insert policy is still honored:
  `create_household` is the only path that can create a membership row, and
  it's `security definer` — this is exactly what Task 6 required and what
  the "weigert een oproep zonder ingelogde gebruiker" /
  "verbergt de ledenlijst" tests exercise.
- Re-read the full commit diff (`git show HEAD`) end to end after
  committing; nothing unexpected.

## Concerns

None blocking. The one thing worth a second pair of eyes: the e2e
`signIn()` helper now depends on Mailpit's REST API shape
(`/api/v1/search?query=to:<email>`, `/api/v1/message/<id>`), which is an
implementation detail of the local Supabase CLI's bundled mail catcher
rather than a documented, versioned Supabase API. If a future Supabase CLI
upgrade changes or removes Mailpit, this test would need updating — but
given the alternative (the brief's `admin.generateLink()` approach) is
provably incompatible with the PKCE-only client this project already has
installed, I don't see a more stable option available today without editing
files outside this task's scope (`nuxt.config.ts`, `confirm.vue`).
