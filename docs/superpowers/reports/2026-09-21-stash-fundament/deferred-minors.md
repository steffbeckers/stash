Task 1: minor (deferred): dev:true in health.test.ts:5 mist de inline-toelichting die
  vitest.config.ts wel heeft; wie hem weghaalt breekt de suite zonder te weten waarom.
Task 1: minor (deferred): package.json heeft geen engines-veld dat Node >=20 vastlegt,
  terwijl dat een global constraint is.
Task 1: minor (deferred): het rapport noemt nuxt/test-utils#1490 nog open; die is op
  2026-09-01 gesloten. Raakt de geldigheid van de afwijking niet.

Task 1: minor (deferred): de gedeployde worker rapporteert version "dev" omdat
  NUXT_PUBLIC_APP_VERSION in productie niet gezet is. Misleidend zodra er meerdere
  versies draaien; hoort bij de deploy-configuratie, niet bij taak 1.
Task 2: minor (deferred): de lege catch rond loadEnvFile maakt geen onderscheid
  tussen een ontbrekende en een kapotte .env; beide geven dezelfde melding.
Task 2: minor (deferred): `npm test` print sinds deze taak "Using secrets defined
  in .env" — nieuwe ruis in de testuitvoer, gevolg van het aanmaken van .env.
Task 2: minor (deferred): het rapport schrijft Vite's uitzondering toe aan NODE_ENV
  terwijl het VITE_USER_NODE_ENV is. Raakt de conclusie niet.

Task 3: minor (deferred): esbuild@0.25.12 staat niet in allowScripts; postinstall
  wordt stil overgeslagen. Nu een no-op, maar niet getoetst op een schone npm ci.
Task 3: minor (deferred, gevonden door de controller): de build waarschuwt dat
Task 4: minor (deferred): npm test toont twee nieuwe waarschuwingen van
  @nuxt/supabase (SUPABASE_SERVICE_KEY deprecated, Database types not found).
Task 4: minor (deferred): index.vue en confirm.vue dupliceren dezelfde
  watch-op-user; bij een derde voorkomen een gedeelde composable maken.
Task 4: minor (deferred): esbuild@0.25.12 kwam in allowScripts terecht.
Task 4: minor (deferred): geen e2e-dekking van de inlogflow onder /nl of /fr.

Task 4: fix round 1 gedispatcht (implementer hervat), FIX_BASE 59e59b9.
Task 4: minor (deferred): de toelichting bij de waitForFunction in
  e2e/login.spec.ts beschrijft het hydratiemechanisme onjuist. Klopt in
  conclusie, niet in redenering — misleidend voor wie er later op vertrouwt.
Task 4: minor (deferred): __vueParentComponent is een ongedocumenteerde
  Vue-interne; de test is gekoppeld aan implementatiedetails en kan stilletjes
  aanpassing vragen bij een Vue-majorupgrade.
Task 4: minor (deferred): de commentaarregel boven additional_redirect_urls
  zegt nog "A list of *exact* URLs" terwijl de waarde nu een wildcard is.

Task 6: minor (deferred): ongebruikte withDb-import, geerfd uit de brief.
Task 6: minor (deferred): de laatste eigenaar kan zichzelf verwijderen en laat
  dan een huishouden zonder eigenaar achter — gedekt door taak 10's
  prevent_last_owner_removal, dus opgelost binnen dit plan.
Task 6: minor (deferred): een ingelogde gebruiker kan een verweesd, onzichtbaar
  household aanmaken zolang taak 7's create_household er niet is.

Task 7: minor (deferred): app/pages/app.vue's onMounted heeft geen try/catch;
  faalt refresh(), dan blijft de gebruiker eeuwig op de laadindicator staan.
  Dit is de startpagina van de app, dus elke gebruiker raakt hem. Plan-geerfd.
Task 7: minor (deferred): appHome.title is dode sleutel geworden in drie locales.
Task 7: minor (deferred): de e2e signIn-helper gebruikt regex-selectors; werkt
  nu bij toeval omdat nl en fr allebei "e-mail" met koppelteken schrijven.

Task 8: minor (deferred): HouseholdInvites.vue wordt door geen pagina gebruikt.
Task 8: minor (deferred): create() en revoke() in dat component gooien fouten weg.
Task 8: minor (deferred): geen echte gelijktijdigheidstest op de laatste
  gebruikstelling; de logica is wel door inspectie bevestigd.

Task 9: minor (deferred): places.kind is een dode vertaalsleutel; de USelect
  heeft geen label en is dus onleesbaar voor een schermlezer.
Task 9: minor (deferred): geen testdekking op de update- en delete-policies
  van storage_place.

Task 10: minor (deferred): protect_profile_privileges is security definer
  zonder dat het iets bevoorrechts doet; onnodig maar onschadelijk.
Task 10: minor (deferred): de laatste-eigenaartrigger vuurt alleen op DELETE.
  Een toekomstige UPDATE-route op household_member zou een eigenaar kunnen
  degraderen zonder dat deze trigger ingrijpt. Nu niet bereikbaar, wel een
Task 10: minor (deferred): ongebruikte withDb-import in permissions.test.ts.

Task 10: complete (commits 7a3af1b..9671977, review clean na 1 fixronde,
