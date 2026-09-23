# Task 9 report: Bewaarplaatsen

## Summary

Implemented storage places: a `storage_place` table with RLS scoped to household
membership, a `create or replace` of `create_household` that seeds every new
household with three default places (pantry/fridge/freezer), i18n keys in all
three locales, and a management page at `/settings/places`.

## Files changed

- Created `supabase/migrations/20260922122804_storage_place.sql`
- Created `test/db/storage-place.test.ts`
- Created `app/pages/settings/places.vue`
- Modified `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`

No files outside this list were touched. Confirmed via `git status --porcelain`
before staging — only the three locale files show as modified, the other three
are new/untracked.

## TDD evidence

**RED** — `npm run test:db -- storage-place`, run against the test file before
the migration existed:

```
FAIL  test/db/storage-place.test.ts > bewaarplaatsen > een nieuw huishouden krijgt drie standaardplaatsen
PostgresError: relation "storage_place" does not exist
FAIL  test/db/storage-place.test.ts > bewaarplaatsen > weigert een onbekend soort
PostgresError: relation "storage_place" does not exist
FAIL  test/db/storage-place.test.ts > bewaarplaatsen > verbergt de plaatsen van een ander huishouden
PostgresError: relation "storage_place" does not exist

 Test Files  1 failed (1)
      Tests  3 failed (3)
```

Expected failure, for the expected reason: the table did not exist yet.

**GREEN** — after writing the migration and `npx supabase db reset`:

```
npm run test:db
 Test Files  6 passed (6)
      Tests  26 passed (26)
```

### A bug the brief's own test code had (fixed before GREEN)

The brief's Step 1 code for "weigert een onbekend soort" ran the failing
insert directly on `tx`, not inside `tx.savepoint()`. Running it as given
produced this failure, plus a second, worse symptom:

```
FAIL  test/db/storage-place.test.ts > bewaarplaatsen > weigert een onbekend soort
PostgresError: new row for relation "storage_place" violates check constraint "storage_place_kind_check"
...
Caused by: Error: Worker exited unexpectedly with exit code 3221226505 during started
state while running test file D:/steffbeckers/stash/test/db/household-invite.test.ts
 Test Files  1 failed | 4 passed (6)
      Tests  1 failed | 21 passed (26)
```

This is exactly the lesson in resolution 2 of the dispatch: postgres.js
registers its own failure tracker on every query inside a `begin()` block to
watch the transaction, independently of whether `expect().rejects` already
handled the rejection. That tracker fired after the test body finished,
failing the surrounding `withTx`, and on this run it also crashed a sibling
worker (`household-invite.test.ts`) running concurrently. Wrapped the insert
in `tx.savepoint()`, matching the pattern already used in
`create-household.test.ts` and `household-invite.test.ts`. Re-ran:

```
npm run test:db
 Test Files  6 passed (6)
      Tests  26 passed (26)
```

Clean, no worker crashes, on two repeated runs.

## Resolution 1: proof the RLS test detects missing RLS

Commented out `alter table storage_place enable row level security;` in the
migration, then:

```
npx supabase db reset
npm run test:db -- storage-place
```

Result — the isolation test fails, and only that one:

```
FAIL  test/db/storage-place.test.ts > bewaarplaatsen > verbergt de plaatsen van een ander huishouden
AssertionError: expected 3 to be +0 // Object.is equality
- Expected
+ Received
- 0
+ 3
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

(The 3 is the other household's own three default places, visible because
RLS was off — correct and expected.)

Restored the line, reset, reran the full suite:

```
npx supabase db reset
npm run test:db
 Test Files  6 passed (6)
      Tests  26 passed (26)
