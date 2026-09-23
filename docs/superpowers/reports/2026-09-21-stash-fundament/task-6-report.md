# Task 6 report: Huishoudens met row-level security

## Status: DONE

## Wat is er gebouwd

- `supabase/migrations/20260922105658_household.sql` — nieuwe migratie, verbatim
  volgens de brief:
  - tabel `household(id, name, created_at)`
  - tabel `household_member(household_id, user_id, role, joined_at)` met
    samengestelde primary key `(household_id, user_id)` en index op `user_id`
  - `is_household_member(target uuid) returns boolean` — `security definer`,
    parameternaam `target` (niet `household_id`, zoals de brief vereist)
  - `is_household_owner(target uuid) returns boolean` — zelfde patroon
  - RLS aangezet op beide tabellen, in dezelfde migratie die ze aanmaakt
  - policies: leden zien hun huishouden (select), eigenaars wijzigen/heffen op
    (update/delete), iedereen mag een huishouden starten (insert),
    leden zien de ledenlijst (select op `household_member`), eigenaars mogen
    leden verwijderen of zichzelf verwijderen (delete op `household_member`)
- `test/db/household.test.ts` — drie tests, verbatim uit de brief:
  1. een lid ziet zijn eigen huishouden
  2. het huishouden van iemand anders is onzichtbaar
  3. `is_household_member` klopt voor leden en niet-leden

Geen GRANT-statement toegevoegd: geen enkele testrun gaf `permission denied
for table household` of `household_member`. Standaardprivileges voor nieuwe
`public`-tabellen dekken de rol `authenticated` al, net als bij `user_profile`
in Task 5.

## TDD-bewijs

### RED — test geschreven vóór de migratie

Commando:
```
npm run test:db
```

Relevante output (ingekort, drie identieke fouten voor de drie nieuwe tests):
```
 FAIL  test/db/household.test.ts > huishoudens en RLS > laat een lid zijn eigen huishouden zien
PostgresError: relation "household" does not exist
 ❯ test/db/household.test.ts:10:46

 Test Files  1 failed | 2 passed (3)
      Tests  3 failed | 8 passed (11)
```
Verwacht en correct: de tabel bestond nog niet. De acht tests van de eerdere
taken (extensions, user_profile) bleven groen — dit bewijst dat de nieuwe
tests op zichzelf staan en niet toevallig meeliften op bestaande fixtures.

### GREEN — na de migratie

```
npx supabase db reset
npm run test:db
```

Output:
```
 Test Files  3 passed (3)
      Tests  11 passed (11)
```

## Resolutie 1 — bewijs dat de isolatietest RLS ook echt detecteert

Voordat ik committede heb ik de twee `alter table ... enable row level
security;`-regels in de migratie tijdelijk uitgecommentarieerd, gereset, en de
suite gedraaid.

**RLS uit** (`npx supabase db reset` gevolgd door `npm run test:db`):
```
 ❯ test/db/household.test.ts (3 tests | 1 failed) 424ms
   ❯ huishoudens en RLS (3)
     × verbergt het huishouden van iemand anders 136ms

 FAIL  test/db/household.test.ts > huishoudens en RLS > verbergt het huishouden van iemand anders
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ test/db/household.test.ts:40:27

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 10 passed (11)
```

Precies de isolatietest ("verbergt het huishouden van iemand anders") faalde,
met de juiste reden: zonder RLS zag `mine` het huishouden van `theirs` gewoon
(1 rij in plaats van 0). De andere twee nieuwe tests bleven groen, wat ook
correct is:
- "laat een lid zijn eigen huishouden zien" telt alleen hoeveel rijen er
  terugkomen, en in die test bestaat er precies één huishouden — RLS uit of
  aan maakt voor dát getal geen verschil, dus deze test was nooit bedoeld om
  het gat te vangen.
- "is_household_member klopt voor leden en niet-leden" roept nooit
  `enableRls` aan; hij toetst de `security definer`-functie rechtstreeks, die
  altijd op `household_member` mag lezen ongeacht tabel-RLS. Dat is het
  gewenste gedrag, niet een gat in de test.

