# Task 2 report: Supabase lokaal, migraties en een testdatabase

**Status:** DONE

## Wat is er gebouwd

1. **Supabase lokaal geïnitialiseerd** via `npx supabase init` + `npx supabase start`.
   Docker Desktop draaide al (server 29.7.2, bevestigd met `docker info`). De image-pulls
   liepen een paar keer tegen `toomanyrequests: Rate exceeded` van de registry aan, maar
   de CLI retryde vanzelf en `supabase start` sloot af met exit 0 en de volledige set
   connectiegegevens (API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY).
2. **`.env.example`** aangemaakt met de placeholdervorm uit de brief.
   **`.env`** lokaal aangemaakt met de echte sleutels uit de `supabase start`-uitvoer.
   Geverifieerd met `git check-ignore -v .env .env.example` dat `.env` genegeerd wordt en
   `.env.example` niet, en na elke `git add -A`/`git status` gecontroleerd dat `.env` nooit
   in de staged/untracked-lijst verschijnt.
3. **`test/db/helpers.ts`**: `withDb`, `resetDb`, `createUser`, `withTx`, `actAs`,
   `enableRls` — inhoudelijk exact de brief, met één noodzakelijke toevoeging (zie
   "Afwijking van de brief" hieronder).
4. **`test/db/extensions.test.ts`**: de `auth.uid()`-claimcheck plus de
   `database-extensies`-describe (pg_trgm aanwezig, `similarity()` werkt).
5. **Migratie** `supabase/migrations/20260922054325_extensions.sql`
   (`create extension if not exists pg_trgm;` / `"uuid-ossp"`) aangemaakt via
   `npx supabase migration new extensions` en toegepast met `npx supabase db reset`.
6. **Testconfiguratie gesplitst**: `vitest.db.config.ts` (nieuw, apart project,
   `fileParallelism: false`) en `vitest.config.ts` (alleen `exclude` toegevoegd — omgeving
   en de bestaande Engelstalige toelichting over `@nuxt/test-utils/e2e` ongewijzigd
   gelaten). `package.json` kreeg `test:db` en `test:all` naast de bestaande scripts.
7. **`postgres`** (v3.4.9) toegevoegd als devDependency.

## Afwijking van de brief: env-laden in helpers.ts

De brief geeft `test/db/helpers.ts` met een kale `process.env.DATABASE_URL`-check, zonder
enige vorm van `.env`-laden. Empirisch bleek dat Vite/Vitest (ook via de losse
`vitest.db.config.ts`) `.env`-variabelen **niet** automatisch in `process.env` injecteert —
alleen `VITE_`-geprefixte variabelen komen ooit in beeld, en dat is voor
`import.meta.env`, niet voor `process.env`. Ik heb dit geverifieerd door `loadEnv` in
`node_modules/vite/dist/node/chunks/node.js` te lezen: het filtert expliciet op
`prefixes` (default `VITE_`) en schrijft nergens naar het echte `process.env`, behalve
drie hardcoded uitzonderingen (`NODE_ENV`, `BROWSER`, `BROWSER_ARGS`). Zonder ingreep gaf
elke testrun `DATABASE_URL ontbreekt` — ook mét een correct ingevuld `.env`-bestand.

Oplossing: drie regels bovenaan `helpers.ts` die `process.loadEnvFile()` aanroepen
(Node 20.12+/22+ ingebouwd, geen extra dependency), in een `try/catch` zodat een
ontbrekend `.env`-bestand terugvalt op de bestaande, duidelijkere foutmelding. Getest dat
dit (a) geen experimental-warning geeft in Node v24.15.0, (b) al gezette
`process.env`-waarden niet overschrijft, en (c) op een ontbrekend bestand een vangbare
`ENOENT` geeft in plaats van een crash.

Dit stond in `helpers.ts` zelf (niet in `vitest.db.config.ts`) zodat het ook werkt voor de
kale `npx vitest run test/db --environment node`-aanroepen uit stap 4 en 6 van de brief,
die geen gebruik maken van `vitest.db.config.ts`. Zonder deze toevoeging zou geen enkele
databasetest ooit kunnen draaien via de door de brief gegeven commando's — dit is dus geen
architecturale keuze maar een mechanische noodzaak om de brief zoals geschreven te laten
werken.

## `auth.uid()`-claimvorm: bevestigd vóór de overige helpers

Zoals gevraagd is dit eerst uitgezocht, vóór `createUser`/`withTx`/`actAs`/`enableRls`
geschreven werden. Alleen `withDb` en `resetDb` stonden er al toen de checktest liep.

**Resultaat: de losse claimvorm (`request.jwt.claim.sub`) werkt.** `auth.uid()` gaf
direct de gezette UUID terug — geen `null`, dus de JSON-vorm
(`request.jwt.claims` met `JSON.stringify({ sub: userId })`) was niet nodig. `actAs`
gebruikt daarom de losse vorm, exact zoals in de brief voorgesteld als default.

```
$ npx vitest run test/db/extensions.test.ts --environment node
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

## TDD-bewijs

**RED** — `npx vitest run test/db --environment node` (vóór de migratie bestond):

```
 FAIL  test/db/extensions.test.ts > database-extensies > heeft pg_trgm beschikbaar
