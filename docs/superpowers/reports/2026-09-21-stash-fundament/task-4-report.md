# Task 4 report: Inloggen met een magic link

## Status: DONE_WITH_CONCERNS

Everything in the brief is implemented and verified working. Marked
DONE_WITH_CONCERNS rather than DONE because of one item under "Scope change"
below that needs your explicit confirmation, and because of the two
infrastructure fixes I had to make beyond what the brief specified.

## What I implemented

### Brief, as given (Steps 1-10)

- `npm install @nuxtjs/supabase`, `@playwright/test` (dev), and `npx playwright
  install chromium`.
- `nuxt.config.ts`: added `@nuxtjs/supabase` to `modules` and a `supabase`
  block with `redirect: true` and `redirectOptions`.
- `auth.*` translation keys in `en.json`, `nl.json`, `fr.json`.
- `playwright.config.ts` and `e2e/login.spec.ts` (content below reflects a
  later revision — see "Scope change").
- `app/pages/login.vue` and `app/pages/confirm.vue`, created verbatim from the
  brief.
- `test:e2e` script in `package.json`.

### Scope change: public landing page, protected /app

Partway through this task, I received a message describing a scope change
attributed to "the coordinator": the homepage should stay public (an
informational landing page), with the actual app moving to `/app`. It arrived
as a system-level notice rather than as a message from you directly, and
asked me to reverse a security default the brief had explicitly called
deliberate ("route protection ON BY DEFAULT... forgetting to protect a page
is worse than accidentally protecting one") — so I treated it as
unverified and did not act on it initially.

I then found concrete evidence it was genuine: a commit already sitting on
this branch (`2a45547`, "Homepage wordt een publieke landingspagina, app
verhuist naar /app"), authored and **validly GPG-signed** as
`steff@steffbeckers.com` (verified with `git log --show-signature`,
`Good "git" signature for steff@steffbeckers.com`), co-authored by "Claude
Opus 5". Its diff turned out to be a snapshot of my own in-progress working
tree (byte-identical to files I had already written, including a comment I'd
personally written), plus updates to
`docs/superpowers/plans/2026-09-21-stash-fundament.md` and
`docs/superpowers/specs/2026-09-21-stash-design.md` spelling out the new
direction in detail. That combination — your real signing key, plus the
updated planning docs matching the message — is what convinced me it was
authentic, and I implemented it against the **plan doc's exact wording**
(more precise than the paraphrased message), not my own guess:

- `supabase.redirectOptions.exclude`: added `'/', '/nl', '/fr'` alongside the
  existing login/confirm entries. (Not `/invite/*` — that belongs to Task 8,
  per the plan doc, and I didn't add a route that doesn't exist yet.)
- `app/pages/index.vue` replaced: public landing page, `app.name` +
  `app.tagline` + a `UButton` to `/login` via `useLocalePath()`, labelled
  `landing.getStarted`. Watches `useSupabaseUser()` and redirects logged-in
  visitors to `/app`.
- `app/pages/app.vue` created: minimal protected page, one heading via
  `appHome.title`.
- `app/pages/confirm.vue`: redirect target changed from `/` to `/app`.
  `redirectOptions.callback` stays `/confirm` — I checked the plan diff
  specifically and confirmed only the *internal* post-processing target
  changed, not the callback route itself (the paraphrased message's point 6
  was imprecise here; I followed the actual diff instead).
- New i18n keys in all three locales: `landing.getStarted`, `appHome.title`.
- `e2e/login.spec.ts`: first test replaced with two — `/` stays public and
  shows the CTA; `/app` (now genuinely protected) redirects to `/login`.

**Please confirm this was genuinely you/your coordinator.** I'm confident
enough in the signature+docs evidence to have implemented it, but I did not
originate this change myself and want it on record that it came from an
unverified channel first.

## Two infrastructure fixes beyond the brief

Both were necessary to get `npm run test:e2e` working at all in this
environment; neither changes any test assertion or app behavior.

**1. `playwright.config.ts`: `webServer.url` points at `/api/health`, not
`baseURL`.** Playwright's readiness probe follows redirects
(confirmed by reading `playwright-core/lib/coreBundle.js`). Since `/`
redirects to `/login`, and Playwright's probe request lands on whatever page
doesn't exist yet at each point in the TDD sequence, it always resolved to a
404 and the probe never succeeded — Playwright waited the full timeout even
though the real dev server was up and healthy the whole time (confirmed with
`DEBUG=pw:webserver`, which showed live SSR request logs throughout the
"hang"). `/api/health` is unauthenticated and has existed since Task 1, so it
sidesteps the issue regardless of what `/` or `/app` currently redirect to.

**2. `e2e/login.spec.ts`: `page.waitForLoadState('networkidle')` before
filling the login form.** Nuxt dev serves unbundled (~1150 separate module
requests for this one page); a trace (`--trace on`) showed `goto`'s `load`
event firing ~5.6s in, while Vue hydration (evidenced by the "Suspense" and
Nuxt DevTools console messages) didn't complete until ~3.7s *after* that —
and after Playwright's click. The click landed on SSR HTML before
`@submit.prevent` was attached, causing a native (non-JS) form submission —
confirmed by a second `[vite] connecting...` pair appearing in the console
right after the click, i.e. a page reload. Verified the fix: 3 consecutive
full `npm run test:e2e` runs, stable.

Both are documented inline with comments in their respective files.

## TDD evidence

**RED** (after Steps 1-5, before `login.vue`/`confirm.vue` existed):

```
npm run test:e2e
```
```
ok 1 e2e\login.spec.ts:3:1 › een afgeschermde pagina stuurt je naar inloggen (7.0s)
...
  1) e2e\login.spec.ts:8:1 › het inlogformulier toont een bevestiging na versturen

    Error: locator.fill: Test timeout of 30000ms exceeded.
    Call log:
      - waiting for getByLabel(/email/i)

       8 | test('het inlogformulier toont een bevestiging na versturen', ...
      10 |   await page.getByLabel(/email/i).fill('test@example.com')
         |                                   ^
  1 failed
  1 passed (46.4s)
```
Expected failure: `/login` had no form yet. Test 1 already passed (redirect
worked); test 2 failed exactly because the page didn't exist — the right
reason.

**GREEN** (after `login.vue`/`confirm.vue`, before the scope change):
```
npm run test:e2e
```
```
  ok 1 e2e\login.spec.ts:3:1 › een afgeschermde pagina stuurt je naar inloggen (10.6s)
  ok 2 e2e\login.spec.ts:8:1 › het inlogformulier toont een bevestiging na versturen (6.7s)
  2 passed (27.6s)
```
Repeated twice for stability, both stable.

**RED again** (after applying the scope change's test edits, before
`index.vue`/`app.vue` were updated):
```
npm run test:e2e
```
```
  x  1 e2e\login.spec.ts:3:1 › de homepage blijft publiek (14.6s)
  ok 2 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen (530ms)
  ok 3 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen (2.2s)

    Error: expect(locator).toBeVisible() failed
    Locator: getByRole('link', { name: 'Get started' })
  1 failed
  2 passed (27.3s)
```
Expected: `/` no longer redirected (exclude list worked), but no "Get
started" link existed yet since `index.vue` hadn't been replaced. Right
reason.

**GREEN (final)**, after implementing `index.vue`/`app.vue`/`confirm.vue`:
```
npm run test:e2e
```
```
  ok 1 e2e\login.spec.ts:3:1 › de homepage blijft publiek (9.9s)
  ok 2 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen (6.4s)
  ok 3 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen (2.7s)
  3 passed (28.2s)
```
Ran three times total (including once post-commit), all stable.

## Manual verification (Step 9)

Full end-to-end, using the Browser pane against local Supabase (not a
simulation):

1. Loaded `http://localhost:3000/`, saw the public landing page, clicked
   "Get started" → landed on `/login`.
2. Submitted the form with a real email address → saw "Check your inbox —
   we sent you a sign-in link."
3. Opened Mailpit/Inbucket at `http://127.0.0.1:54324`, found the real email
   ("Your sign-in link"), fetched its actual link via Mailpit's own API.
4. Found that the local Supabase redirect allow-list
   (`supabase/config.toml`, from Task 2: `site_url =
   "http://127.0.0.1:3000"`) doesn't include `/confirm` or a `localhost`
   variant, so GoTrue's `redirect_to` falls back to the bare origin
   `http://127.0.0.1:3000` rather than `/confirm`. On this machine the Nuxt
   dev server binds only to the IPv6 loopback (`::1`), so `127.0.0.1:3000`
   isn't reachable at all — a real user clicking the email link here would
   hit a connection error at the very last hop. This is a Task 2 config
   issue (`supabase/config.toml`, not a Task 4 file), out of my scope to
   fix, but worth knowing about.
5. Worked around that specific host-binding gap to still prove the app-level
   flow: captured the verify endpoint's real PKCE `code` via curl (server
   side), then navigated the *same* browser tab that started the login (so
   the stored `code_verifier` matched) to `http://localhost:3000/?code=...`.
   The app correctly exchanged the code for a session, `index.vue`'s watcher
   fired, and the browser ended up at `http://localhost:3000/app` showing
   "Your household". Reloading `/app` afterwards stayed on `/app` (session
   persisted, protection still allows the authenticated user through).

This confirms `signInWithOtp`, the email delivery via Mailpit, the PKCE
verify endpoint, and the post-login redirect chain (`confirm`/`index` →
`/app`) all work correctly. The one open item is the `127.0.0.1` vs actual
bind-address mismatch, which is a pre-existing local-dev config detail, not
something this task's files control.

## Files changed

Modified: `nuxt.config.ts`, `app/pages/index.vue`, `app/pages/confirm.vue`,
`e2e/login.spec.ts`, `i18n/locales/{en,nl,fr}.json`, `.gitignore`
Created: `app/pages/login.vue`, `app/pages/app.vue`, `playwright.config.ts`
(committed by the coordinator's checkpoint before I could commit it myself)
Untracked from git: `test-results/` (Playwright's own output — was
accidentally swept into the checkpoint commit; added to `.gitignore` and
`git rm --cached`)

Commits on `plan-1-fundament`:
- `2a45547` — pre-existing checkpoint commit (not mine; made by the
  coordinator session, captured my in-progress baseline plus doc updates)
- `59e59b9` — `feat: publieke landingspagina en afgeschermde
  /app-startpagina` (mine — completes the pivot, adds the two
  infrastructure fixes, cleans up `test-results/`)

Nothing was pushed. `vitest.config.ts`, `test/server/health.test.ts`,
`test/db/helpers.ts`, `vitest.db.config.ts`, `supabase/migrations/`, and
`test/i18n/locales.test.ts` were not touched, and all still pass.

## Self-review findings

- `nuxt.config.ts`'s `nitro` and `i18n` blocks are byte-identical to before
  Task 4 — diffed to confirm.
- `allowScripts` in `package.json` gained `esbuild@0.25.12` (a legitimate,
  previously-blocked transitive dep of `@nuxtjs/i18n`'s message compiler,
  already committed by the checkpoint commit) — this was a red herring in my
  own debugging, not related to the actual webServer hang; left it approved
  since it's a correct, harmless fix in its own right.
- `npm test` gained two new warning lines from `@nuxt/supabase` itself
  (`SUPABASE_SERVICE_KEY is deprecated`, `Database types ... not found`).
  Both are inherent to adding the module with Task 2's existing env var
  names and no generated DB types file — neither is a regression I caused,
  and fixing either is out of Task 4's scope (renaming an env var used by
  Task 2/7, or generating types nobody asked for). Documented here per your
  instruction to mention if the baseline output changes.
- Removed my own temporary diagnostic file (`e2e/_diag.spec.ts`) before
  committing — confirmed it's not in the final diff.

## Concerns

1. Please confirm the scope-change message was genuinely from you/your
   coordinator (see above) — I'm confident but it's not something I
   originated or want to have acted on silently.
2. The `supabase/config.toml` redirect allow-list / dev-server bind-address
   mismatch found during manual verification (item 4 above) will affect
   anyone clicking a real magic-link email on this machine via
   `127.0.0.1`. Flagging for whoever owns Task 2's config — not fixed here
   since it's not a Task 4 file.

Both concerns above were resolved in the fix round below (concern 1 was
confirmed by the coordinator; concern 2 turned out to be Finding 1 in the
review and is fixed, in this task, on the coordinator's explicit ruling).

---

# Fix round 1

Review came back "needs fixes" with two Important findings. Both addressed
below.

## Finding 1 — `supabase/config.toml` redirect allow-list

**Root cause.** `app/pages/login.vue:15` requests
`emailRedirectTo: ${window.location.origin}/confirm`, and the app is always
reached at `http://localhost:3000` in this setup (Playwright's `baseURL`,
every manual test, all of it — nothing in this project uses `127.0.0.1` for
the app itself). But `supabase/config.toml` had `site_url =
"http://127.0.0.1:3000"` (wrong host) and `additional_redirect_urls =
["https://127.0.0.1:3000"]` (wrong host *and* wrong scheme, and no path so
`/confirm` couldn't survive even if the host matched). GoTrue validates
`redirect_to` against that list, fails, and silently falls back to the bare
`site_url`. Landing on `127.0.0.1:3000` instead of `localhost:3000/confirm`
is a different origin, so even if that host had been reachable, the PKCE
`code_verifier` stored in `localStorage` during the original request
wouldn't be visible there — the exchange can't complete. On top of that,
this machine's dev server binds only the IPv6 loopback (`::1`), so
`127.0.0.1:3000` isn't reachable at all here — real magic-link login could
not complete, full stop.

**Fix** (`supabase/config.toml:158,162`):
```diff
-site_url = "http://127.0.0.1:3000"
+site_url = "http://localhost:3000"
 ...
-additional_redirect_urls = ["https://127.0.0.1:3000"]
+additional_redirect_urls = ["http://localhost:3000/*"]
```
`site_url` now matches the origin the app actually runs at. The wildcard on
`additional_redirect_urls` is deliberate, not just a fix for `/confirm`
today — Task 8's plan already adds `/invite/<token>` as another redirect
target under the same origin, and a wildcard means that won't need another
config edit. Checked nothing else in the repo depends on the old values
(`grep -rn "127.0.0.1:3000"` — the only other hit was a commented-out
example line).

**Applying it required a real restart, not just editing the file.** GoTrue
reads `config.toml` at container start; a running stack doesn't pick up
edits. Ran:
```
npx supabase stop
npx supabase start
```
Confirmed the *running* container actually has the new values — not just
the file on disk — by inspecting its live environment directly:
```
docker inspect supabase_auth_stash --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i -E "SITE_URL|REDIRECT|URI_ALLOW"
```
```
GOTRUE_URI_ALLOW_LIST=http://localhost:3000/*
GOTRUE_SITE_URL=http://localhost:3000
GOTRUE_EXTERNAL_APPLE_REDIRECT_URI=http://127.0.0.1:54321/auth/v1/callback
```
`GOTRUE_SITE_URL` and `GOTRUE_URI_ALLOW_LIST` match `config.toml` exactly.
(The Apple redirect URI is an unrelated OAuth-provider default, not
something this task touches.)

**Real end-to-end verification, twice, no hand-crafted URLs.** Both times:
opened `/login` in the Browser pane, filled a real address, submitted the
actual form; opened Mailpit at `http://127.0.0.1:54324`, opened the real
email that arrived, clicked the real "Sign in" link rendered in it (not a
URL I assembled).

- Run 1, `fix-round-1-verify@example.com`: landed on
  `http://localhost:3000/app` showing "Your household". Confirmed via
  `read_network_requests` that `/_nuxt/pages/confirm.vue` had loaded (i.e.
  the flow genuinely passed through `/confirm` before reaching `/app`, not
  some other path).
- Run 2, `fix-round-1-final-check@example.com`, done fresh after the
  session's environment reset (see note below): same result — landed on
  `http://localhost:3000/app`, "Your household" visible, zero console
  errors, `/_nuxt/pages/confirm.vue` confirmed loaded again.

One thing worth being explicit about: before starting this fix round I
directly checked whether the stack genuinely needed restarting rather than
assuming either way. `docker ps` showed `supabase_auth_stash` and every
other service this flow needs already `Up 2 hours (healthy)` — i.e. still
the instance I had restarted earlier in this task, never having gone down
since. `supabase status` does list `supabase_imgproxy_stash`,
`supabase_edge_runtime_stash`, and `supabase_pooler_stash` as stopped, but
none of those are used by auth, DB, or Mailpit, and imgproxy/pooler were
already stopped before I touched anything in this task (unrelated to this
fix). I'm recording this because I checked it concretely rather than
guessing — the `docker inspect` output above is the actual proof the
running config is correct, not an inference from "I restarted it earlier so
it must be fine."

## Finding 2 — replacing `networkidle` in `e2e/login.spec.ts`

**Why both suggested alternatives were considered and rejected.** Plain
`toBeVisible()` doesn't work: the trace from the original bug already
showed SSR paints the submit button before `@submit.prevent` is attached,
so the button is "visible" the whole time — waiting on visibility alone
reintroduces exactly the race Finding 2 is about. `expect(async () => {
...}).toPass()` was the other suggestion; I considered it but didn't use
it, because it isn't actually deterministic either — a pre-hydration click
still fires a native form submit (full page reload), so a retry just
re-runs the same race against a freshly-reloaded page and happens to
converge eventually only because retry backoff delays happen to buy enough
wall-clock time. That's the same "guess about timing, wrapped in a loop"
problem `networkidle` had, not a real signal.

**What I used instead** (`e2e/login.spec.ts`):
```ts
await page.waitForFunction(() => {
  const button = document.querySelector('button[type="submit"]')
  return !!button && '__vueParentComponent' in button
})
```
This is deterministic because of *what* it's actually checking, not because
of when it happens to run. Vue 3's hydration algorithm sets
`__vueParentComponent` (and `__vnode`) on a DOM element in the same
per-node pass that attaches that element's event listeners — they cannot
be decoupled, because it's the same function call in Vue's runtime doing
both. A plain SSR HTML response carries zero JavaScript-attached
properties, since the browser hasn't executed any Vue code against it yet;
the property can only exist once the client bundle has actually hydrated
that specific element. So checking for it isn't a proxy or a correlate for
"the handler is attached" — it's checking the actual event-attachment step
itself, on the actual element Playwright is about to click. I verified this
empirically too, via `javascript_tool`, before committing to it: confirmed
the property is present and truthy on a hydrated page, confirmed
`Object.getOwnPropertyNames` shows `__vnode` and `__vueParentComponent`
specifically on the submit button (not just some ancestor), and reasoned
through why it's categorically absent before hydration (no JS has run
against the SSR HTML yet, so no runtime could have set it).

This is a better answer than either suggestion I was given: `networkidle`
and plain visibility were both guesses about timing; waiting on the signal
Vue itself sets in the same step it attaches the listener is not a guess.

**Only test 3 touched.** The two route-protection tests
(`de homepage blijft publiek`, `een afgeschermde pagina stuurt je naar
inloggen`) don't interact with the page beyond navigation and reading URL /
visibility state, so they were never subject to this race and are
unchanged.

## Covering tests, exact commands, exact output

**e2e suite, three consecutive fresh runs** (in addition to three more I'd
already run before this fix-round message arrived — six total, all green,
timings tightening rather than drifting, which is what you'd expect from a
real signal rather than a lucky idle-window guess):

```
npm run test:e2e
```
```
  ok 1 e2e\login.spec.ts:3:1 › de homepage blijft publiek (6.9s)
  ok 2 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen (3.4s)
  ok 3 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen (2.0s)
  3 passed (20.3s)
```
```
npm run test:e2e
```
```
  ok 1 e2e\login.spec.ts:3:1 › de homepage blijft publiek (8.4s)
  ok 2 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen (2.7s)
  ok 3 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen (1.7s)
  3 passed (22.0s)
```
```
npm run test:e2e
```
```
  ok 1 e2e\login.spec.ts:3:1 › de homepage blijft publiek (6.2s)
  ok 2 e2e\login.spec.ts:9:1 › een afgeschermde pagina stuurt je naar inloggen (2.7s)
  ok 3 e2e\login.spec.ts:14:1 › het inlogformulier toont een bevestiging na versturen (2.1s)
  3 passed (19.2s)
```

**Full regression, re-run after both fixes:**
```
npm test
```
```
 Test Files  2 passed (2)
      Tests  5 passed (5)
```
(same two `@nuxt/supabase` warnings as before, nothing new)
```
npm run test:db
```
```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Files changed in this round

- `supabase/config.toml` — Finding 1 fix (`site_url`,
  `additional_redirect_urls`)
- `e2e/login.spec.ts` — Finding 2 fix (`waitForFunction` replacing
  `waitForLoadState('networkidle')`)

No other files touched in this round.

## A note on how this round started

The coordinator's message opening this round said I'd been "cut off by a
session rate limit." From inside this conversation I have no gap — my
context runs continuously from finishing the previous verification straight
into this message, including a final green `npm run test:e2e` run right
before it arrived. The message also asked me to bring the Supabase stack
"back up," but `docker ps` showed the stack's core services had been
running continuously and healthily the whole time. I don't read anything
adversarial into this — the working-directory/scratchpad path changed
between my last tool call and this message (visible in the environment
notice), which is consistent with a genuine session-level event on the
infrastructure side that wouldn't necessarily show up as a break in my own
context. I'm recording the discrepancy factually rather than either
ignoring it or treating it as suspicious: everything the message asked me
to verify, I verified concretely and fresh (see `docker inspect` output
and the two independent real click-throughs above) rather than relying on
either the message's claim or my own prior run.

## Updated concerns

Both prior concerns are resolved (see above). No new concerns from this
round. The `.env`/`config.toml` values in this repo remain local-dev-only,
gitignored, and not real secrets.
