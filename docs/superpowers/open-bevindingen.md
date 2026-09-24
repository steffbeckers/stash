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
| In de dev-serverconsole verschijnt `[Vue warn]: Hydration node mismatch` (element `header`) bij het eerste gebruik van een `/nl`- of `/fr`-route in een verse browsercontext, vlak na het inloggen; onder `/en` niet. | Bevestigd met een geïsoleerde, seriële herhaling (`--workers=1`): 0 waarschuwingen bij `e2e/onboarding.spec.ts`'s eerste test (`een nieuwe gebruiker belandt op onboarding en kan een huishouden starten`, `/en`, ongeprefixt), 2/2 over de `/nl`- en `/fr`-flows in `e2e/locales.spec.ts`. De waarschuwing noemt zelf het element dat verschilt (`header`); `app.vue` heeft precies één `<header v-if="user">`, dus SSR en de eerste clientrender zijn het kennelijk oneens of `user` al waar is. Geen enkele test faalt erdoor — een consolewaarschuwing, geen assertie. Niet veroorzaakt door taak 7 (geen van de gewijzigde bestanden raakt `app.vue`, i18n- of authguard-config). De onderliggende oorzaak — waarom dat verschil zich beperkt tot de talen mét prefix — is niet vastgesteld; vermoedelijk iets in de wisselwerking tussen `@nuxtjs/i18n`'s prefix-routering en wanneer de sessie server- versus clientzijdig bekend is, maar dat is een hypothese, geen bevestigde diagnose. |

## Valkuilen bij lokaal ontwikkelen

Geen productdefecten — eigenaardigheden van de lokale tooling die eruitzien
als iets anders (meestal: een wispelturige testsuite) tot je de echte oorzaak
kent.

| Val | Herkenning en remedie |
| --- | --- |
| **`npm run test:e2e` faalt met `Another Nuxt dev is already running (PID <n>)` — of faalt eerst een paar keer op ogenschijnlijk willekeurige timeouts vóór die melding verschijnt.** | `.nuxt/nuxt.lock` bewaart het PID van de laatst gestarte `nuxt dev` (bron: `node_modules/@nuxt/cli/dist/lockfile-BXsNI9ve.mjs`). De opruimfunctie hangt aan `process.on('exit', ...)`; sterft die server zonder normale afsluiting, dan vuurt dat nooit en blijft het lockbestand staan. Windows hergebruikt PID's snel, dus dat nummer wijst binnen de kortste keren naar een willekeurig ander proces — in deze sessie zelf naar `svchost` (`Get-Process -Id 3724` gaf `ProcessName: svchost` terug, geen Nuxt- of node-proces in zicht), en gemeld — niet zelf geverifieerd, dus tweedehands — elders op dezelfde dag in dit project naar 1Password, de password manager die elke commit in deze repo signeert. Nuxt's leefbaarheidscontrole is letterlijk `process.kill(pid, 0)` (zelfde bronbestand): die vraagt alleen "bestaat er íéts op dit PID", niet of het om dezelfde `nuxt dev` gaat, dus het verkeerde proces wordt aangezien voor de oude server en een nieuwe start geweigerd — met de exacte melding hierboven. Het voelt aan als een wispelturige testsuite (hier: drie keer een andere timeout vóór de echte melding verscheen); dat is het niet — met een verweesd lockbestand is de fout deterministisch. Remedie: verwijder `.nuxt/nuxt.lock` (gitignored via de `.nuxt`-regel, geen broncode, bevestigd met `git check-ignore -v`). **Draai nooit `taskkill /PID <n>` op het gemelde PID.** Tegen de tijd dat je de melding ziet, is dat PID vrijwel zeker alweer iets anders — op deze machine bleek dat ooit 1Password. |
