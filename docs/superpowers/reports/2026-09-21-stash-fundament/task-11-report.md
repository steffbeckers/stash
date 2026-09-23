# Task 11 report: De uitnodigingsflow werkend maken

## Summary

Implemented every step of the brief (1–11): exported the shared e2e helpers,
wrote the failing invite e2e test first, threaded a guarded `redirect` query
parameter through `login.vue` and `confirm.vue`, added the `householdSettings`
locale keys (with corrected French accents), created
`app/pages/settings/household.vue` so `HouseholdInvites.vue` is finally
rendered somewhere, fixed the three silently-discarded-`error` call sites
(`HouseholdInvites.vue`, `app/pages/app.vue`, `app/pages/settings/places.vue`),
and added the open-redirect regression test. Full e2e suite is green (8/8),
unit tests green (5/5), db tests green (34/34).

An invited person who has no account now really does end up a household
member: owner creates a link on `/settings/household` → guest clicks it →
guest is bounced to `/login?redirect=/invite/<token>` → guest signs in →
the magic link lands back on `/invite/<token>` (not `/app`) → guest sees the
household name. This exact path is what `e2e/invite.spec.ts` exercises
against the real local Supabase/Mailpit stack, not a mock.

Two deviations from the brief's literal text were necessary; both are
explained in detail under "Deviations from the brief" below:

1. The brief's given `e2e/invite.spec.ts` code is missing hydration waits
   that this codebase's own established convention (used throughout
   `onboarding.spec.ts` and `login.spec.ts`) requires after every
   `page.goto()` that's followed by a fill/click. Confirmed by direct
   reproduction: the test failed on its first run with a raw HTML form GET
   submission, not the brief's anticipated failure.