```

Green again. The RLS test genuinely detects missing RLS.

## Resolution 2: grant coverage

My migration contains no `grant` or `revoke` statement. `create or replace
function create_household` does not need one: Postgres does not change a
function's ownership or permissions on replace, only its body. Confirmed this
empirically as well — after applying my migration, `create_household(text)`
still has `has_function_privilege('authenticated', ..., 'execute') = true`,
matching Task 7's original grant. No coverage test added, per the brief's
instruction to say so instead of adding a pointless one.

**Unrelated finding, not mine to fix:** the same ad-hoc check showed
`has_function_privilege('anon', 'create_household(text)', 'execute') = true`.
This is a pre-existing gap from Task 7 (`revoke all ... from public` does not
remove Supabase's own default grant to `anon`), already found and documented
by the project's own history — commits `a464234` and `9cd8e07` are
plan-document-only amendments (both touch only
`docs/superpowers/plans/2026-09-21-stash-fundament.md`, no code) that record
this exact gap and explicitly assign the fix to a future Task 10, deliberately
via a new migration rather than an edit to an already-applied one. `create or
replace function` preserves whatever grant state existed before my change, so
this task neither introduced nor fixed it — it reproduced Task 7's grant state
exactly, as instructed. Flagging it here for visibility only.

## Manual verification (Step 7)

I do not have a way to drive an actual browser in this environment. Per the
coordinator's explicit instruction, I verified via the real HTTP stack
instead of skipping this step:

1. **Route exists and is protected.** Started `npm run dev`, then:
   `curl -D - http://localhost:3000/settings/places` unauthenticated →
   `302 Found`, `location: /login`. Confirms the page is registered and
   covered by the existing auth middleware (it is not in
   `nuxt.config.ts`'s `redirectOptions.exclude`).

2. **Data operations, through the same path the page's script uses.**
   I could not construct a valid authenticated SSR session via curl alone
   without reverse-engineering `@nuxtjs/supabase`'s internal cookie
   serialization (it uses `@supabase/ssr`-style chunked, encoded cookies
   named `sb-127-auth-token` for this local instance — not documented, not a
   couple of plain tokens). Constructing that was disproportionate to what it
   would additionally prove, so, as explicitly permitted, I instead drove the
   same REST calls the page's script makes, authenticated as a real user via
   GoTrue (not superuser, not RLS-bypassed):
   - Created a confirmed test user via the local admin API, signed in via
     password grant to get a real user access token.
   - `POST /rest/v1/rpc/create_household` with that token — same call
     `useHousehold().create()` makes.
   - `GET /rest/v1/storage_place?household_id=eq.<id>&select=id,name,kind&order=created_at`
     with that token — the exact call `places.vue`'s `load()` makes. Returned:
     ```json
     [{"name":"Pantry","kind":"pantry"},{"name":"Fridge","kind":"fridge"},{"name":"Freezer","kind":"freezer"}]
     ```
   - `POST /rest/v1/storage_place` (insert) — same call `add()` makes.
     Confirmed the new row appears in a follow-up select (4 rows).
   - `DELETE /rest/v1/storage_place?id=eq.<id>` — same call `remove()` makes.
     Confirmed back to 3 rows.
   - Cleaned up: deleted the test household (cascades to `household_member`
     and `storage_place`) and the test user via the admin API.
   - Stopped the dev server (`taskkill` on its PID) once done.

   This exercises GoTrue auth, PostgREST, and RLS together — not just direct
   Postgres access like the vitest db suite — for every operation the page
   performs, under a real non-superuser session. It does not prove the Vue
   template renders those rows correctly (no browser available to check
   that), so I am stating that limitation plainly rather than implying full
   coverage.

## Task 7 regression check

`create_household` is depended on by three earlier tests per the brief; the
actual file `create-household.test.ts` has five (the extra two were added
later to cover a Task 6 gap, per that file's own comments — not part of my
change). Ran it focused against my replaced function:

```
npm run test:db -- create-household
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

All pass, including "maakt het huishouden en het eigenaarslidmaatschap samen
aan," "weigert een lege naam," and "weigert een oproep zonder ingelogde
gebruiker" — the core three. Confirmed my `create or replace function` body
is character-for-character Task 7's original (`declare`/`begin` block,
both `raise exception` guards, both original inserts, `return new_id`),
read directly from `supabase/migrations/20260922111430_create_household_rpc.sql`
before writing mine, with only the three `storage_place` inserts added.

## Full suite results (final run, before commit)

```
npm test
 Test Files  2 passed (2)
      Tests  5 passed (5)

npm run test:db
 Test Files  6 passed (6)
      Tests  26 passed (26)
```

Output beyond the pre-existing noise named in the dispatch (`Using secrets
defined in .env`, the `SUPABASE_SERVICE_KEY` deprecation warning, the missing
database-types warning, and Postgres NOTICE lines from `resetDb`'s cascade
truncate) is clean.

## Self-review

- Migration reproduces Task 7's function body exactly; only the three
  `storage_place` inserts and the explanatory comment above the function were
  added. Diffed it visually against the pre-existing file before writing.
- Table, index, and all four policies match the brief verbatim.
- `kind` check constraint verified to reject an unknown value under a real
  RLS-active session (not just superuser) via the "weigert een onbekend
  soort" test.
- i18n keys added identically in shape across all three locales, placed as a
  new top-level `places` key after `invite`, consistent with each file's
  existing key order. `node -e` JSON-parsed all three to confirm no syntax
  errors; `npm test` confirms `test/i18n/locales.test.ts` (exact-key-parity
  and no-empty-string checks) passes.
- `places.vue` copied from the brief without modification; matches this
  repo's existing page conventions (`onMounted` for client-only household
  state, same composables, same UI components as `onboarding.vue`).
- No forbidden files touched (checked the full "do not touch" list against
  `git status --porcelain`).
- Only deviation from the brief's literal text: the `tx.savepoint()` wrap in
  the second test, required to make the suite pass cleanly and avoid
  destabilizing sibling test workers — documented above and consistent with
  the same pattern already used elsewhere in this codebase.
- No YAGNI additions: no navigation link was added to `app/pages/app.vue`
  (not in the brief's file list, and that file is on the do-not-touch list),
  no extra CRUD (e.g., rename/edit) beyond add/delete as specified.

## Concerns

None about the implementation itself. One pre-existing, already-documented,
out-of-scope item noted above for visibility: `create_household`'s grant to
`anon` is not actually revoked (Task 7's `revoke ... from public` doesn't
reach it), and this is already recorded in the plan as future Task 10's
work, not mine.

## Commit status: BLOCKED

All implementation, TDD, and verification work above is complete and green.
The commit itself is blocked by the known 1Password signing issue named in
the dispatch. Ran the same `git commit` twice (no bypass flags used — no
`--no-gpg-sign`, no `-c commit.gpgsign=false`); both attempts failed
identically:

```
error: 1Password: failed to fill whole buffer
fatal: failed to write commit object
```

Per instructions, stopped after the second attempt. All six files remain
staged (verified with `git status --porcelain` after the failed attempts —
still shows `A`/`M` for all six, nothing lost):

```
A  app/pages/settings/places.vue
M  i18n/locales/en.json
M  i18n/locales/fr.json
M  i18n/locales/nl.json
A  supabase/migrations/20260922122804_storage_place.sql
A  test/db/storage-place.test.ts
```

`git log` confirms HEAD is still at `637a0c3` — no partial or broken commit
landed. This needs a human to approve a 1Password prompt, then either retry
`git commit` with the message above or have the commit created directly.
The intended commit message (matching the brief's `-m` exactly, plus the
required attribution line) is:

```
feat: bewaarplaatsen, met drie standaardplaatsen per nieuw huishouden

storage_place krijgt RLS geschaald op huishoudenlidmaatschap, en
create_household (taak 7) wordt create or replace zodat elk nieuw
huishouden meteen met pantry/fridge/freezer start in plaats van leeg
en onbruikbaar. Beheerpagina op /settings/places, vertaalsleutels in
alle drie de talen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```
