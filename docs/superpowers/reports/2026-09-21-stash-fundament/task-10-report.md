# Task 10 report: Het rechtenmodel dichttimmeren

## Summary

Closed the three known gaps in the permission model:

1. Added `protect_profile_privileges_trigger` (`before update on user_profile`),
   backed by `protect_profile_privileges()`. It blocks any change to `trust_level`
   or `role` whenever `auth.uid()` is not null (i.e. whenever a real logged-in
   user, not the service role or a migration, is doing the update). The existing
   row-level update policy from Task 5 still governs which *row* a user may
   touch; this trigger governs which *columns* they may change on it.
2. Added `prevent_last_owner_removal_trigger` (`before delete on
   household_member`), backed by `prevent_last_owner_removal()`. It blocks
   deleting a `household_member` row when that row is the household's last
   `owner`. It carries `when (pg_trigger_depth() = 0)` so it only fires for a
   direct delete, not for the cascade fired by deleting the parent `household`
   row (see "The trap" below).
3. `revoke execute on function create_household(text) from anon;` — closes the
   direct grant Supabase's default privileges gave `anon` at creation time in
   Task 7, which `revoke all ... from public` never reached (the same gap Task
   8 found and fixed for `create_invite`/`accept_invite`, and which Task 9's
   report flagged as pre-existing and explicitly deferred to this task).

## Files changed

- Created `supabase/migrations/20260923052618_harden_permissions.sql`
- Created `test/db/permissions.test.ts`

Confirmed via `git status --porcelain` before staging: only these two files,
both untracked/new. Nothing on the "do not touch" list was opened for editing.

## TDD evidence

**RED** — `npm run test:db -- permissions`, run against the test file (5 tests,
brief's Step 1 content, with `tx.savepoint()` added around the three
assertions that expect a hard Postgres error — see "Deviation" below) before
the migration existed:

```
 FAIL  test/db/permissions.test.ts > rechten > een gebruiker kan zichzelf geen moderator maken
AssertionError: promise resolved "[]" instead of rejecting
 FAIL  test/db/permissions.test.ts > rechten > een gebruiker kan zijn eigen vertrouwensniveau niet verhogen
AssertionError: promise resolved "[]" instead of rejecting
 FAIL  test/db/permissions.test.ts > rechten > de laatste eigenaar kan het huishouden niet verlaten
AssertionError: promise resolved "[]" instead of rejecting

 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

Exactly the brief's prediction (Step 2): first, second and fourth test fail —
for the expected reason, the mutating query succeeded instead of being
rejected, because no protection exists yet. Third ("weergavenaam wijzigen")
and fifth ("tweede eigenaar") already passed, also as predicted.

**GREEN** — after writing the migration and `npx supabase db reset`:

```
npm run test:db
 Test Files  7 passed (7)
      Tests  31 passed (31)
```

(26 pre-existing + 5 new.)

### The trap: household deletion vs. the owner trigger

Added the brief's Step 5 tests (anon-privilege check, "opheffen werkt ondanks
de eigenaarstrigger") and reran. The cascade-delete test failed exactly as the
brief warned it might:

```
 FAIL  test/db/permissions.test.ts > rechten > een huishouden opheffen werkt ondanks de eigenaarstrigger
PostgresError: een huishouden moet minstens één eigenaar houden
 Test Files  1 failed | 6 passed (7)
      Tests  1 failed | 32 passed (33)
```

`delete from household` cascades via `on delete cascade` into `household_member`,
which fires `prevent_last_owner_removal_trigger` while exactly one owner row
remains — the trigger has no way to distinguish that from a real "leave while
I'm the last owner" attempt unless told to. Fixed by adding `when
(pg_trigger_depth() = 0)` to the trigger definition, restricting it to direct
deletes only (depth 0 = not invoked from inside another trigger's execution;
the FK cascade runs the nested delete from inside the referential-integrity
trigger, so it sees depth ≥ 1 and the WHEN clause is false, letting it
through). `npx supabase db reset` + rerun:

```
npm run test:db
 Test Files  7 passed (7)
      Tests  33 passed (33)
```

All green, including both Step 5 additions.

## Resolution 1: proof all three protections are load-bearing

### Protection 1 — `protect_profile_privileges_trigger`

Commented out the `create trigger protect_profile_privileges_trigger ...`
statement in the migration, `npx supabase db reset`, ran the focused suite:

```
npm run test:db -- permissions
 FAIL  rechten > een gebruiker kan zichzelf geen moderator maken
 FAIL  rechten > een gebruiker kan zijn eigen vertrouwensniveau niet verhogen
 Test Files  1 failed (1)
      Tests  2 failed | 5 passed (7)
