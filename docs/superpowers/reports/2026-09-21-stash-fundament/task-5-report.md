# Task 5 Report: Gebruikersprofiel dat automatisch ontstaat

## Status: DONE

## What I implemented

Exactly what the brief specified, verbatim, in the two steps it scoped:

1. **`test/db/user-profile.test.ts`** — three tests, copied verbatim from the brief:
   - `ontstaat automatisch bij een nieuwe gebruiker` — creating an `auth.users` row produces exactly one `user_profile` row.
   - `start op trust_level 0 en rol user` — the auto-created profile defaults to `trust_level = 0` and `role = 'user'`.
   - `verdwijnt wanneer de gebruiker verdwijnt` — deleting the `auth.users` row cascades and removes the profile.

2. **`supabase/migrations/20260922103836_user_profile.sql`** — created via `npx supabase migration new user_profile`, content copied verbatim from the brief:
   - `user_profile` table: `user_id uuid primary key references auth.users on delete cascade`, `display_name text`, `trust_level int not null default 0 check (trust_level between 0 and 3)`, `role text not null default 'user' check (role in ('user','moderator','admin'))`, `created_at timestamptz not null default now()`.
   - RLS enabled, with a public-read `select` policy (`using (true)`) and an owner-only `update` policy (`auth.uid() = user_id` on both `using` and `with check`).
   - `handle_new_user()` trigger function (`security definer`, `set search_path = public`) that inserts a bare `user_profile` row on every new `auth.users` insert, wired via the `on_auth_user_created` `after insert` trigger.

No other files were touched. In particular I did not modify `vitest.config.ts`, `vitest.db.config.ts`, `test/server/health.test.ts`, `test/i18n/locales.test.ts`, `nuxt.config.ts`, `supabase/config.toml`, or anything under `app/`.

Per the brief's own note, I did **not** attempt to close the "user can raise their own `trust_level`/`role` via the update policy" gap — an RLS update policy applies per row, not per column, so the owner-update policy as specified still technically allows a user to update their own `trust_level`/`role` alongside `display_name`. The brief is explicit that Task 10 closes this with a column trigger; I implemented exactly what Task 5 specifies and left the gap where it belongs.

## TDD evidence

### RED — `npm run test:db` before the migration existed

Command: `npm run test:db`

Relevant failure output (three failures, one per test, all for the same reason):

```
 FAIL  test/db/user-profile.test.ts > user_profile > ontstaat automatisch bij een nieuwe gebruiker
PostgresError: relation "user_profile" does not exist
 ❯ test/db/user-profile.test.ts:10:28

 FAIL  test/db/user-profile.test.ts > user_profile > start op trust_level 0 en rol user
PostgresError: relation "user_profile" does not exist
 ❯ test/db/user-profile.test.ts:18:69

 FAIL  test/db/user-profile.test.ts > user_profile > verdwijnt wanneer de gebruiker verdwijnt
PostgresError: relation "user_profile" does not exist
 ❯ test/db/user-profile.test.ts:30:28

 Test Files  1 failed | 1 passed (2)
      Tests  3 failed | 3 passed (6)
```

This is exactly the failure the brief predicted ("Verwacht: FAIL met `relation "user_profile" does not exist`"). The pre-existing `extensions.test.ts` file (3 tests) still passed, confirming the failure was isolated to the missing table, not an environment problem.

### GREEN — after writing the migration and applying it

Commands:
```
npx supabase db reset
npm run test:db
```

`db reset` output:
```
Applying migration 20260922054325_extensions.sql...
Applying migration 20260922103836_user_profile.sql...
Finished supabase db reset on branch plan-1-fundament.
{"target":"local","version":"","message":"Reset local database."}
```

`npm run test:db` output (Postgres NOTICE lines from the `auth.users` cascade truncate omitted — see Self-review note below):
```
 Test Files  2 passed (2)
      Tests  6 passed (6)
```

All three new tests pass, and the pre-existing `extensions.test.ts` (3 tests) still passes — 6/6 total.

## Full suite run (once, before committing)

