# Task 8 report: Uitnodigingslinks

Status: **DONE**

## What was implemented

Exactly the brief's file list, in order:

1. `test/db/household-invite.test.ts` — failing test first (TDD), verbatim
   from the brief except three `.rejects.toThrow()` assertions wrapped in
   `tx.savepoint(...)` (see "Deviations" below — the same pattern task 7's
   report already documented for this exact library behavior).
2. `supabase/migrations/20260922115723_household_invite.sql` — the
   `household_invite` table with RLS (owners select/delete only, no
   insert/update policy — both functions are `security definer`), plus
   `create_invite(target uuid, valid_days int, uses int) returns text` and
   `accept_invite(invite_token text) returns uuid`. Verbatim from the brief
   except two corrections described below.
3. Locale keys added to `i18n/locales/en.json`, `nl.json`, `fr.json` —
   verbatim from the brief.
4. `app/pages/invite/[token].vue` — verbatim from the brief.
5. `app/components/HouseholdInvites.vue` — verbatim from the brief.
6. `nuxt.config.ts` — only the `supabase.redirectOptions.exclude` array
   changed (added `/invite/*`, `/nl/invite/*`, `/fr/invite/*`); `nitro` and
   `i18n` blocks confirmed byte-for-byte unchanged by reading the file back
   after the edit.

`app/pages/index.vue`, `login.vue`, `confirm.vue`, `vitest.config.ts`,
`vitest.db.config.ts`, `test/server/health.test.ts`,
`test/i18n/locales.test.ts`, `supabase/config.toml`, `test/db/helpers.ts`,
and all earlier migrations were not touched. `app/pages/app.vue` was not
touched either — the brief's file list does not include it, and no step
asks to wire `HouseholdInvites.vue` into any page, so it exists as a
standalone component per the brief's scope (see "Concerns").

## Deviations from the brief's literal code, and why

Every deviation below is a mechanical fact verified directly against this
project's running Supabase stack, not a judgment call about the brief's
intent. Each is documented in a code comment at the point of the fix.

**1. `gen_random_bytes` is not resolvable under `search_path = public`.**
Running the migration verbatim failed with `function gen_random_bytes(integer)
does not exist` inside `create_invite`. Confirmed by querying `pg_extension`
and `pg_proc` directly:

```
extname   | extnamespace
pgcrypto  | extensions
```
```
proname           | nspname
gen_random_bytes  | extensions
encode / decode   | pg_catalog
gen_random_uuid   | pg_catalog (+ extensions)
```