```

Exactly the two tests this trigger protects fail; the other five (including
the owner tests and the anon-grant test, which this trigger has nothing to do
with) still pass. Restored the trigger, reset, reran the full suite:

```
npm run test:db
 Test Files  7 passed (7)
      Tests  33 passed (33)
```

Green again.

### Protection 2 — `prevent_last_owner_removal_trigger`

Commented out the `create trigger prevent_last_owner_removal_trigger ...`
statement (including its `when` clause), `npx supabase db reset`, ran the
focused suite:

```
npm run test:db -- permissions
 FAIL  rechten > de laatste eigenaar kan het huishouden niet verlaten
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

Only that one test fails, including staying green on "een huishouden opheffen
werkt ondanks de eigenaarstrigger" (trivially true with no trigger at all) and
"een eigenaar kan wel weg als er een tweede eigenaar is" (unaffected either
way). Restored the trigger (and, while restoring, had to remove a duplicated
copy of the explanatory comment left over from the edit round-trip — see
"Self-review" below), reset, reran the full suite:

```
npm run test:db
 Test Files  7 passed (7)
      Tests  33 passed (33)
```

Green again.

### Protection 3 — `revoke execute on function create_household(text) from anon`

Checked `has_function_privilege` directly against the running database via
`docker exec supabase_db_stash psql -U postgres -d postgres -c "..."`
(bypassing the test suite entirely, so this is independent confirmation):

Before this migration (database reset to the state through Task 9's migration
only):

```
 anon | auth
------+------
 t    | t
```

After this migration:

```
 anon | auth
------+------
 f    | t
```

`anon` flips from `true` to `false`; `authenticated` stays `true` throughout.
The new test "anon mag geen enkele huishoudfunctie aanroepen" asserts exactly
this pair and passes. This is the one protection that cannot be "disabled and
reverified" the same way as the triggers without editing the migration a
third time for no new information — the before/after `has_function_privilege`
check already is the direct, load-bearing proof (the grant either exists or
it doesn't; there's no intermediate behavior to probe), so I did not also
comment out the `revoke` line.

## Full suite results (final run, before commit)

```
npm run test:all
 Test Files  2 passed (2)          (npm test: health + i18n)
      Tests  5 passed (5)
 Test Files  7 passed (7)          (npm run test:db)
      Tests  33 passed (33)

npm run test:e2e
  ok 1 e2e\login.spec.ts:3:1 › de homepage blijft publiek
  ok 2 e2e\onboarding.spec.ts:62:1 › een nieuwe gebruiker belandt op onboarding en kan een huishouden starten
  ok 3 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen
  ok 4 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen
  ok 5 e2e\onboarding.spec.ts:73:1 › een gebruiker zonder huishouden wordt vanaf de app-startpagina doorgestuurd
  ok 6 e2e\onboarding.spec.ts:80:1 › een ingelogde gebruiker op de landingspagina belandt in de app
  6 passed
```

The e2e "nieuwe gebruiker ... kan een huishouden starten" test exercises
`create_household` through the real HTTP stack (PostgREST + GoTrue + RLS) as
an `authenticated` user, not superuser — this is a real-world check that the
`anon` revoke and both new triggers don't interfere with the legitimate
happy path, on top of the vitest db-level proof.

Output beyond the pre-existing noise named in the dispatch (`Using secrets
defined in .env`, the `SUPABASE_SERVICE_KEY` deprecation warning, the missing
database-types warning, the Nuxt devtools Vite-plugin warning seen under
Playwright's webServer, and Postgres NOTICE lines from `resetDb`'s cascade
truncate) is clean.

## Deviation from the brief's literal test code

The brief's Step 1 and Step 5 code runs three assertions directly on `tx`:

```ts
await expect(tx`update user_profile set role = 'moderator' where user_id = ${userId}`).rejects.toThrow()
```

Per the dispatch's resolution 1 (postgres.js poisons the surrounding
transaction after any failed query, even one caught by
`.rejects.toThrow()`), I wrapped each of the three assertions that are
expected to raise a hard Postgres error — the two `user_profile` updates and
the last-owner `delete` — in `tx.savepoint()`, matching the existing pattern
in `create-household.test.ts` and `household-invite.test.ts` (both already in
this codebase, with the same explanatory comment style). Verified this was
necessary: with the trigger active but no savepoint, the failing query
poisons the transaction and the subsequent implicit `COMMIT` inside
`withTx`/`sql.begin` throws, failing the test even though the assertion
itself was correct. The two tests that expect success (`display_name`
update, second-owner departs) and the two Step 5 additions (neither expected
to throw) were left exactly as given, unwrapped. No other change to the
brief's test logic, values, user emails, or assertions.