2. Playwright 1.63 hard-refuses to run a test file that imports another
   recognized test file ("test file ... should not import test file ...",
   unconditional, no config escape hatch). Exporting the helpers directly
   from `onboarding.spec.ts` (as the brief's Step 1 literally describes) is
   therefore incompatible with Step 9's requirement that the full suite pass
   together. Resolved by extracting the three shared helpers into a new,
   non-test module, `e2e/helpers.ts`, imported by both spec files.

## Files changed

Matches the brief's file list exactly, plus the one necessary addition
(`e2e/helpers.ts`) explained above:

- Modified: `app/pages/login.vue`
- Modified: `app/pages/confirm.vue`
- Modified: `app/components/HouseholdInvites.vue`
- Modified: `app/pages/app.vue`
- Modified: `app/pages/settings/places.vue`
- Modified: `e2e/onboarding.spec.ts`
- Modified: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Created: `app/pages/settings/household.vue`
- Created: `e2e/invite.spec.ts`
- Created: `e2e/helpers.ts` (not in the brief's list — see deviation 2 above)

Confirmed via `git status --porcelain` before staging: exactly these 12
files. Nothing on the "do not touch" list (`vitest.config.ts`,
`vitest.db.config.ts`, `test/server/health.test.ts`,
`test/i18n/locales.test.ts`, `nuxt.config.ts`, `supabase/config.toml`,
`test/db/helpers.ts`, `supabase/migrations/**`) was opened for editing.
`e2e/login.spec.ts` was left untouched (not in the brief's file list, has
its own pre-existing inline hydration-wait duplicate — out of scope here).

## TDD evidence

**RED (attempt 1)** — `npm run test:e2e -- invite`, run right after Step 2's
verbatim test code and Step 1's exports, before touching `login.vue`,
`confirm.vue`, or creating `settings/household.vue`:

```
Error: expect(locator).toBeVisible() failed
Locator: getByText('Uitnodigingshuis')
...
Call log:
  - waiting for "http://localhost:3000/onboarding?name=Uitnodigingshuis" navigation to finish...
  - navigated to "http://localhost:3000/onboarding"
  - navigated to "http://localhost:3000/onboarding?name=Uitnodigingshuis"

  1 failed
```

This is **not** the brief's anticipated failure. The URL
`/onboarding?name=Uitnodigingshuis` is the signature of a raw, non-JS HTML
form GET submission — the exact hydration race documented in this
codebase's own comments (`e2e/onboarding.spec.ts`'s `waitForHydration`,
`e2e/login.spec.ts`'s inline equivalent): Nuxt dev serves unbundled, `load`
fires long before Vue hydrates and `@submit.prevent` attaches, so a click
before that point falls through to a plain form submit. The brief's Step 2
code omits the `waitForHydration` call that the codebase's own passing
`onboarding.spec.ts` test uses immediately after every `page.goto()` that
precedes a fill/click. I added the missing waits (see Deviations) rather
than reproduce a known-flaky pattern.

**RED (attempt 2, for the right reason)** — same command, after adding the
hydration waits:

```
[WebServer]  WARN  [console.warn] [VUE_ROUTER_R0004] No match found for location with path "/settings/household"
[WebServer]  WARN  [console.warn] ssr:warn [VUE_ROUTER_R0004] No match found for location with path "/settings/household"
  ...
  Error: page.waitForFunction: Test timeout of 30000ms exceeded.
    at waitForButtonHydration (D:\steffbeckers\stash\e2e\invite.spec.ts:9:14)
  1 failed
    e2e\invite.spec.ts:15:1 › een uitgenodigde zonder account wordt na inloggen lid
  3 passed (51.7s)
```

The console output is unambiguous: `/settings/household` does not exist
(Vue Router logs "No match found" on both SSR and client). My defensive
button-hydration wait timed out because the 404 fallback page has no
`<button>` at all — the same root cause the brief names ("de knop wordt
nooit gevonden"), just surfaced through a stricter wait. This matches
Step 3's expectation: fails because `/settings/household` doesn't exist,
not because of test flakiness. The three pre-existing `onboarding.spec.ts`
tests still passed, confirming the RED state was isolated to the new page.

**GREEN** — `npm run test:e2e`, after Steps 4–8b (login.vue, confirm.vue,
locale keys, settings/household.vue, HouseholdInvites.vue, app.vue,
places.vue):

```
Running 7 tests using 3 workers

  ok 1 e2e\login.spec.ts:3:1 › de homepage blijft publiek (6.1s)
  ok 4 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen (3.4s)
  ok 5 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen (2.1s)
  ok 2 e2e\onboarding.spec.ts:4:1 › een nieuwe gebruiker belandt op onboarding en kan een huishouden starten (12.8s)
  ok 6 e2e\onboarding.spec.ts:15:1 › een gebruiker zonder huishouden wordt vanaf de app-startpagina doorgestuurd (2.7s)
  ok 3 e2e\invite.spec.ts:15:1 › een uitgenodigde zonder account wordt na inloggen lid (16.7s)
  ok 7 e2e\onboarding.spec.ts:22:1 › een ingelogde gebruiker op de landingspagina belandt in de app (2.3s)

  7 passed (25.1s)
```

This is Step 9's full-suite run (`login.spec.ts` ×3 + `onboarding.spec.ts`
×3 + the new `invite.spec.ts` test ×1), before Step 10 added the
open-redirect test.

**Step 10 GREEN** — `npm run test:e2e -- invite`, after adding the
open-redirect test:

```
Running 2 tests using 1 worker
  ok 1 e2e\invite.spec.ts:15:1 › een uitgenodigde zonder account wordt na inloggen lid (12.4s)
  ok 2 e2e\invite.spec.ts:52:1 › een externe redirect wordt genegeerd (1.9s)

  2 passed (21.2s)
```

## Full verification (run once before committing)

- `npm test` → `Test Files 2 passed (2)`, `Tests 5 passed (5)`.
- `npm run test:db` → `Test Files 7 passed (7)`, `Tests 34 passed (34)`.
- `npm run test:e2e` → `Running 8 tests using 3 workers`, all 8 `ok`
  (`login.spec.ts` ×3, `onboarding.spec.ts` ×3, `invite.spec.ts` ×2),
  `8 passed (23.6s)`.

Re-ran `npm run test:e2e -- invite` once more after the deliberate
guard-bypass-and-revert described below, to confirm the revert left the real
implementation intact: `2 passed (20.4s)`.

## What the open-redirect test proved

`e2e/invite.spec.ts`'s `'een externe redirect wordt genegeerd'` test passed
for both forms:

- **`https://example.com/phishing`** (absolute external URL): `login.vue`'s
  guard (`value.startsWith('/') && !value.startsWith('//')`) evaluates
  `startsWith('/')` as `false` for a string beginning `https:`, so
  `redirectTo.value` is `null` and `submit()` never calls
  `target.searchParams.set('redirect', ...)`. The `emailRedirectTo` sent to
  Supabase is plain `${origin}/confirm`. The test fetched the *real* magic
  link from Mailpit and asserted `not.toContain('example.com')` — proving
  the malicious domain never reached the outbound email at all, not just
  that it was filtered somewhere downstream.
- **`//example.com/phishing`** (protocol-relative URL): `startsWith('/')` is
  `true` here, but `!startsWith('//')` is `false`, so the guard still
  rejects it and `redirectTo.value` is `null` by the same path. Same
  assertion, same result: the magic link never contains `example.com`.

**Honest limit of what I verified, and why**: I wanted to empirically
confirm the test would actually *fail* against a broken/bypassed guard
(proving it's a real regression test, not a vacuous pass caused by
Supabase's own server-side redirect allow-list — `supabase/config.toml` sets
`additional_redirect_urls = ["http://localhost:3000/*"]`, which could in
principle be the thing actually blocking `example.com`, independent of my
code). I made a temporary, clearly-commented edit to `login.vue` that bypassed
the guard, intending to run the test and immediately revert. The environment's
security classifier blocked the *test run* against that deliberately-weakened
file ("Security Weaken"). I did not attempt to work around that block — I
reverted the file immediately and confirmed via `git diff app/pages/login.vue`
that it matched the intended guarded code exactly, with no stray changes, then
re-ran the real test to reconfirm green.

So: I can state with certainty that the shipped code never places the
malicious domain in the outbound magic link, for both forms, and my
line-by-line trace of the guard's boolean logic shows exactly why. I cannot
additionally claim, from empirical proof, that this is the *only* thing
standing between the query parameter and a real phishing redirect — that
would require running the bypassed version, which was correctly denied. Given
that GoTrue's `redirect_to` handling in many configurations silently falls
back to `site_url` rather than hard-erroring, it's plausible the request would
still have succeeded either way, which is exactly why a client-side guard
that never emits the untrusted value in the first place is the right fix
regardless of what Supabase does server-side.

## Deviations from the brief

### 1. Added `waitForHydration` calls the brief's Step 2/10 code omits

The brief's given `e2e/invite.spec.ts` code does not call `waitForHydration`
after `page.goto('/onboarding')`, after the guest lands on `/login`, or (in
Step 10) after `page.goto('/login?redirect=...')`. I reproduced the resulting
flake directly (see RED attempt 1 above): a raw HTML form GET submission
instead of the Vue handler running. I added:

- `waitForHydration(page)` after `page.goto('/onboarding')` and after the
  guest's `guest.goto(link)` → `/login` redirect (both pages have a
  `type="submit"` button, so the existing, unmodified `waitForHydration`
  check applies unchanged).
- A new, small, **local** (not exported) `waitForButtonHydration` in
  `invite.spec.ts` for the `/settings/household` → "Create invitation link"
  click, because that button is a plain `@click` handler outside a `<form>`
  with no `type="submit"` attribute (confirmed by reading
  `node_modules/@nuxt/ui/dist/runtime/components/Button.vue`: `:type="props.type"`
  renders no `type` attribute at all when the prop isn't passed, so the
  existing submit-specific selector would never match on this page). I did
  not generalize the shared `waitForHydration` itself, to avoid any risk of
  changing behavior for its existing call sites.
- Added the same wait to both `page.goto('/login?redirect=...')` calls in
  the Step 10 test, for the same reason.

None of this changes what the tests assert — only when they're allowed to
interact with a page, matching the codebase's own established, working
convention instead of reproducing a latent flake.

### 2. Extracted shared e2e helpers into `e2e/helpers.ts` instead of exporting from `onboarding.spec.ts`

Following the brief's Step 1 literally (export `signIn` and the Mailpit
helper directly from `onboarding.spec.ts`, import into `invite.spec.ts`)
made `npm run test:e2e` (the full suite, Step 9's explicit requirement) fail
immediately at file-load time:

```
Error: test file "invite.spec.ts" should not import test file "onboarding.spec.ts"
```

Traced to `node_modules/playwright/lib/runner/index.js`: Playwright
unconditionally rejects any test file importing another file that also
matches the test glob, with no config flag to disable it. This only
surfaces when both files are loaded together (a filtered run like
`npm run test:e2e -- invite` never loads `onboarding.spec.ts`, which is why
it wasn't caught until the full-suite run). The brief's own stated intent —
"Kopieer ze niet — twee versies van een inloghelper lopen gegarandeerd uit
elkaar" — is about avoiding duplication, not about the specific file the
helpers live in. I moved `signIn`, `readLatestMagicLink`, and
`waitForHydration` into a new `e2e/helpers.ts` (plain module, doesn't match
Playwright's test glob), with a comment explaining why the file exists.
Both `onboarding.spec.ts` and `invite.spec.ts` now import from it — single
source of truth preserved, full suite runs together.

### 3. Renamed `waitForMagicLink` to `readLatestMagicLink`

The brief's Step 1 describes the Mailpit helper by behavior only ("de
Mailpit-hulpfunctie die de magic link ophaalt"); the actual function in
`onboarding.spec.ts` was named `waitForMagicLink`. The brief's own verbatim
Step 2/10 code imports `readLatestMagicLink`. Renamed (one identifier, one
internal call site in `signIn`, no behavior change) so the brief's given test
code works as written rather than duplicating the helper under a second
name.

## Self-review findings

- Re-read every modified/created file against the brief's given code
  block; `login.vue`, `confirm.vue`, `settings/household.vue`,
  `HouseholdInvites.vue`, `app.vue`, `places.vue`, and all three locale
  files match verbatim (French accents corrected per the brief's own
  instruction: `Ménage`, `Cela a échoué. Veuillez réessayer.` — verified by
  loading the JSON in Node and printing the parsed strings, not just eyeballing
  the file).
- No scope creep: did not add a household switcher, did not touch
  `e2e/login.spec.ts`'s pre-existing duplicate hydration-wait logic, did not
  add `try`/`catch` to `settings/household.vue`'s `refresh()` call (the brief
  scoped that fix to `app.vue` specifically, calling it out as "the app's
  home page, everyone hits it" — `settings/household.vue` wasn't named for
  that fix and I didn't extend it there on my own).
- Test output is pristine beyond the six pre-recorded noise lines **and one
  new, pre-existing issue surfaced by this task's own goal**: making
  `HouseholdInvites.vue` reachable for the first time exposed
  `[intlify] Not found 'short' key in 'en' locale messages` — that
  component's existing (Task 8, unmodified by me) call to
  `d(new Date(invite.expires_at), 'short')` has never had a matching
  `datetimeFormats` config anywhere in the project (confirmed: no
  `i18n.config.ts` file exists, and grepping the whole repo for
  `datetimeFormats`/`numberFormats` returns nothing). This is a real,
  pre-existing defect, not something I introduced, and not fixable within
  this task's constraints (would need either a new `i18n.config.ts` or an
  edit to `nuxt.config.ts`, which is on the explicit do-not-touch list).
  Flagged as a separate background task (`task_224e3355`,
  "Configure vue-i18n 'short' datetimeFormat") rather than fixed here or
  silently ignored.
- Also observed an intermittent `Retrying fetch attempt 2 for request:
  .../household_member?...` warning in some (not all) e2e runs. This
  predates my changes — it appeared in my very first RED run, before any
  of `login.vue`/`confirm.vue`/`app.vue`/etc. existed in their new form —
  and traces to `useHousehold()`'s `refresh()` (Task 7, untouched here).
  It's non-deterministic and self-resolving (the retry succeeds), consistent
  with `supabase-js`'s own transient-failure retry behavior rather than a
  functional bug. Not flagged as a task; noted here for transparency.
- Verified the commit is actually signed (`git log -1 --show-signature`
  reported "Good \"git\" signature") and that the working tree was clean
  afterward.

## Concerns

- The open-redirect test's coverage has one honest gap: I could not
  empirically prove it would fail against a broken guard, because the
  environment correctly blocked the deliberate-weaken-and-revert experiment
  I attempted. I'm confident in the result from reading the guard's logic
  directly (see "What the open-redirect test proved" above), but flagging
  this so it's not overstated as end-to-end-verified defense-in-depth.
- `e2e/helpers.ts` is a file not in the brief's list. I believe it's the
  correct, minimal fix for a genuine tooling constraint (see Deviation 2),
  not scope creep, but it's the one place my file list differs from the
  brief's, so calling it out explicitly rather than letting a reviewer
  discover it unannounced.
- The `[intlify]` date-format warning (pre-existing Task 8 defect, now
  visible) is real user-facing breakage — the "Valid until …" text under
  each invitation link is likely blank or malformed in all three locales.
  Flagged for follow-up; not fixed here (out of this task's file scope and
  would touch a forbidden file).

## Commit

`76893f2` — `feat: uitnodigingsflow werkend van link tot lidmaatschap`, on
`plan-1-fundament`, signed, 12 files changed (257 insertions, 75 deletions).

---

# Fix round 1

Review came back "needs fixes" with three Important findings and two Minors,
all three Importants originating in the brief's own given code rather than
anything I improvised. Addressed all five below.

## Important 1 — redirect guard gap (`/\evil.example`, `/\t/evil.example`)

The hand-rolled `startsWith('/') && !startsWith('//')` check only looks at
whether the *second* character is also `/`. A backslash or a tab in that
position slips through, and browsers still treat both as protocol-relative.
Traced the reviewer's claim against the actual installed `ufo@1.6.4` source
(`node_modules/ufo/dist/index.mjs`) rather than taking it on faith:

```js
const PROTOCOL_REGEX = /^[\s\w\0+.-]{2,}:([/\\]{2})?/;
const PROTOCOL_RELATIVE_REGEX = /^([/\\]\s*){2,}[^/\\]/;
function hasProtocol(inputString, opts = {}) {
  ...
  return PROTOCOL_REGEX.test(inputString) || (opts.acceptRelative ? PROTOCOL_RELATIVE_REGEX.test(inputString) : false);
}
```

Hand-traced `PROTOCOL_RELATIVE_REGEX` character-by-character against all
seven required inputs before writing any test, to know the expected
output ahead of running it (see "Unit test results" below for the confirmed
values).

**Fix**: created `app/utils/safe-redirect.ts` exporting `safeInternalPath`,
exactly as given in the review, using `hasProtocol(value, { acceptRelative:
true })` from `ufo`. `ufo` was already present transitively (pulled in by
Nuxt/Nitro internals) but not a direct dependency — added `"ufo": "^1.6.4"`
to `package.json` and ran `npm install` to sync `package-lock.json`'s root
entry (one-line diff, no new downloads, already resolved). Confirmed
importable from `app/utils/` by the fact that the real Nuxt dev server
(started fresh by every e2e run) builds and serves it without error.

Both `login.vue` and `confirm.vue` now call `safeInternalPath(route.query.redirect)`
instead of hand-rolling the check — one shared helper, both call sites kept
(per the review: `confirm.vue` re-validating independently is intentional,
the only defence against a `/confirm?redirect=…` link sent directly to
someone already signed in).

### Unit test results (`test/utils/safe-redirect.test.ts`)

All seven forms the review specified, run via `npx vitest run
test/utils/safe-redirect.test.ts`:

| Input | Returns | Result |
|---|---|---|
| `'/app'` | `'/app'` | pass |
| `'https://evil.example'` | `null` | pass |
| `'//evil.example'` | `null` | pass |
| `'/\\evil.example'` (real backslash) | `null` | pass |
| `'/\t/evil.example'` (real tab) | `null` | pass |
| `['/app']` (array) | `null` | pass |
| `42` (number) | `null` | pass |

```
 RUN  v5.0.1 D:/steffbeckers/stash
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### E2e extension

Added two more sub-cases to the existing `'een externe redirect wordt
genegeerd'` test (same style as the original two — sequential
goto/fill/click/assert blocks in one test, reusing `example.com` as the
placeholder domain for consistency with the first two cases rather than
introducing a second placeholder): `/\example.com/phishing` and
`/\t/example.com/phishing`, both built with `encodeURIComponent` so the
literal backslash/tab survive transport correctly. Both assert the fetched
magic link `not.toContain('example.com')`. Passed — see "Full verification"
below.

**What this round could newly verify that the previous round couldn't**: no
weaken-and-revert experiment was needed this time. `safeInternalPath` is a
pure function with no side effects, so testing it directly (unit test) and
indirectly (e2e, exercising the real guarded `login.vue`) fully closes the
gap the previous round's report flagged as an honest limitation — there was
nothing dangerous to avoid testing this time.

## Important 2 — hardcoded `aria-label`

Added `invite.linkLabel` to `invite.*` in all three locale files (`en`:
"Invitation link", `nl`: "Uitnodigingslink", `fr`: "Lien d'invitation" —
each matching the existing `invite.create` string's terminology in that
language). `HouseholdInvites.vue`'s `UInput` now uses `:aria-label="t('invite.linkLabel')"`.
The e2e locator (`getByRole('textbox', { name: 'Invitation link' })`) needed
no text change — the English value is unchanged, only its source moved from
a hardcoded string to i18n — but added a comment at that locator recording
where the string now comes from, so a future reader doesn't wonder why it
wasn't touched.

## Important 3 — blank expiry date

Confirmed via the `@nuxtjs/i18n@10.6.0` source
(`node_modules/@nuxtjs/i18n/dist/module.mjs`) before writing anything: the
module auto-scans for `i18n.config.{ts,js,mjs}` inside `resolve(rootDir,
i18n.restructureDir ?? "i18n")`. This project never sets `restructureDir`,
so it defaults to `i18n` — the same directory that already holds
`locales/`. That means `i18n/i18n.config.ts` is picked up automatically;
**no change to `nuxt.config.ts` was needed**, so the lifted restriction
wasn't used. Created `i18n/i18n.config.ts` exporting `defineI18nConfig`
(auto-imported by the module, confirmed by the successful build — no import
statement needed) with a `datetimeFormats.short` entry
(`{ year: 'numeric', month: 'short', day: 'numeric' }`) for `en`, `nl`, and
`fr`.

Verified two ways:
- The `[intlify] Not found 'short' key in 'en' locale messages` warning,
  present in every previous e2e run, is gone from this round's output
  (confirmed by piping a full run through `grep -i intlify` — zero matches).
- Added `await expect(page.getByText(/Valid until .*\d{4}/)).toBeVisible()`
  to the invite e2e test, right after creating the invitation — this
  specifically distinguishes a real rendered date (which contains a 4-digit
  year) from the previous blank render (`t('invite.expiresOn', {date: ''})`
  → "Valid until" with nothing after it, which the regex would not match).
  Passed.

## Minors

- `HouseholdInvites.vue`'s `load()`: now captures `error: loadError`,
  routes it through `error.value = t('householdSettings.error')` on
  failure (early return, `invites.value` left untouched so a transient
  failure doesn't wipe a previously-loaded list), and clears `error.value`
  on success — identical shape to `create()`/`revoke()` two functions above
  it, and to `places.vue`'s `load()` from the original round.
- `app/pages/settings/household.vue`: `onMounted` now wraps `refresh()` in
  `try`/`catch`, setting a new `failed` ref on error. Template gained
  `<UAlert v-if="failed" .../>` ahead of the existing `!ready`/`activeId`
  chain (minimal change — kept the `<h1>` title always visible, only the
  section's conditional content branches on `failed` now, rather than
  restructuring the whole page to mirror `app.vue`'s shape exactly).

## Full verification (fix round)

- `npm test` → `Test Files 3 passed (3)`, `Tests 12 passed (12)` (5 + 7 new
  `safe-redirect` tests; `test/i18n/locales.test.ts` still passes with the
  new `invite.linkLabel` key present identically in all three files).
- `npm run test:db` → `Test Files 7 passed (7)`, `Tests 34 passed (34)` —
  unchanged, no database files touched this round.
- `npm run test:e2e` → `Running 8 tests using 3 workers`, all 8 `ok`
  (`login.spec.ts` ×3, `onboarding.spec.ts` ×3, `invite.spec.ts` ×2 — the
  two invite tests now cover more ground each: 4 redirect forms instead of
  2, plus the expiry-date assertion), `8 passed (42.8s)`. Explicitly
  grepped a full run for "intlify" and "error"/"fail": zero matches beyond
  the pre-recorded noise lines.

## Self-review (fix round)

- Re-verified every file in scope against the review's own given code where
  it gave exact code (`safe-redirect.ts` is verbatim what the review
  specified).
- Did not touch `nuxt.config.ts`, despite the lifted restriction — the
  auto-detection path made it unnecessary, which is the smaller, safer
  change (zero risk to the `nitro`/Workers block the review was protective
  of).
- Dismissed the background task I'd flagged at the end of the previous
  round (`task_224e3355`, "Configure vue-i18n 'short' datetimeFormat") —
  Important 3 fixed exactly that gap in this round, so the standing
  suggestion was stale.
- One unrequested side effect: running `npm install` (needed to sync
  `package-lock.json` after adding `ufo`) caused `@nuxtjs/i18n`'s `nuxt
  prepare` step to write `.vscode/settings.json` (an `i18n-ally` extension
  config, not something I authored). Left it untracked rather than staging
  it — unrelated to this fix round's scope, and not mine to decide whether
  the repo should keep editor-specific settings.
- No new scope creep: did not add a household switcher, did not restructure
  `household.vue` beyond the minimal failed-state branch, did not touch
  `e2e/login.spec.ts`.

## Concerns (fix round)

None outstanding. The one honest gap flagged in the previous round's report
(couldn't empirically prove the guard would fail if broken) is now fully
closed by the unit test — `safeInternalPath` is pure and required no
security-classifier-sensitive experiment to test directly.

## Commit (fix round)

`d5771c0` — `fix: drie reviewbevindingen uit taak 11 verhelpen`, on
`plan-1-fundament`, signed, 13 files changed (139 insertions, 21 deletions).