AssertionError: expected +0 to be 1 // Object.is equality
- Expected: 1
+ Received: 0

 FAIL  test/db/extensions.test.ts > database-extensies > kan similarity berekenen
PostgresError: function similarity(unknown, unknown) does not exist

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

Faalde om de verwachte reden: `pg_trgm` stond nog niet in `pg_extension` (0 rijen i.p.v.
1) en `similarity()` bestond nog niet als functie. De derde test (`auth.uid()`) was op dit
punt al groen, wat correct is — die hangt niet af van de migratie.

**GREEN** — na `npx supabase migration new extensions`, de SQL erin gezet, en
`npx supabase db reset`:

```
$ npx vitest run test/db --environment node
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**Eindverificatie** — beide suites samen, na het opsplitsen van de vitest-configs:

```
$ npm test
 Test Files  1 passed (1)
      Tests  2 passed (2)          # test/server/health.test.ts, ongewijzigd van taak 1

$ npm run test:db
 Test Files  1 passed (1)
      Tests  3 passed (3)          # test/db/extensions.test.ts

$ npm run test:all
 Test Files  1 passed (1)   (test)
      Tests  2 passed (2)
 Test Files  1 passed (1)   (test:db)
      Tests  3 passed (3)
```

`npm test` sluit `test/db` correct uit (geen Docker-afhankelijkheid nodig voor de gewone
suite); `npm run test:db` draait alléén de databasetests met `fileParallelism: false`.

Los van vitest heb ik `test/db/helpers.ts`, `test/db/extensions.test.ts` en
`vitest.db.config.ts` ook door `tsc --noEmit --strict` gehaald (vanaf een map buiten het
project, met expliciete `--typeRoots` naar `node_modules/@types`, omdat vitest zelf niet
type-checkt) — geen fouten.

## Gewijzigde/nieuwe bestanden

- `supabase/config.toml` (nieuw, door de CLI; geen secrets erin — alleen
  `env(...)`-placeholders en uitgecommentarieerde voorbeelden, gecontroleerd met grep)
- `supabase/.gitignore` (nieuw, door de CLI; negeert `.branches` en `.temp`)
- `supabase/migrations/20260922054325_extensions.sql` (nieuw)
- `test/db/helpers.ts` (nieuw)
- `test/db/extensions.test.ts` (nieuw)
- `.env.example` (nieuw, gecommit)
- `.env` (nieuw, lokaal, **niet** gecommit — geverifieerd)
- `vitest.db.config.ts` (nieuw, exact de brief)
- `vitest.config.ts` (gewijzigd: alleen `exclude` toegevoegd, rest ongewijzigd)
- `package.json` (gewijzigd: `test:db`, `test:all` toegevoegd, `postgres` als devDependency)
- `package-lock.json` (gewijzigd door `npm install -D postgres`)

## Self-review

- Diff van `vitest.config.ts` is één regel (`exclude: [...]`); omgeving, `defineConfig`
  en de bestaande Engelse toelichting staan er nog woordelijk zoals taak 1 ze achterliet.
- Diff van `package.json` is precies de twee gevraagde scripts plus de nieuwe
  devDependency; niets anders aangeraakt.
- `helpers.ts` bevat één inhoudelijke toevoeging t.o.v. de brief (de `loadEnvFile`-poging
  bovenaan) — hierboven toegelicht en gemotiveerd; de rest is woordelijk de brief.
- Geen overbouw: geen extra helpers, geen extra abstracties, geen ongevraagde
  configuratie-opties toegevoegd aan `vitest.db.config.ts` (die staat er woordelijk zoals
  de brief hem geeft).
- Testoutput is schoon op één punt na: `npm test` drukt `Using secrets defined in .env` af
  (van wrangler/nitro's dev-server, die nu een `.env`-bestand ziet staan). Dat is
  informatief, geen warning/error, komt niet van mijn testcode, en is een verwachte
  bijwerking van het feit dat er nu een `.env`-bestand bestaat — precies wat deze taak
  moest opleveren. Ik heb het niet onderdrukt om geen gedrag van taak 1's server-opzet aan
  te raken.
- `resetDb` leegt zowel alle `public`-tabellen (dynamisch, dus toekomstbestendig voor
  taken die nieuwe tabellen toevoegen) als `auth.users` — beide expliciet gecontroleerd
  door de code te lezen, niet alleen aangenomen.
- `git status` was schoon na de commit; `.env` stond op geen enkel moment in
  staged/untracked bestanden; de commit is gesigneerd (geverifieerd met
  `git log --show-signature`).

## Zorgen

Geen. De enige afwijking van de letterlijke broncode in de brief (de `loadEnvFile`-toevoeging
in `helpers.ts`) was noodzakelijk om de door de brief gegeven commando's daadwerkelijk te
laten slagen, is minimaal, gedocumenteerd met een Nederlandstalige toelichting in dezelfde
stijl als de rest van het bestand, voegt geen dependency toe, en is expliciet getest op
neveneffecten (geen warnings, geen overschrijven van bestaande env-vars, nette fallback bij
ontbrekend bestand).

## Bevestiging voor vervolgtaken

`auth.uid()` accepteerde de **losse claimvorm** (`request.jwt.claim.sub` via
`set_config`). `actAs` in `test/db/helpers.ts` gebruikt deze vorm. De JSON-vorm
(`request.jwt.claims`) was niet nodig.