- `npm run test:db` → 2 files, 6 tests, all passed (shown above).
- `npm test` → 2 files, 5 tests, all passed:
  ```
  [warn] [@nuxt/supabase] `SUPABASE_SERVICE_KEY` is deprecated. Migrate to `NUXT_SUPABASE_SECRET_KEY`. ...
  [warn] [@nuxt/supabase] Database types configured at "~/types/database.types.ts" but file not found ...
  Using secrets defined in .env

   Test Files  2 passed (2)
        Tests  5 passed (5)
  ```
  These three informational lines are the pre-existing, already-recorded ones named in my task instructions. `npm test` touches nothing in `app/`, and I didn't modify anything there, so no new noise appeared.

## Files changed

- `D:\steffbeckers\stash\supabase\migrations\20260922103836_user_profile.sql` (new)
- `D:\steffbeckers\stash\test\db\user-profile.test.ts` (new)

## Commit

`03b40d2` — `feat: user_profile met trigger en vertrouwensniveau`, signed (verified with `git log --show-signature`), on branch `plan-1-fundament`, working tree clean afterward. Signing succeeded on the first attempt, no 1Password prompt issue.

## Self-review findings

- Diff contains only the two files the brief scoped (`git status --short` after commit showed nothing outstanding; `git diff` against the previous commit shows exactly these two additions, 67 insertions, 0 deletions elsewhere).
- Migration and test content match the brief's code blocks verbatim, as instructed ("with the exact values to use verbatim").
- The test file imports `actAs` and `enableRls` from `./helpers` but doesn't call them — this is exactly what the brief's Step 1 code block specifies verbatim, so I left it as-is rather than "fixing" it. There's no lint step in this repo (no eslint config, no pre-commit hook) that would flag or block on it, so it has no functional effect. I'm noting it here rather than silently diverging from the brief.
- The three tests run under `withTx` without calling `enableRls`, so they execute as the default (superuser) role and don't exercise the RLS policies themselves — they only verify trigger-driven creation, defaults, and cascade deletion. That matches the brief's own test code exactly; RLS access-control behavior (who can select/update) isn't asserted by this task's tests, and I didn't add tests beyond what the brief specified.
- Noise check: once `user-profile.test.ts`'s `beforeEach(resetDb)` runs, Postgres emits a batch of `NOTICE: truncate cascades to table "..."` lines (identities, sessions, mfa_factors, refresh_tokens, etc.) because `resetDb`'s `truncate table auth.users cascade` (from Task 2's `helpers.ts`) cascades into `auth` schema's own child tables. This is inherent to the existing `resetDb` helper and the `auth` schema itself — unrelated to `user_profile` — and would happen for any test that calls `resetDb`. It's not something introduced by my migration and not in scope to change (`helpers.ts` is explicitly off-limits). I mention it here for transparency since it wasn't in the pre-recorded noise list, but it's server-side informational output, not a warning or error, and does not affect pass/fail.
- Confirmed no edits landed in any of the off-limits files (`vitest.config.ts`, `vitest.db.config.ts`, `test/server/health.test.ts`, `test/i18n/locales.test.ts`, `nuxt.config.ts`, `supabase/config.toml`, `app/**`, `test/db/helpers.ts`).

## Concerns

None blocking. The only note is the pre-existing-noise item above (Postgres NOTICE spam from the auth-schema cascade truncate), which is informational only and inherent to Task 2's `resetDb`, not to this task's migration.

---

## Fix round 1

### Finding addressed

Review (Approved, one Important finding): none of the original three tests exercised RLS — `actAs`/`enableRls` were imported but never called, so all three ran as superuser. The reviewer's point: deleting `alter table user_profile enable row level security;` from the migration entirely would leave all three tests passing identically. Per the coordinator, this defect was in the plan (now corrected), not in my verbatim implementation of the original brief.

### What I changed

Appended two tests, verbatim as given by the coordinator, to the existing `describe('user_profile', ...)` block in `test/db/user-profile.test.ts`, after the third (`verdwijnt wanneer de gebruiker verdwijnt`) test:

- `laat een gebruiker het profiel van iemand anders niet wijzigen` — acts as user `mine`, enables RLS, attempts to `update user_profile set display_name = 'gekaapt' where user_id = theirs`, and asserts `result.count` is `0` (RLS silently filters the target row rather than erroring), then re-reads `theirs`'s row as superuser and asserts `display_name` is still `null`.
- `laat profielen wel lezen door andere ingelogde gebruikers` — acts as user `mine`, enables RLS, selects `theirs`'s row by `user_id`, and asserts it comes back (the select policy is intentionally `using (true)`).

No adaptation of the `result.count` assertion was needed — the `postgres` npm client (v3.4.9) returns an array-like result from a template-tag `UPDATE` with a `.count` property holding the affected-row count, and it behaved exactly as expected in both the RLS-off and RLS-on runs below. I used the coordinator's snippet unchanged.

This also resolves the plan's Minor finding: `actAs` and `enableRls` are now both used, so the two previously-unused imports are gone as a concern.

No other files changed in this fix round. The migration file was temporarily edited for the verification below and then restored to be byte-identical to the committed version (confirmed with `git diff`, no output).

### Verification that the new test actually detects missing RLS

**RLS disabled** — commented out the one line in `supabase/migrations/20260922103836_user_profile.sql`:
```sql
-- TEMP (fix-round verification, will be restored): alter table user_profile enable row level security;
```
(the two policies stayed in place, unenforced, exactly matching "RLS deleted from the migration" — a policy can exist on a table with RLS off, it just isn't applied)

Commands:
```
npx supabase db reset
npm run test:db
```

Result — the new update test failed, and only that test:
```
 ❯ test/db/user-profile.test.ts (5 tests | 1 failed) 676ms
   ❯ user_profile (5)
     × laat een gebruiker het profiel van iemand anders niet wijzigen 177ms

 FAIL  test/db/user-profile.test.ts > user_profile > laat een gebruiker het profiel van iemand anders niet wijzigen
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ test/db/user-profile.test.ts:50:28
      50|       expect(result.count).toBe(0)

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 7 passed (8)
```

`result.count` was `1` — the cross-user update succeeded without RLS — instead of the expected `0`. This is the proof the coordinator asked for: the test fails when RLS is off. (The read test, `laat profielen wel lezen ...`, correctly still passed in this run — it isn't meant to detect missing RLS, since the select policy is `using (true)` either way; its job is to catch someone locking down the select policy in the future.)

**RLS restored** — reverted the migration to the committed line (`git diff` on the migration showed no changes after reverting, confirming byte-identical):
```sql
alter table user_profile enable row level security;
```

Commands:
```
npx supabase db reset
npm run test:db
```

Result — all 8 tests passed:
```
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

### Full suite re-run after the fix

- `npm run test:db` → 2 files, 8 tests, all passed (shown above, RLS-restored run).
- `npm test` → 2 files, 5 tests, all passed, same three pre-existing informational lines as before (`SUPABASE_SERVICE_KEY` deprecation, missing `database.types.ts`, "Using secrets defined in .env"), no new noise.

### Files changed in this fix round

- `D:\steffbeckers\stash\test\db\user-profile.test.ts` (modified — two tests appended)
- `D:\steffbeckers\stash\supabase\migrations\20260922103836_user_profile.sql` (temporarily edited for verification, then restored to be identical to the committed version — no net change)

### Self-review

- `git diff` before committing showed only the intended addition to `test/db/user-profile.test.ts`; the migration file had zero diff against the previous commit.
- The two new tests are verbatim from the coordinator's message, as instructed.
- Confirmed the RLS-off run failed for the specific reason claimed (`result.count` of `1` instead of `0`), not for an unrelated error (e.g., a syntax problem or connection issue) — the error is a clean `AssertionError` from the test's own expectation, and the other 7 tests in the same run still passed, showing the environment itself was healthy.
- No changes made to any of the off-limits files.

### Concerns

None. The verification the coordinator asked for is exactly the kind of check that would have caught the original gap, and it now demonstrably catches a regression: if `enable row level security` were ever removed from this migration, `npm run test:db` fails.