**RLS terug aan** (regels hersteld, opnieuw reset, opnieuw getest):
```
npx supabase db reset
npm run test:db

 Test Files  3 passed (3)
      Tests  11 passed (11)
```

De isolatietest bewijst dus aantoonbaar wat hij beweert.

## Volledige suite vóór het committen

```
npm run test:all
```
```
 Test Files  2 passed (2)
      Tests  5 passed (5)
   (npm test — ongewijzigd; ik heb niets onder app/ aangeraakt)

 Test Files  3 passed (3)
      Tests  11 passed (11)
   (npm run test:db)
```

Output was schoon op de al bekende, vooraf gedocumenteerde ruis na: de
`SUPABASE_SERVICE_KEY is deprecated`-waarschuwing, de ontbrekende
database-types-notice, `Using secrets defined in .env`, en Postgres
NOTICE-regels van `resetDb`'s cascade-truncate (deze laatste verschenen niet
bij elke run — lijkt bufferingsgedrag, geen nieuw signaal). Geen nieuwe ruis.

## Files changed

- `supabase/migrations/20260922105658_household.sql` (nieuw)
- `test/db/household.test.ts` (nieuw)

Niets anders aangeraakt: `vitest.config.ts`, `vitest.db.config.ts`,
`test/server/health.test.ts`, `test/i18n/locales.test.ts`, `nuxt.config.ts`,
`supabase/config.toml`, `test/db/helpers.ts`, eerdere migraties en `app/`
blijven ongewijzigd (bevestigd via `git status`/`git diff --cached` vóór de
commit — alleen de twee bovenstaande bestanden stonden gestaged).

## Commit

`80999f9` — "feat: huishoudens met RLS en de hulpfuncties voor lidmaatschap"
Geverifieerd met `git log --show-signature -1`: goede handtekening
(`steff@steffbeckers.com`, ED25519). Op branch `plan-1-fundament`, niet
gepusht. Working tree clean na de commit.

## Self-review

Diff gelezen na het committen (`git diff --cached` vóór de commit, daarna
`git show`). Bevindingen:

- Migratie en testbestand komen woord-voor-woord overeen met de brief; geen
  eigen toevoegingen, geen weggelaten policies.
- Parameternaam `target` correct gebruikt in beide functies, niet
  `household_id`.
- `security definer` staat op beide functies; `set search_path = public` is
  gezet, consistent met het patroon van `handle_new_user()` in Task 5.
- RLS staat aan in dezelfde migratie die de tabellen aanmaakt, zoals de brief
  van Task 5 als patroon voorschrijft.
- De test importeert `withDb` maar gebruikt het niet (idem `import postgres`
  wordt niet apart gebruikt) — dat komt letterlijk uit de brief's codeblok.
  `npm test`/`npm run test:db` draaien via vitest/esbuild zonder aparte
  typecheck-stap, dus dit breekt niets; genoemd voor de volledigheid, net als
  de ongebruikte imports die bij Task 5 als minor werden genoteerd.
- Geen GRANT nodig gebleken (resolutie 7 uit de opdracht) — expliciet
  geverifieerd door de RLS-off/RLS-on cyclus: als het een privilege-probleem
  was geweest, was de foutmelding `permission denied for table household`
  geweest in plaats van een assertion-mismatch. Die foutmelding kwam in geen
  van de runs voor.

## Opmerking (geen blokkade)

`household_member` heeft geen insert-policy. Dat is exact wat de brief
voorschrijft, en de drie tests raken dit nooit — alle inserts in
`household_member` gebeuren vóór `actAs`/`enableRls`, dus als superuser. Voor
een echte "huishouden aanmaken"-flow vanuit de client (na task 6, dus buiten
mijn scope) zal iets nodig zijn om de eigenaar-rij toe te voegen onder RLS —
bijvoorbeeld een `security definer`-functie die beide inserts doet, naar het
patroon van `handle_new_user()`. Dit lijkt op het opzettelijke gat dat Task 5
had in zijn update-policy (bewaard voor Task 10); ik heb niets toegevoegd
omdat de brief compleet was opgegeven en ik niet buiten de opgegeven SQL wilde
bouwen. Vermeld voor wie de volgende taak plant.

## Concerns

Geen blokkerende zorgen.
