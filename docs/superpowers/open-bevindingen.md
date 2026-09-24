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
| In de dev-serverconsole verschijnt `[Vue warn]: Hydration node mismatch` (element `header`) bij het eerste gebruik van een `/nl`- of `/fr`-route in een verse browsercontext, vlak na het inloggen; onder `/en` niet. | Bevestigd met een geïsoleerde, seriële herhaling (`--workers=1`): 0 waarschuwingen over meerdere `/en`-inlogflows, 2/2 over de `/nl`- en `/fr`-flows in `e2e/locales.spec.ts`. De waarschuwing noemt zelf het element dat verschilt (`header`); `app.vue` heeft precies één `<header v-if="user">`, dus SSR en de eerste clientrender zijn het kennelijk oneens of `user` al waar is. Geen enkele test faalt erdoor — een consolewaarschuwing, geen assertie. Niet veroorzaakt door taak 7 (geen van de gewijzigde bestanden raakt `app.vue`, i18n- of authguard-config). De onderliggende oorzaak — waarom dat verschil zich beperkt tot de talen mét prefix — is niet vastgesteld; vermoedelijk iets in de wisselwerking tussen `@nuxtjs/i18n`'s prefix-routering en wanneer de sessie server- versus clientzijdig bekend is, maar dat is een hypothese, geen bevestigde diagnose. |
