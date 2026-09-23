# Open bevindingen

Wat er nog openstaat. Niets anders: opgeloste bevindingen verdwijnen hier en
leven verder in de git-geschiedenis.

Laatst gecontroleerd tegen de code op 2026-09-23.

## Functionaliteit die de spec vraagt

| Bevinding | Waarom het blijft liggen |
| --- | --- |
| **Geen route om iemand tot eigenaar te promoveren** (spec §4). De laatste eigenaar zit vast in zijn huishouden. | Een echte functie met UI, vertalingen, een RPC en tests. Hoort in een plan. De trigger is er al op voorbereid: degraderen mag zodra er een tweede eigenaar is. |
| **Accountverwijdering is geblokkeerd voor enige eigenaars.** | Bewuste tussenstand. Plan 8 (AVG) moet eerst het huishouden opheffen. Staat zo gedocumenteerd in de migratie én in de test. |

## Testdekking

| Bevinding | Opmerking |
| --- | --- |
| Geen e2e-dekking van de inlogflow onder `/nl` of `/fr`. | De drie talen zijn een kernbelofte; alleen `/en` wordt end-to-end gelopen. |
| Geen echte gelijktijdigheidstest op de laatste gebruikstelling van een uitnodiging. | De logica is door inspectie bevestigd, niet door een test met twee gelijktijdige transacties. |
| De e2e `signIn`-helper gebruikt regex-selectors die nu bij toeval werken: nl en fr schrijven allebei "e-mail" met koppelteken. | Breekt stil zodra een vertaling verandert. |
| `__vueParentComponent` in `e2e/login.spec.ts` is een ongedocumenteerde Vue-interne. | Kan bij een Vue-majorupgrade stilletjes aanpassing vragen. |
| De toelichting bij de `waitForFunction` in `e2e/login.spec.ts` beschrijft het hydratiemechanisme onjuist. | Klopt in conclusie, niet in redenering — misleidend voor wie erop vertrouwt. |

## Bedrading en omgeving

| Bevinding | Opmerking |
| --- | --- |
| **De Workers-runtime is sinds taak 1 niet meer gevalideerd.** | Geblokkeerd tot er een gehost Supabase-project in Frankfurt staat. Nu deployen levert een Worker op die naar een laptop wijst. |
| `NUXT_PUBLIC_APP_VERSION` is in productie niet gezet, dus de worker rapporteert versie `dev`. | Misleidend zodra er meerdere versies draaien. Hoort bij de deploy-configuratie. |
| `unrs-resolver@1.12.2` staat niet in `allowScripts`, dus zijn postinstall wordt bij elke installatie geblokkeerd met een waarschuwing. | Binnengekomen met `@nuxt/eslint`. De linter draait er zonder probleem zonder, dus het is ruis, geen defect — maar `allowScripts` is een bewuste beveiligingskeuze, en een script toelaten is aan jou. De bevinding over `esbuild@0.25.12` klopte niet: die staat er wél in, net als de vijf andere vermelde pakketten. |
| De lege `catch` rond `loadEnvFile` maakt geen onderscheid tussen een ontbrekend en een kapot `.env`. | Beide geven dezelfde melding. |

## Code

| Bevinding | Opmerking |
| --- | --- |
| `index.vue` en `confirm.vue` dupliceren dezelfde watch-op-`user`. | Bij een derde voorkomen een gedeelde composable maken. |