`pgcrypto` lives in the `extensions` schema on this Supabase stack (both
local CLI and hosted, by convention — not a local-only quirk), while every
prior `security definer` function in this codebase pins
`set search_path = public`. Those earlier functions never called an
extension function from inside the function body (`gen_random_uuid()` is
only ever used as a column default, which evaluates in the session's own
search_path, not the function's), so this gap was never hit before task 8.
Fix: schema-qualify the one call site —
`encode(extensions.gen_random_bytes(24), 'base64')` — rather than widening
the trusted `search_path`, which keeps the search-path-hijacking protection
the pinning exists for fully intact. `encode`/`decode` are `pg_catalog`
(always resolvable) so needed no change.

**2. `revoke all on function ... from public` did not revoke `anon`'s
execute privilege.**
The brief's own test (`alleen ingelogde gebruikers mogen de
uitnodigingsfuncties aanroepen`) failed after the migration applied:
`expected true to be false` for `has_function_privilege('anon',
'create_invite(uuid, int, int)', 'execute')`. Confirmed the cause by reading
`pg_default_acl` directly:

```
defaclrole | defaclnamespace | defaclobjtype | defaclacl
postgres   | public          | f             | {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

This Supabase stack has `alter default privileges ... grant execute on
functions to anon, authenticated, service_role` in place, which grants
`anon` execute **directly** on every new function created in `public` —
separately from the implicit `PUBLIC` pseudo-role grant that
`revoke ... from public` removes. `revoke ... from public` alone therefore
left `anon`'s direct grant untouched. This is exactly the gap the brief's
own resolution 2 warned about ("keep it meaningful") — confirmed live, not
assumed. Fix: `revoke all on function ... from public, anon;` for both
functions. Note: `create_household` (task 7, migration I did not touch) has
the same latent gap — out of scope here per the "do not touch earlier
migrations" instruction, but worth flagging since it's a real gap in a
function already shipped.

**3. Three `.rejects.toThrow()` assertions in the test needed
`tx.savepoint(...)`.**
Run verbatim, three tests failed with the *correct* underlying Postgres
error message (`uitnodiging is verlopen`, `uitnodiging is niet meer geldig`,
`alleen een eigenaar mag uitnodigen`) surfacing as a top-level test failure
rather than a clean pass — the SQL logic was right, but `postgres.js`
propagated the caught rejection to the enclosing `sql.begin()` anyway. This
is exactly lesson 2 from the task instructions and the same root cause task
7's report already traced through `node_modules/postgres/src/index.js`.
Fix: wrap each in `tx.savepoint((sp) => sp\`...\`)`, matching the existing
precedent in `test/db/create-household.test.ts`.

## TDD evidence

**RED** — `npm run test:db` immediately after writing
`test/db/household-invite.test.ts`, before the migration existed:

```
 FAIL  test/db/household-invite.test.ts > uitnodigingen > een uitgenodigde wordt lid
PostgresError: function create_invite(uuid, integer, integer) does not exist
...
 FAIL  test/db/household-invite.test.ts > uitnodigingen > alleen ingelogde gebruikers mogen de uitnodigingsfuncties aanroepen
PostgresError: function "create_invite(uuid, int, int)" does not exist
...
 Test Files  1 failed | 4 passed (5)
      Tests  7 failed | 16 passed (23)
```

All 7 new tests failed because `create_invite`/`household_invite` didn't
exist yet (the brief anticipated `relation "household_invite" does not
exist`; the actual first error was `function create_invite(...) does not
exist` since that's the first object referenced — same root cause, the
migration not existing yet). The 4 pre-existing test files (16 tests) were
unaffected.

**GREEN** — `npm run test:db` after the migration (with both corrections
above) and the three savepoint fixes:

```
 Test Files  5 passed (5)
      Tests  23 passed (23)
```

## RLS-off / RLS-on evidence (resolution 1)

Temporarily commented out `alter table household_invite enable row level
security;` in the new migration, then `npx supabase db reset` and
`npm run test:db`:

```
 FAIL  test/db/household-invite.test.ts > uitnodigingen > een gewoon lid ziet de uitnodigingen van het huishouden niet
AssertionError: expected 1 to be +0 // Object.is equality
- Expected: 0
+ Received: 1

 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 22 passed (23)
```

The isolation test failed exactly as required — the plain member could see
the owner's invite row (1 row instead of 0) with RLS off, proving the test
genuinely detects missing RLS rather than trivially passing. All other 22
tests were unaffected (none of them depend on `household_invite`'s RLS).

Restored the line, then `npx supabase db reset` and `npm run test:db`
again:

```
 Test Files  5 passed (5)
      Tests  23 passed (23)
```

Confirmed no leftover temp markers afterward (`grep -rn "TEMP" supabase/migrations/`
→ no matches).

## Full verification before commit

- `npm run test:all` (= `npm test` + `npm run test:db`) → `Test Files 2
  passed (2)`, `Tests 5 passed (5)` for the unit/i18n suite, and
  `Test Files 5 passed (5)`, `Tests 23 passed (23)` for the db suite. Run
  twice (once mid-work, once as the final pre-commit check) — both clean.
- `npm run build` (not required by the brief's Step 9, but the two new Vue
  files aren't exercised by any test in this project — no component/e2e
  test was asked for — so I ran a production build as a sanity check for
  compile errors and unresolved auto-imports): succeeded, exit 0. Confirmed
  `[token].vue` got its own server chunk (`_token_-CR0U084k.mjs`); build
  artifacts are gitignored (`.output`, `.nuxt`, `.wrangler`) and don't
  appear in `git status`.
- Noise beyond the pre-recorded list (`Using secrets defined in .env`,
  `SUPABASE_SERVICE_KEY is deprecated`, missing-database-types notice,
  Postgres NOTICE lines from `resetDb`'s cascade truncate): none observed
  in any final run.

## Files changed

Created:
- `supabase/migrations/20260922115723_household_invite.sql`
- `app/pages/invite/[token].vue`
- `app/components/HouseholdInvites.vue`
- `test/db/household-invite.test.ts`

Modified:
- `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- `nuxt.config.ts` (only `supabase.redirectOptions.exclude`)

Commit: `9cf85d2` "feat: uitnodigingslinks met vervaldatum en beperkt
gebruik" on `plan-1-fundament`, signed (`git log --show-signature -1`
confirms "Good git signature"). Working tree clean after commit, no push.

## Self-review findings

- Diff matches the brief's file list exactly — nothing extra, nothing
  missing, confirmed via `git status --short` before staging (only the 8
  expected paths appeared).
- No stray `console.log`/debug code in any new file.
- Every user-facing string in both new Vue files goes through `t(...)`;
  the only untranslated visible text is the invite URL itself
  (`linkFor(invite.token)`), which is data, not UI copy. `npm test`
  (which runs `test/i18n/locales.test.ts`) confirms all three locale
  files stayed in key-parity.
- `create_invite`'s `uses int` parameter and the table's own `uses`
  column share a name but never collide: the parameter is only ever
  written into `max_uses`; the table's `uses` (actual usage count) is
  never referenced by name inside `create_invite`'s body. Verified no
  ambiguity error at migration-apply time or test time.
- `accept_invite` takes `select ... for update` on the invite row before
  checking expiry/uses, so two concurrent accepts against the last
  remaining use can't both succeed. Matches the "tweemaal accepteren
  verandert niets" test, which passes.
- Confirmed the RLS-off/RLS-on run above genuinely proves the isolation
  test rather than trusting the schema.
- Confirmed `household_invite` has no insert/update policy and both
  functions are `security definer`, matching the brief's own stated reason
  ("household_member deliberately has no insert policy — that is why
  accept_invite must be security definer" — same shape applies here).
- Re-read the full committed diff (`git show HEAD`) end to end after
  committing; nothing unexpected.

## Concerns

None blocking. Two things worth a second pair of eyes, both inherent to
the brief's own scope boundaries rather than something I introduced:

1. **The `redirect=/invite/{token}` round-trip is currently inert.**
   `app/pages/invite/[token].vue` sends an unauthenticated visitor to
   `/login?redirect=/invite/{token}` (verbatim from the brief), but
   `login.vue` doesn't read that query param and `confirm.vue`
   unconditionally sends every newly-authenticated user to `/app`
   regardless of query string. So today, a logged-out person clicking an
   invite link has to accept it manually a second time from `/app` after
   signing in (the link itself isn't consumed automatically post-login).
   Both files are explicitly on the "do not touch" list for this task, so
   I implemented the page exactly as briefed rather than fixing this
   myself — flagging it as a likely follow-up rather than guessing at
   scope.
2. **`create_household` (task 7) has the same `anon`-execute gap** that
   this task's new test caught for `create_invite`/`accept_invite` (see
   deviation 2 above). `create_household` does check `auth.uid() is not
   null` and raises before doing anything, so it isn't exploitable today,
   but `anon` can currently invoke it at all, which a tighter grant would
   prevent. I did not touch task 7's migration since it's outside this
   task's file list and explicitly forbidden ("do not touch earlier
   migrations").
