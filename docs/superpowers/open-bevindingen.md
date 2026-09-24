# Open bevindingen

Wat er nog openstaat. Niets anders: opgeloste bevindingen verdwijnen hier en
leven verder in de git-geschiedenis.

Laatst gecontroleerd tegen de code op 2026-09-24.

## Functionaliteit die de spec vraagt

| Bevinding | Waarom het blijft liggen |
| --- | --- |
| **Accountverwijdering is geblokkeerd voor enige eigenaars.** | Bewuste tussenstand. Plan 8 (AVG) moet eerst het huishouden opheffen. Staat zo gedocumenteerd in de migratie én in de test. |

## Bedrading en omgeving

| Bevinding | Opmerking |
| --- | --- |
| **De Workers-runtime is sinds taak 1 niet meer gevalideerd.** | Geblokkeerd tot er een gehost Supabase-project in Frankfurt staat. Nu deployen levert een Worker op die naar een laptop wijst. |
| `unrs-resolver@1.12.2` staat niet in `allowScripts`, dus zijn postinstall wordt bij elke installatie geblokkeerd met een waarschuwing. | Binnengekomen met `@nuxt/eslint`. De linter draait er zonder probleem zonder, dus het is ruis, geen defect — maar `allowScripts` is een bewuste beveiligingskeuze, en een script toelaten is aan jou. De bevinding over `esbuild@0.25.12` klopte niet: die staat er wél in, net als de vijf andere vermelde pakketten. |
| **De authguard van `@nuxtjs/supabase` negeert de taalprefix: een uitgelogde bezoeker wordt altijd naar het kale `/login` gestuurd.** | Vastgelegd als letterlijke string op `nuxt.config.ts:22` (`redirectOptions.login: '/login'`). Een uitgelogde bezoeker op `/nl/settings/places` belandt zo op de Engelse inlogpagina, niet op `/nl/login`. Door twee reviewers bevestigd als reëel; terecht buiten scope gehouden van de taak die het vond. |