## Self-review

- Migration content matches the brief's SQL verbatim for both trigger
  functions/triggers and the `revoke`, with two additions: an explanatory
  comment above the `when (pg_trigger_depth() = 0)` clause (not in the
  brief's own SQL block, added because the brief introduces the concept only
  in Step 5's prose, not as a code comment), and the `when` clause itself,
  required per the brief's own Step 5 instruction once the cascade test
  demonstrated the need.
- Caught and fixed my own mistake while restoring the owner trigger after the
  resolution-1 disable/re-enable round trip: `Edit`'s `old_string` for the
  "disable" step matched only the `create trigger ...` statement, leaving the
  4-line explanatory comment above it in place; the matching "restore" edit
  then reintroduced that same 4-line comment, duplicating it. Caught this by
  re-reading the full file before the next `db reset` (habit from not trusting
  edit tool output blindly) rather than by a failing test — the duplicate
  comment was syntactically harmless (SQL, so it would have applied and
  tested fine) but sloppy. Fixed before running the final reset and suite.
- Table/trigger names, function names, and error message text all match the
  brief exactly.
- No grant/revoke touches `create_invite`, `accept_invite`, or any function
  besides `create_household` — confirmed by rereading the diff; only the one
  `revoke` line was added, nothing to the Task 8 migration.
- Confirmed no forbidden file was opened for editing: `git status --porcelain`
  before staging showed exactly the two new files, nothing else.
- Test file's `import { withDb, ... }` includes `withDb`, which this file
  never calls — this matches the brief's Step 1 code verbatim, and the same
  unused import already exists in `household.test.ts`,
  `create-household.test.ts`, and `household-invite.test.ts` in this
  codebase, so it's a pre-existing, accepted convention here, not something I
  introduced or should "fix" unilaterally.
- No YAGNI additions: no extra tests beyond the brief's seven, no refactor of
  earlier migrations, no touching of the `app/` layer (this task is
  database-only per its own file list).

## Concerns

None. All three protections were independently shown to be load-bearing (two
via trigger-removal-and-reverify, one via direct before/after grant
inspection), the specific cascade trap the brief warned about was hit and
fixed exactly as the brief anticipated, and the full suite (unit, db, e2e) is
green with no new noise.

## Step 7 (deploy) — deliberately not performed

Per explicit instruction, I did not run `supabase link`, `supabase db push`,
or `npm run deploy`, and did not touch the live/shared Supabase project or
Cloudflare. Everything else in Step 7 that could be done locally was covered
instead: the local `npx supabase db reset` applies the migration cleanly, the
e2e suite's onboarding test logs in, starts a household, and confirms it
through the real local stack, and Task 8's existing invite-flow e2e coverage
(`household-invite.test.ts` at the db level; the app-level invite UI is out
of this task's scope) already exercises invite-link creation. The actual
deploy, live login, invite-link creation and private-window acceptance
against production is left to the controller, as instructed.

## Commit

`995f82f` — `feat: rechtenmodel dichtgetimmerd met triggers voor rol en eigenaarschap`

Signing succeeded on the first attempt (no 1Password issue this time):
`git log --show-signature -1` confirms `Good "git" signature for
steff@steffbeckers.com with ED25519 key SHA256:fVloGaZPy4RWT/tH27DWOeamM6crxMByxMWALqd6u8Q`.
Working tree clean after commit (`git status --porcelain` empty), branch
confirmed `plan-1-fundament`, no branch switch, no push.

---

# Fix round 1 (review response)

Review came back with one Critical and one Important. Both are fixed in a new
migration — `20260923052618_harden_permissions.sql` (the original, already
committed) was never edited; per the append-only rule the fix lives entirely
in a new file, `supabase/migrations/20260923055349_fix_last_owner_trigger_and_anon_grants.sql`.

## Critical: `pg_trigger_depth() = 0` bypassed by any nested cascade

The reviewer's own finding: `pg_trigger_depth() = 0` cannot distinguish "the
household itself is being destroyed" (cascade should proceed) from "a
member's `auth.users` row is being destroyed while the household lives on"
(must still be blocked) — both are nested cascades at the same depth. Deleting
a sole owner's `auth.users` row (reachable via Supabase Studio's "Delete user"
or `auth.admin.deleteUser()`, no app code) cascades into `household_member`
without the check ever running, leaving a permanently unmanageable household.

**Fix, exactly as specified:** dropped the `when (pg_trigger_depth() = 0)`
clause entirely. `prevent_last_owner_removal()` now checks whether the parent
`household` row still exists first. If it's gone, the parent is being deleted
in the same command and the membership row may go with it. If it's still
there, this is a member departing — directly or via any cascade, including
`auth.users` — and the owner-count check must hold.

One deliberate, documented deviation from the reviewer's pasted SQL: the
exception message uses `'een huishouden moet minstens één eigenaar houden'`
(with `één`), matching the original migration's wording and the rest of the
codebase's Dutch conventions, instead of the unaccented `een` in the pasted
snippet. The surrounding message text had a mangled `-- --` where the prose
elsewhere uses a real em dash, which is what a lost diacritic/em-dash
character typically looks like after going through a lossy channel — I read
that as transcription noise, not an intended wording change, since no test
depends on the exact string either way. Rewrote that one comment line cleanly
instead of reproducing the mangled dashes. If this reading is wrong, it is a
one-line fix.

### TDD: reproduced the bug against the still-committed (buggy) migration first

Added two tests to `test/db/permissions.test.ts` — the bypass regression test
and the extended anon-privilege test (see Important, below) — then ran them
against the database as it stood at commit `995f82f` (`npx supabase db
reset`, no new migration yet):

```
npm run test:db -- permissions
 FAIL  rechten > het verwijderen van de account van de enige eigenaar wordt geblokkeerd
AssertionError: promise resolved "[]" instead of rejecting
 FAIL  rechten > anon mag geen enkele huishoudfunctie aanroepen
AssertionError: anon op is_household_member(uuid): expected true to be false
 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
```

Both new tests fail against the old code, for the exact reasons expected —
the delete succeeded instead of raising, and `is_household_member`'s anon
grant is still `true`. The other 6 tests pass, including "een huishouden
opheffen werkt ondanks de eigenaarstrigger" — confirming the old version
still handles the household-delete cascade correctly, it's specifically the
`auth.users`-cascade path it misses. This *is* "the old
`pg_trigger_depth() = 0` version" the verification asked about — it's what
was actually committed, so this run needed no temporary reverting.

### GREEN after the fix migration

```
npx supabase db reset
npm run test:db
 Test Files  7 passed (7)
      Tests  34 passed (34)
```

### Explicit revert-and-reconfirm, as requested

To match the requested procedure literally (not just rely on the natural
before/after order above), I temporarily reverted only the trigger portion of
the *new, still-uncommitted* migration back to the buggy `when
(pg_trigger_depth() = 0)` form (commented out the parent-exists check in the
function body, restored the old `when` clause on the trigger — the anon-grant
fix stayed in place, verified separately below), reset, and reran:

```
npx supabase db reset
npm run test:db -- permissions
 FAIL  rechten > het verwijderen van de account van de enige eigenaar wordt geblokkeerd
AssertionError: promise resolved "[]" instead of rejecting
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

Only the bypass test fails; "een huishouden opheffen werkt ondanks de
eigenaarstrigger" still passes. Exactly the "test 1 FAILS, test 2 passes"
the reviewer asked to see. Restored the fix, reset, reran the full suite:

```
npx supabase db reset
npm run test:db
 Test Files  7 passed (7)
      Tests  34 passed (34)
```

Green again. This never touched the already-committed
`20260923052618_harden_permissions.sql` — all reverting happened inside the
new, not-yet-committed migration file.

## Important: same anon-grant gap on `is_household_member`/`is_household_owner`

Turned out to be a slightly different, slightly worse gap than the Important
item described. `create_household` (Task 7) at least had `revoke all ...
from public`, just not `from anon` — this task's original migration closed
that. But `is_household_member`/`is_household_owner` (Task 6) never had *any*
grant/revoke statement at all, so besides Supabase's direct per-role grant to
`anon`, they also still carried **Postgres's own default `EXECUTE` grant to
`PUBLIC`** (Postgres grants this automatically on `CREATE FUNCTION` unless
revoked). My first attempt — `revoke execute ... from anon` only, mirroring
the wording in the review message — left the suite red:

```
npm run test:db -- permissions
 FAIL  rechten > anon mag geen enkele huishoudfunctie aanroepen
AssertionError: anon op is_household_member(uuid): expected true to be false
```

`anon` still had `execute` *through* the untouched `PUBLIC` grant, independent
of the direct grant I'd revoked. Fixed by matching Task 8's exact pattern
instead: `revoke all on function ... from public, anon;` plus an explicit
`grant execute on function ... to authenticated;` — the explicit re-grant
matters here because these two functions are called from inside RLS policy
expressions (`using (is_household_member(id))`), evaluated as the *querying*
role itself (`authenticated` in the app), not as a security-definer function
owner, so `authenticated` must hold real `EXECUTE` on them directly.

### Before / after, independent of the test suite

Checked directly against the running database via `docker exec
supabase_db_stash psql`, bypassing the test suite entirely:

Before (database reset to commit `995f82f`, before the fix migration):

```
 mem_anon | owner_anon
----------+------------
 t        | t
```

After (with the fix migration applied):

```
 mem_anon | mem_auth | owner_anon | owner_auth
----------+----------+------------+------------
 f        | t        | f          | t
```

### Covering test broadened to all five functions

Rewrote "anon mag geen enkele huishoudfunctie aanroepen" (previously checked
only `create_household`, despite its name) to loop over
`create_household(text)`, `is_household_member(uuid)`,
`is_household_owner(uuid)`, `create_invite(uuid, int, int)`, and
`accept_invite(text)`, asserting `anon=false, authenticated=true` for each.
This is also what caught my first (incomplete) fix attempt above — the
looped test failed on exactly the two functions the fix hadn't yet reached,
and nothing else.

## Full suite, final state

```
npm test
 Test Files  2 passed (2)
      Tests  5 passed (5)

npm run test:db
 Test Files  7 passed (7)
      Tests  34 passed (34)

npm run test:e2e
  ok 1 e2e\login.spec.ts:3:1 › de homepage blijft publiek
  ok 2 e2e\onboarding.spec.ts:62:1 › een nieuwe gebruiker belandt op onboarding en kan een huishouden starten
  ok 3 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen
  ok 4 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen
  ok 5 e2e\onboarding.spec.ts:73:1 › een gebruiker zonder huishouden wordt vanaf de app-startpagina doorgestuurd
  ok 6 e2e\onboarding.spec.ts:80:1 › een ingelogde gebruiker op de landingspagina belandt in de app
  6 passed
```

`npm run test:e2e` wasn't explicitly requested for this round, but the anon-
grant fix changes `EXECUTE` privileges on functions the entire RLS-gated read
path depends on (every `household`/`household_member`/`storage_place`/
`household_invite` policy calls `is_household_member` or `is_household_owner`)
— a different code path than the db suite's direct postgres.js connection, so
I ran it for real confidence that `authenticated` traffic through PostgREST
still works, not just the vitest db suite's `set local role authenticated`.
Both exercise the real `authenticated` role either way; e2e additionally
goes through GoTrue + PostgREST.

Output clean beyond the same pre-existing noise as the original report.

## Files changed (this round)

- Created `supabase/migrations/20260923055349_fix_last_owner_trigger_and_anon_grants.sql`
- Modified `test/db/permissions.test.ts` (added the bypass regression test,
  broadened the anon-privilege test to all five functions)

`git status --porcelain` before staging showed exactly these two entries.
`20260923052618_harden_permissions.sql` was not touched.

## Self-review (this round)

- Confirmed the fix addresses the actual mechanism the reviewer described
  (parent-existence check, not a different workaround), and matches their
  pasted SQL structurally exactly, function-for-function and
  trigger-for-trigger.
- Caught my own incomplete first pass on the Important item before reporting
  it as done — the broadened test itself is what caught it, which is the
  point of writing it first.
- Confirmed no unrelated function's grants were touched: `create_household`,
  `create_invite`, `accept_invite` appear in this migration only as read-only
  entries in the test's `householdFunctions` list, not in any grant/revoke
  statement of the new migration.
- Both temporary reverts (this round's trigger revert, and the original
  round's trigger disables) happened only in migration files that were not
  yet committed at the time; `20260923052618_harden_permissions.sql` has not
  been edited since it was committed in `995f82f`.
- No scope creep: did not also add `service_role` grants (Tasks 7 and 8 don't
  either, and nothing in this codebase calls these functions as service_role),
  did not touch `create_invite`/`accept_invite`'s existing grants (already
  correct since Task 8), did not rename the test beyond what the reviewer
  asked ("anon mag geen enkele huishoudfunctie aanroepen" is now accurate as
  a name, so left as is).

## Concerns

None. Both findings are fixed, each with independent before/after evidence
(the trigger via revert-and-reconfirm on the uncommitted migration, the
grants via direct `has_function_privilege` queries against the live
database), and the full suite — including e2e, run as extra diligence beyond
what was asked — is green.

## Commit (this round)

`9671977` — `fix: laatste-eigenaartrigger en anon-restgaten uit taak 10 review`

Signed on the first attempt: `Good "git" signature for
steff@steffbeckers.com with ED25519 key SHA256:fVloGaZPy4RWT/tH27DWOeamM6crxMByxMWALqd6u8Q`.
Working tree clean, branch confirmed `plan-1-fundament`, no push.
