# Open bevindingen

De levende lijst. `reports/2026-09-21-stash-fundament/deferred-minors.md` is het
historische logboek van plan 1 en blijft staan zoals het was; dit bestand zegt
wat er *nu* nog openstaat.

Bijgewerkt op 2026-09-23, na een controle van alle 29 doorgeschoven bevindingen
tegen de code. Elf bleken al verholpen door de eindfixronde en taak 11, zes zijn
in deze ronde opgelost.

## Nog open

### Functionaliteit die de spec vraagt

| Bevinding | Waarom het blijft liggen |
| --- | --- |
| **Geen route om iemand tot eigenaar te promoveren** (spec §4). De laatste eigenaar zit vast in zijn huishouden. | Een echte functie met UI, vertalingen, een RPC en tests. Hoort in een plan, niet in een opruimronde. De trigger is er al op voorbereid: degraderen mag zodra er een tweede eigenaar is. |
| **Accountverwijdering is geblokkeerd voor enige eigenaars.** | Bewuste tussenstand. Plan 8 (AVG) moet eerst het huishouden opheffen. Staat zo gedocumenteerd in de migratie én in de test. |

### Testdekking

| Bevinding | Opmerking |
| --- | --- |
| Geen e2e-dekking van de inlogflow onder `/nl` of `/fr`. | De drie talen zijn een kernbelofte; alleen `/en` wordt end-to-end gelopen. |
| Geen echte gelijktijdigheidstest op de laatste gebruikstelling van een uitnodiging. | De logica is door inspectie bevestigd, niet door een test met twee gelijktijdige transacties. |
| De e2e `signIn`-helper gebruikt regex-selectors die nu bij toeval werken: nl en fr schrijven allebei "e-mail" met koppelteken. | Breekt stil zodra een vertaling verandert. |
| `__vueParentComponent` in `e2e/login.spec.ts` is een ongedocumenteerde Vue-interne. | Kan bij een Vue-majorupgrade stilletjes aanpassing vragen. |
| De toelichting bij de `waitForFunction` in `e2e/login.spec.ts` beschrijft het hydratiemechanisme onjuist. | Klopt in conclusie, niet in redenering — misleidend voor wie erop vertrouwt. |

### Bedrading en omgeving

| Bevinding | Opmerking |
| --- | --- |
| **De Workers-runtime is sinds taak 1 niet meer gevalideerd.** | Geblokkeerd tot er een gehost Supabase-project in Frankfurt staat. Nu deployen levert een Worker op die naar een laptop wijst. |
| `NUXT_PUBLIC_APP_VERSION` is in productie niet gezet, dus de worker rapporteert versie `dev`. | Misleidend zodra er meerdere versies draaien. Hoort bij de deploy-configuratie. |
| `esbuild@0.25.12` staat niet in `allowScripts`; de postinstall wordt stil overgeslagen. | Nu een no-op, maar niet getoetst op een schone `npm ci`. |
| De lege `catch` rond `loadEnvFile` maakt geen onderscheid tussen een ontbrekend en een kapot `.env`. | Beide geven dezelfde melding. |

### Code

| Bevinding | Opmerking |
| --- | --- |
| `index.vue` en `confirm.vue` dupliceren dezelfde watch-op-`user`. | Bij een derde voorkomen een gedeelde composable maken. |

## In deze ronde opgelost

- Geen linter, geen typecontrole, geen CI → `npm run lint`, `npm run typecheck` en twee GitHub Actions-jobs.
- `SUPABASE_SERVICE_KEY` was afgeschaft → hernoemd naar `NUXT_SUPABASE_SECRET_KEY`.
- De laatste-eigenaartrigger vuurde alleen op `DELETE` → nu ook op `UPDATE`.
- De schrijfpolicies van `storage_place` hadden geen enkele test → drie tests, aantoonbaar dragend.
- `protect_profile_privileges` was `security definer` zonder reden → `security invoker`.
- Het commentaar bij `additional_redirect_urls` sprak van "exacte" URLs naast een glob → toegelicht.
- `dev: true` in de health-test stond zonder uitleg → de echte foutmelding staat er nu bij.

En één bevinding die pas tijdens deze ronde opdook:

- **Twee negatieve RLS-tests bewaakten hun eigen belofte niet.** PostgreSQL past de
  `SELECT`-policy óók toe op een `UPDATE` of `DELETE` die kolommen leest. De tests
  op `household` en `household_invite` bleven daardoor groen met hun schrijfpolicy
  op `using (true)`: de leespolicy hield de buitenstaander tegen. Ze doen nu een
  kale schrijfopdracht zonder `WHERE`, en worden wél rood. Gevonden door de hele
  suite te falsifiëren in plaats van alleen het stuk waar de wijziging zat.

## Al verholpen vóór deze ronde

De volgende elf stonden nog in `deferred-minors.md` maar waren bij controle al
opgelost door de eindfixronde of door taak 11: de ontbrekende `try`/`catch` in
`app.vue`; `HouseholdInvites.vue` dat wél door `settings/household.vue` gebruikt
wordt; het weggooien van fouten in `create()` en `revoke()`; het ontbrekende
label op de `USelect` en de dode sleutel `places.kind`; de dode sleutel
`appHome.title` (wordt gebruikt); het ontbrekende `engines`-veld; twee
ongebruikte `withDb`-imports; het commentaar over nuxt/test-utils#1490 (vermeldt
de sluiting al); en twee bevindingen die binnen plan 1 zelf waren afgedekt door
taak 7 en taak 10.
