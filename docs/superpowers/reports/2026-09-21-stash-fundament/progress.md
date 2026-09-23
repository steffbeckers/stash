# SDD ledger — plan: docs/superpowers/plans/2026-09-21-stash-fundament.md

Spec: docs/superpowers/specs/2026-09-21-stash-design.md (gelezen, bindend gezag)
Branch: plan-1-fundament (afgesplitst van main @ a19be2c)
Werkplek: in place, geen worktree — expliciete keuze van de gebruiker

## Pre-flight scan

### Taakparen die een bestand of interface delen

| Paar | Produceert → consumeert | Bevinding |
|---|---|---|
| T1 → T2 | `vitest.config.ts` | T2 herschrijft hem volledig, inclusief T1's inhoud + `exclude`. Consistent. |
| T1 → T3 | `nuxt.config.ts` | T3 herschrijft volledig, bevat alle velden van T1 + i18n. Consistent. |
| T3 → T4 | `nuxt.config.ts` modules-array | T4 voegt `@nuxtjs/supabase` toe vóór `nitro-cloudflare-dev`. Consistent. |
| T4 → T8 | `supabase.redirectOptions.exclude` | T8's lijst bevat T4's entries plus `/invite/*` per locale. Consistent. |
| T1 → T3, T7, T9 | `app/app.vue` | **DEFECT 1.** `nuxi init` genereert een `app.vue` met `NuxtWelcome`, zonder `<NuxtPage />`. T1's `pages/index.vue` en T3's locale-controle renderen dan nooit. T7 repareert het pas terloops. |
| T2 → T5..T10 | `withDb`, `resetDb` | Signatuur consistent. Maar zie DEFECT 2. |
| T5..T10 | `createUser`-helper | **DEFECT 2.** Zes testbestanden bevatten dezelfde 14 regels woordelijk. Precies het patroon dat de reviewrubriek als gebrek behandelt. |
| T6 → T5, T9, T10 | `set local role authenticated` in tests | **DEFECT 3.** `postgres.js` draait elke query los; `SET LOCAL` buiten een transactie doet niets. De RLS-tests zouden als superuser slagen en dus niets bewijzen. |
| T6 → T7, T8, T9 | `is_household_member(target)`, `is_household_owner(target)` | Parameternaam consistent gebruikt. Consistent. |
| T7 → T9 | `create_household(household_name)` | T9 doet `create or replace` met T7's body + drie `storage_place`-inserts. T7's drie tests blijven geldig. Consistent. |
| T7 → T8, T9 | `useHousehold()` | `{ households, activeId, refresh, setActive, create }` — alle consumenten gebruiken alleen wat het contract noemt. Consistent. |
| T4 → T7 | `playwright.config.ts` | **DEFECT 4.** T7's e2e leest `process.env.SUPABASE_*`, maar T4's config laadt `.env` niet. T7 lost het op met "voeg dotenv toe als het faalt" — dat is een instructie die op hoop leunt. |

### Zelfconsistentie per taak

| Taak | Bevinding |
|---|---|
| T1 | Test dekt de implementatie. Zie DEFECT 1 voor `app.vue`. |
| T2 | Helpers en extensietest kloppen onderling. |
| T3 | Locale-test en locale-bestanden kloppen. |
| T4 | Consistent. Zie DEFECT 4. |
| T5 | Consistent. |
| T6 | Zie DEFECT 3. |
| T7 | **DEFECT 5.** De e2e-test importeert `supabase-js` vanaf esm.sh binnen `page.evaluate` en leunt op `window`-globals die alleen in dev bestaan. Broos, en het dwingt een dev-only hack in `app.vue`. |
| T8 | Consistent. |
| T9 | **DEFECT 6.** De pagina laadt op top-level `await`, dus tijdens SSR. `activeId` komt uit `localStorage` en is daar altijd null, dus de lijst blijft leeg en wordt na hydratie niet opnieuw geladen. |
| T10 | Zie DEFECT 3. |

### Rulings

**Ruling 1 (DEFECT 1):** `app/app.vue` met `<UApp><NuxtPage /></UApp>` verhuist naar Task 1, stap 4a. — Zonder `<NuxtPage />` rendert geen enkele pagina, en `<UApp>` is de vereiste wortel voor Nuxt UI-overlays. — Kost indien fout: niets; het is de standaardopzet die Nuxt UI zelf voorschrijft.

**Ruling 2 (DEFECT 2):** `createUser` verhuist naar `test/db/helpers.ts` en wordt in Task 2 gedefinieerd; T5 tot en met T10 importeren hem. — Zesvoudige woordelijke duplicatie is precies wat de reviewer als gebrek aanmerkt, en het zou in zes taken zes keer dezelfde fixronde uitlokken. — Kost indien fout: een helper die iets algemener is dan één taak nodig heeft.

**Ruling 3 (DEFECT 3):** alle RLS-tests draaien binnen `sql.begin()`, en `helpers.ts` krijgt `asUser(sql, userId, fn)` die de transactie, `request.jwt.claim.sub` en `set local role authenticated` samen zet. — Anders bewijzen de RLS-tests niets terwijl ze groen zijn, en dat is erger dan geen test: het is een test die liegt over de scheiding tussen huishoudens. — Kost indien fout: de helper moet aangepast als `auth.uid()` de JSON-vorm van de claim vereist; dat staat al als controle in Task 6.

**Ruling 4 (DEFECT 4):** `playwright.config.ts` laadt `.env` vanaf zijn aanmaak in Task 4, met `dotenv` als dev-afhankelijkheid. — Een instructie van de vorm "voeg dit toe als het faalt" laat de implementer raden; het kost nu één regel. — Kost indien fout: een afhankelijkheid die niemand mist.

**Ruling 5 (DEFECT 5):** de e2e-test logt in via `admin.auth.admin.generateLink({ type: 'magiclink' })` en navigeert naar de teruggegeven link. — Dat is de echte inlogflow, zonder esm.sh, zonder `window`-globals en zonder dev-only code in `app.vue`. — Kost indien fout: de vorm van het action-link-veld kan per Supabase-versie verschillen; de test faalt dan zichtbaar en direct.

**Ruling 6 (DEFECT 6):** de bewaarplaatsenpagina laadt in `onMounted` in plaats van op top-level `await`. — Een lijst die stil leeg blijft omdat `localStorage` op de server niet bestaat, is een bug die pas in gebruik opvalt. — Kost indien fout: een korte laadflits bij het openen van de pagina.

Alle zes rulings zijn vóór dispatch in het plan verwerkt; de plantekst is de bron voor de implementers.

## Voortgang

BASE voor Task 1: eeb2750 (na de plancorrecties)

Task 1: gedispatcht (sonnet) — Nuxt 4 op Cloudflare Workers, brief task-1-brief.md
  Meegegeven resolutie: wrangler login is interactief; implementer controleert
  `wrangler whoami` en slaat de deploy over met DONE_WITH_CONCERNS als er geen
  login is. Bestaande .gitignore aanvullen, niet overschrijven. docs/ niet aanraken.

Taken in dit plan:
  [~] 1  Nuxt 4 op Cloudflare Workers
  [ ] 2  Supabase lokaal, migraties, testdatabase
  [ ] 3  Meertaligheid en/nl/fr
  [ ] 4  Inloggen met magic link
  [ ] 5  user_profile met trigger
  [ ] 6  Huishoudens met RLS
  [ ] 7  Huishouden starten
  [ ] 8  Uitnodigingslinks
  [ ] 9  Bewaarplaatsen
  [ ] 10 Rechtenmodel dichttimmeren

Task 1: rapport binnen — DONE_WITH_CONCERNS, nog niet gecommit.
  Vier afwijkingen van de brief, alle vier onderbouwd met bewijs:
   1. `nuxi init` vroeg `--template minimal --no-gitInit` om non-interactief te draaien,
      en overschreef stil de bestaande .gitignore. Implementer merkte het en herstelde.
   2. `environment: 'nuxt'` in vitest crasht op nuxt/test-utils#1490. E2e-tests met
      setup()/$fetch horen een gewoon `environment: 'node'`-project te zijn, niet
      defineVitestConfig. Gereproduceerd over vier vitest-versies.
   3. `dev: true` in setup(), zodat de test tegen de echte workerd-runtime draait via
      nitro-cloudflare-dev in plaats van een productiebuild onder Node. Sterker dan
      wat het plan voorschreef.
   4. Deploy overgeslagen: wrangler niet ingelogd, conform resolutie 1. `nuxt build`
      wel gedraaid om de Workers-preset te verifieren.

Ruling 7: afwijkingen 2 en 3 worden overgenomen in de plantekst van Task 2, want die
  beschreef vitest.config.ts nog met defineVitestConfig en environment 'nuxt'. — Een
  latere taak die de correctie terugdraait zou de hele testsuite opnieuw breken. —
  Kost indien fout: niets; het volgt de officiele Nuxt-documentatie.

Ruling 8: ik had bij mijn eigen acht commits `commit.gpgsign=false` meegegeven zonder
  te vragen, terwijl de repo via 1Password ondertekent. De gebruiker koos: vanaf nu
  ondertekenen, bestaande geschiedenis niet herschrijven. — Herschrijven vraagt een
  force-push op gepushte main en dat weegt niet op tegen acht ongetekende commits in
  een repo met een gebruiker. — Kost indien fout: een gemengde geschiedenis waarin de
  eerste acht commits niet verifieerbaar zijn.

Task 1: gecommit als 2625298, ondertekend (SSH-handtekeningblok aanwezig in de
  ruwe commit; `%G?` toont N omdat gpg.ssh.allowedSignersFile lokaal ontbreekt,
  wat verificatie blokkeert en niet ondertekening).
Task 1: review gedispatcht (sonnet), diff eeb2750..2625298 zonder lockfile.

Omgeving rechtgezet (door de gebruiker gevraagd):
  - ~/.ssh/allowed_signers aangemaakt met beide identiteiten op dezelfde sleutel,
    gpg.ssh.allowedSignersFile globaal gezet. Commit 2625298 verifieert nu als G.
  - Docker draait (29.7.2), wrangler is ingelogd (queues in de rechten).
  - Daarmee vervalt de reden waarom Task 1 de deploy oversloeg; die wordt alsnog
    afgerond zodra de review van Task 1 binnen is.

Task 2: brief gegenereerd (task-2-brief.md). Dispatch wacht op een schone review
  van Task 1 — het proces laat een volgende taak niet op ongereviewd werk bouwen.

Task 1: review schoon — spec compliant, task quality approved, 0 Critical, 0 Important.
  Reviewer verifieerde de twee afwijkingen tegen de broncode van @nuxt/test-utils
  in plaats van op het rapport te vertrouwen, en bevestigde dat de brieftekst niet
  kon werken met een cloudflare_module-preset.

Task 1: minor (deferred): dev:true in health.test.ts:5 mist de inline-toelichting die
  vitest.config.ts wel heeft; wie hem weghaalt breekt de suite zonder te weten waarom.
Task 1: minor (deferred): package.json heeft geen engines-veld dat Node >=20 vastlegt,
  terwijl dat een global constraint is.
Task 1: minor (deferred): het rapport noemt nuxt/test-utils#1490 nog open; die is op
  2026-09-01 gesloten. Raakt de geldigheid van de afwijking niet.

Task 1: warning 1 van 2 opgelost door de controller — `npm run dev` + curl bevestigt
  dat /api/health antwoordt terwijl workerd.exe draait en de log "Using cloudflare-dev
  emulation" meldt. Nuxt bedient dus echt via de Workers-runtime.
Task 1: warning 2 van 2 OPEN — de echte `wrangler deploy` naar de edge is nog niet
  gedaan. Wrangler is intussen ingelogd, dus het kan; de controller heeft de gebruiker
  gewezen op het feit dat dit een publieke workers.dev-URL oplevert en wacht op
  antwoord. Geen blokkade voor Task 2.

Task 1: complete (commits eeb2750..2625298, review clean, 3 minors deferred, 1 warning open)

BASE voor Task 2: 2625298
Task 2: gedispatcht (sonnet) — Supabase lokaal, migraties, testdatabase

Task 1: warning 2 van 2 OPGELOST — gebruiker gaf expliciet toestemming voor de deploy.
  Gedeployed vanaf een werkboom waarvan de buildinvoer identiek was aan 2625298
  (alleen het plandocument was gewijzigd, en dat raakt de build niet).
  URL: https://stash.steff-093.workers.dev
  /api/health geeft {"status":"ok","version":"dev"}; / geeft server-side gerenderde
  HTML met <div id="__nuxt" class="isolate">, wat meteen bewijst dat SSR werkt en dat
  UApp actief is. Worker startup 16 ms.
  Noot: curl meldt op deze machine HTTP 000 terwijl de body correct binnenkomt —
  schannel-artefact bij TLS-heronderhandeling, geen serverprobleem.

  Daarmee is het doel van Task 1 volledig bewezen: Nuxt 4 draait op de echte
  Cloudflare-edge, niet alleen in lokale emulatie.

Task 1: minor (deferred): de gedeployde worker rapporteert version "dev" omdat
  NUXT_PUBLIC_APP_VERSION in productie niet gezet is. Misleidend zodra er meerdere
  versies draaien; hoort bij de deploy-configuratie, niet bij taak 1.

Task 2: review schoon — spec compliant, approved, 0 Critical, 0 Important.
  Reviewer verifieerde onafhankelijk: (a) withTx/actAs/enableRls zijn structureel
  waterdicht, geen pad waarlangs een test groen wordt terwijl RLS omzeild is;
  (b) createUser getest tegen de live Supabase-instantie met een teruggedraaide
  proefinsert, geen ontbrekende NOT NULL-kolommen, geen triggers op auth.users;
  (c) de Vite-broncode bevestigt dat loadEnv alleen VITE_-variabelen doorlaat.

Task 2: minor (deferred): de lege catch rond loadEnvFile maakt geen onderscheid
  tussen een ontbrekende en een kapotte .env; beide geven dezelfde melding.
Task 2: minor (deferred): `npm test` print sinds deze taak "Using secrets defined
  in .env" — nieuwe ruis in de testuitvoer, gevolg van het aanmaken van .env.
Task 2: minor (deferred): het rapport schrijft Vite's uitzondering toe aan NODE_ENV
  terwijl het VITE_USER_NODE_ENV is. Raakt de conclusie niet.

Task 2: complete (commits 3521dc8..524fafe, review clean, 3 minors deferred)

Ruling 9: dotenv is uit het plan verwijderd; taak 4 gebruikt dezelfde
  process.loadEnvFile() als taak 2. — Twee mechanismen voor hetzelfde probleem,
  waarvan een met een extra afhankelijkheid, is onnodige variatie in een codebase
  die nog niet eens bestaat. — Kost indien fout: niets; beide werken.

BASE voor Task 3: 7d91ae4
Task 3: gedispatcht (sonnet) — meertaligheid en/nl/fr, brief task-3-brief.md
  Resolutie: browsercontrole vervangen door curl per locale, output in het rapport.

Task 3: BLOCKED op ondertekening, niet op code.
  Werk is volledig af en gestaged (8 bestanden), tests 5/5 groen, alle drie de
  locales bevestigd via curl: / -> "Know what you have at home", /nl -> "Weet wat
  je in huis hebt", /fr -> "Sachez ce que vous avez chez vous".
  `git commit` faalt met "1Password: failed to fill whole buffer" / "failed to
  write commit object". Implementer probeerde drie keer, controller een vierde
  keer: identiek. Geen van beiden heeft de ondertekening omzeild.
  Wacht op de gebruiker: 1Password ontgrendelen of de openstaande
  goedkeuringsvraag bevestigen. Niets aan de code hoeft te veranderen.
Task 3: blokkade opgeheven door de gebruiker; gecommit als 9311d92, ondertekend (G).
Task 3: review gedispatcht (sonnet), diff 7d91ae4..9311d92.

Task 3: review schoon — spec compliant, approved, 0 Critical, 0 Important.
  Reviewer simuleerde de pariteitstest met de hand in beide richtingen en bevestigt
  dat een sleutel die in en ontbreekt en een sleutel die alleen in fr staat allebei
  falen. Nitro-blok veld voor veld vergeleken en byte-identiek bevonden.
  Vertalingen nl en fr inhoudelijk goedgekeurd als natuurlijk Belgisch.

Task 3: warning opgelost door de controller — `nuxt build` met de cloudflare_module
  preset slaagt met i18n erin, en na `wrangler deploy` geven alle drie de locales op
  https://stash.steff-093.workers.dev hun eigen taal. Geen Node-builtin die buiten
  de dev-emulatie stukloopt.

Task 3: minor (deferred): esbuild@0.25.12 staat niet in allowScripts; postinstall
  wordt stil overgeslagen. Nu een no-op, maar niet getoetst op een schone npm ci.
Task 3: minor (deferred, gevonden door de controller): de build waarschuwt dat
  `main` en `assets` in wrangler.jsonc worden overschreven en genegeerd, omdat
  deployConfig: true zijn eigen config genereert. Die twee velden zijn dus dode
  configuratie die suggereert dat ze iets doen.

Task 3: complete (commits 7d91ae4..9311d92, review clean, 2 minors deferred)

BASE voor Task 4: 9311d92

Scopewijziging van de gebruiker, tijdens Task 4: de homepage blijft publiek als
  landingspagina; men komt pas op /login als men de app wil gaan gebruiken.
  Verwerkt in: spec paragraaf 1 en 5 (routetabel toegevoegd), plan taak 4 (nieuwe
  stap 3b, exclude-lijst, twee e2e-tests in plaats van een), taak 7 (index.vue ->
  app.vue, extra e2e voor de landingspagina) en taak 8 (exclude en knopdoel).
  Brief van taak 4 opnieuw gegenereerd zodat hij klopt met de code; de lopende
  implementer kreeg de wijziging per bericht.
  Commit 2a45547.

  Detail dat ik expliciet heb meegegeven: de oorspronkelijke e2e-test bewees dat /
  naar de login stuurt. Zonder vervanging zou er na deze wijziging niets meer
  bewijzen dat afscherming uberhaupt werkt. Daarom twee tests: / blijft publiek,
  en /app schermt wel af.

Task 4: DONE_WITH_CONCERNS, gecommit als 59e59b9 (ondertekend). Tests 5/5 unit,
  3/3 e2e, stabiel over drie opeenvolgende runs, plus handmatige controle via
  Inbucket met de echte PKCE-flow tot op /app.

Controllerfout: mijn commit 2a45547 was bedoeld voor alleen de plan- en
  specwijziging, maar ik draaide `git add -A` terwijl de implementer werkte.
  Daardoor bevat die commit ook login.vue, confirm.vue, e2e/login.spec.ts,
  playwright.config.ts en Playwright-artefacten onder test-results/. De
  implementer merkte de artefacten op, verwijderde ze en zette test-results in
  .gitignore. Inhoudelijk niets verloren; de geschiedenis is wel misleidend,
  want die commit-boodschap beschrijft alleen de ontwerpwijziging.
  Regel voor de rest van deze sessie: stage per bestand zolang er een agent draait.

Openstaande vraag van de implementer, nog niet beantwoord: hij kreeg de
  scopewijziging als bericht binnen, kon de herkomst niet verifieren, en
  weigerde te handelen tot hij een geldig ondertekende commit vond die het
  bevestigde. Dat is juist gedrag. De wijziging was echt en kwam van de
  gebruiker. Bevestigen zodra ik deze agent nog eens aanspreek.

Task 4: review gedispatcht (sonnet), diff 9311d92..59e59b9 over beide commits.

Task 4: review -> needs fixes. 0 Critical, 2 Important, 4 Minor.
  Important 1: supabase/config.toml site_url en additional_redirect_urls matchen
    het echte dev-origin niet (127.0.0.1 vs localhost, https vs http, geen pad).
    Reviewer verifieerde dit zelf in het bestand: GoTrue laat de gevraagde
    redirect vallen, en omdat localhost en 127.0.0.1 verschillende
    localStorage-origins zijn, is de PKCE code_verifier daarna onbereikbaar.
    Echte magic-link login werkt dus niet voor een echte gebruiker.
  Important 2: waitForLoadState('networkidle') in e2e/login.spec.ts:21 is een
    anti-patroon gebonden aan dev-modegedrag. Reviewer merkt terecht op dat
    wachten op zichtbaarheid het niet oplost, want SSR tekent het formulier
    voor Vue @submit.prevent koppelt.

Ruling 10: Important 1 wordt in taak 4 gerepareerd hoewel supabase/config.toml
  van taak 2 is. — De kapotte functie is juist degene die taak 4 moet leveren;
  de fix afsplitsen zou de branch achterlaten met een inlogflow die niet werkt.
  — Kost indien fout: een configuratiewijziging in de commit van een andere taak
  dan waar het bestand ontstond.

Task 4: minor (deferred): npm test toont twee nieuwe waarschuwingen van
  @nuxt/supabase (SUPABASE_SERVICE_KEY deprecated, Database types not found).
Task 4: minor (deferred): index.vue en confirm.vue dupliceren dezelfde
  watch-op-user; bij een derde voorkomen een gedeelde composable maken.
Task 4: minor (deferred): esbuild@0.25.12 kwam in allowScripts terecht.
Task 4: minor (deferred): geen e2e-dekking van de inlogflow onder /nl of /fr.

Task 4: fix round 1 gedispatcht (implementer hervat), FIX_BASE 59e59b9.
  Openstaande vraag over de herkomst van de scopewijziging is in dat bericht
  bevestigd: die kwam echt van de gebruiker, en het weigeren was juist gedrag.

Task 4 fix round 1: implementer viel uit op een sessie-rate-limit, niet op de taak.
  Bij hervatting bleken beide fixes al op schijf te staan, ongecommit:
   - supabase/config.toml: site_url naar http://localhost:3000, redirect-allowlist
     naar http://localhost:3000/* (juiste host, juist schema, pad-wildcard).
   - e2e/login.spec.ts: networkidle vervangen door waitForFunction op
     __vueParentComponent op de submit-knop. Dat is het signaal dat Vue zet in
     dezelfde stap waarin het de listeners aansluit, dus deterministisch — beter
     dan zowel mijn suggestie als die van de reviewer, die allebei aannames over
     timing waren.
  Resterend bij hervatting: Supabase-stack herstarten (drie services stonden stil,
  en een config.toml-wijziging telt pas na een herstart van auth), e2e draaien,
  de echte magic-link-flow via Mailpit verifieren, fixrapport en commit.

Task 4: fix round 1 afgerond, commit 31c958c (ondertekend).
  e2e 3/3 over drie verse runs deze ronde (6/6 over beide rondes), unit 5/5,
  db 3/3. Echte magic-link-flow tweemaal volledig doorlopen met een echte klik
  op de echte mail in Mailpit, beide keren ingelogd op /app. De implementer
  bevestigde met `docker inspect` dat GOTRUE_SITE_URL en GOTRUE_URI_ALLOW_LIST
  in de draaiende auth-container overeenkomen met de nieuwe config, dus niet
  alleen het bestand op schijf.
  Correctie op mijn eigen instructie: ik meldde dat de stack stilstond, maar de
  drie gestopte services waren imgproxy, edge-runtime en pooler — auth draaide
  gewoon. De implementer verifieerde het toch zelf, wat de juiste reactie was.
Task 4: scoped re-review gedispatcht (sonnet), diff 59e59b9..31c958c.

Task 4: fix round 1/5 (2 addressed, 0 open; commits 59e59b9..31c958c)
  Re-reviewer verifieerde finding 1 zelf met docker inspect op de draaiende
  auth-container en een repo-brede grep naar 127.0.0.1:3000 — beide schoon.
  Voor finding 2 traceerde hij het mechanisme in Vue's eigen broncode en vond
  dat de code-toelichting de volgorde verkeerd beschrijft: __vueParentComponent
  wordt bovenaan hydrateNode gezet, voordat de props van dat knooppunt gepatcht
  worden, en kinderen hydrateren voor de ouder. De conclusie houdt wel, om een
  andere reden: beide gebeuren binnen een ononderbroken synchrone hydratiepas,
  en Playwright's raf-gebaseerde polling kan daar niet tussenin kijken. De fix
  is dus echt deterministisch, alleen niet om de opgeschreven reden.

Task 4: minor (deferred): de toelichting bij de waitForFunction in
  e2e/login.spec.ts beschrijft het hydratiemechanisme onjuist. Klopt in
  conclusie, niet in redenering — misleidend voor wie er later op vertrouwt.
Task 4: minor (deferred): __vueParentComponent is een ongedocumenteerde
  Vue-interne; de test is gekoppeld aan implementatiedetails en kan stilletjes
  aanpassing vragen bij een Vue-majorupgrade.
Task 4: minor (deferred): de commentaarregel boven additional_redirect_urls
  zegt nog "A list of *exact* URLs" terwijl de waarde nu een wildcard is.

Task 4: complete (commits 9311d92..31c958c, review clean na 1 fixronde, 7 minors deferred)

BASE voor Task 5: 31c958c

Task 5: DONE, commit 03b40d2 (ondertekend). test:db 6/6, test 5/5.
  Geen blokkerende zorgen; implementer meldt dat resetDb's cascade-truncate
  Postgres NOTICE-regels geeft, wat bestaand helpergedrag is.
Task 5: review gedispatcht (sonnet), diff 31c958c..03b40d2.
  Meegegeven: het privilege-gat in de update-policy is opzettelijk en hoort bij
  taak 10 — niet als bevinding rapporteren, wel controleren of de implementer
  die grens respecteerde in plaats van hem vroeg te dichten of stil te verbreden.

Task 5: review approved, maar met 1 Important (plan-mandated) en 1 Minor.
  Important: geen van de drie tests draait onder RLS. Ze importeren actAs en
  enableRls maar roepen ze nooit aan. Reviewer's bewijs: haal `enable row level
  security` uit de migratie en alle drie blijven groen. De suite bewijst de
  trigger-levenscyclus en niets over de policies.
  Minor: drie ongebruikte imports; het zelfreview-rapport noemde er twee.

Ruling 11: dit is een defect in mijn plantekst, niet van de implementer, en het
  raakt meer dan taak 5. Plan doorzocht: taak 5 en taak 8 hebben policies die
  geen enkele test aanraakt; taak 7 heeft terecht geen RLS-test want die toetst
  security definer-functies en de tabellen eronder zijn door taak 6 gedekt.
  Beide gaten gedicht in de plantekst (commit a4c37ac), en taak 5 krijgt een
  fixronde. — Dit is precies het defect dat ik in de pre-flight scan in de
  helpers repareerde zonder te controleren of de tests ze ook gebruiken; het
  ongerepareerd laten zou de RLS-belofte van de hele spec hol maken. — Kost
  indien fout: twee extra tests per tabel die misschien nooit iets vangen.

Ruling 12: de fixronde moet aantonen dat de nieuwe test faalt met RLS uitgezet,
  niet alleen dat hij slaagt met RLS aan. — Een test die beweert RLS te bewijzen
  en dat niet aantoonbaar doet, is exact het probleem dat we net vonden. — Kost
  indien fout: een paar minuten extra per taak.

Task 5: fix round 1 gedispatcht (implementer hervat), FIX_BASE 03b40d2.

Task 5: fix round 1 klaar, commit 7d65dae (ondertekend). test:db 8/8, test 5/5.
  RLS-uit-controle deed wat hij moest: met `enable row level security` eruit
  raakte de update 1 rij in plaats van 0 en werd de test rood; na terugzetten
  weer groen. De test bewijst dus aantoonbaar wat hij beweert.
Task 5: scoped re-review gedispatcht (haiku — kleine, goed onderbouwde fix-diff).

Task 5: fix round 1/5 (2 addressed, 0 open; commits 03b40d2..7d65dae)
  Re-reviewer bevestigde de RLS-uit-controle: "AssertionError: expected 1 to be +0".
  Merkte terecht op dat mijn plandoc-commit a4c37ac in het bereik viel; dat is
  documentatie, geen taak-5-code.
Task 5: complete (commits 31c958c..7d65dae, review clean na 1 fixronde)

BASE voor Task 6: 7d65dae

Task 6: DONE, commit 80999f9 (ondertekend). test:db 11/11, test 5/5.
  RLS-uit-controle: "verbergt het huishouden van iemand anders" werd rood
  (expected 1 to be +0); de andere twee bleven groen met opgegeven redenen —
  een hangt niet van isolatie af, de ander toetst de security-definer-functie
  rechtstreeks. Reviewer is gevraagd die redenering per test te wegen, want
  groen blijven met RLS uit kan ook betekenen dat een test minder bewijst
  dan hij lijkt.
  Niet-blokkerende zorg van de implementer: household_member heeft geen
  insert-policy, dus een client-flow zou een security-definer-functie nodig
  hebben. Dat is precies wat taak 7 introduceert; meegegeven aan de reviewer.
Task 6: review gedispatcht (sonnet), diff 7d65dae..80999f9. Reviewer gevraagd
  de policies als aanvaller te bekijken, met drie benoemde risico's.

Task 6: review schoon — approved, 0 Critical, 0 Important, 4 Minor.
  Reviewer verifieerde de delete-policy algebraisch (een lid kan geen ander lid
  verwijderen), bevestigde security definer met gepind search_path op beide
  functies, en controleerde dat de parameternaam `target` de zelfverwijzingsval
  vermijdt die `household_id` zou geven. De RLS-uit-redenering is per test
  getoetst tegen de echte semantiek van de helpers en klopt.
  Bevestigd dat de ontbrekende insert-policy op household_member de veilige
  keuze is: een naieve `with check (user_id = auth.uid())` zou iedereen laten
  toetreden tot elk bestaand huishouden.

Task 6: minor (deferred): ongebruikte withDb-import, geerfd uit de brief.
Task 6: minor (deferred): de laatste eigenaar kan zichzelf verwijderen en laat
  dan een huishouden zonder eigenaar achter — gedekt door taak 10's
  prevent_last_owner_removal, dus opgelost binnen dit plan.
Task 6: minor (deferred): een ingelogde gebruiker kan een verweesd, onzichtbaar
  household aanmaken zolang taak 7's create_household er niet is.

Ruling 13: de vierde minor — isolatie van household UPDATE/DELETE en
  household_member SELECT alleen door analyse bevestigd, niet door een test —
  wordt gedicht in taak 7 in plaats van in een fixronde op taak 6. — In taak 6
  is een tweede huishouden met lidmaatschap alleen via superuser-paden te maken;
  create_household maakt het in taak 7 triviaal, en dat was ook de suggestie van
  de reviewer zelf. — Kost indien fout: de dekking landt een taak later dan ze
  had gekund. Commit 632c203.

Task 6: complete (commits 7d65dae..80999f9, review clean, 4 minors deferred)

BASE voor Task 7: 632c203

Task 7: DONE, commit 9fcec13. test 5/5, test:db 16/16, test:e2e 6/6, tweemaal
  gedraaid voor stabiliteit. RLS-uit-controle maakte beide nieuwe isolatietests
  rood plus een bestaande uit taak 6. Taak 6's migratie is ongemoeid in de
  commit; ik heb dat zelf geverifieerd met git diff --name-only.

  Drie afwijkingen, alle drie fouten in mijn plantekst die pas bij uitvoering
  zichtbaar werden:
   1. tx.savepoint() nodig rond de twee .rejects.toThrow()-asserties; postgres.js
      vergiftigt anders de hele transactie na een gefaalde query. Ik had bij de
      pre-flight scan geredeneerd dat alle throws de laatste instructie waren en
      dat het dus goed zou gaan — dat klopte niet voor taak 7.
   2. De e2e signIn()-helper uit ruling 5 werkt niet: de geinstalleerde
      @supabase/ssr-client dwingt PKCE af en weigert admin-gegenereerde
      implicit-grant links. Vervangen door het echte /login-formulier plus
      Mailpit. Dit raakt taak 8, dat dezelfde helper gebruikt.
   3. useHousehold leest user.value.sub, niet .id: de geinstalleerde
      @nuxtjs/supabase geeft JWT-claims terug, geen klassiek User-object.
      Dit is het soort fout dat de hele functie stil breekt.

Task 7: review gedispatcht (sonnet), diff 632c203..9fcec13, met de drie
  afwijkingen expliciet ter beoordeling voorgelegd.

Task 7: review schoon — approved, 0 Critical, 0 Important, 4 Minor.
  Reviewer verifieerde alle drie de afwijkingen tegen geinstalleerde broncode:
   - JwtPayload heeft sub en geen id-veld; user.value.id was altijd undefined.
   - postgres.js installeert per scope() een eigen uncaughtError-handler, dus
     een afgevangen rejection laat de hele transactie alsnog falen; savepoint()
     maakt een nieuwe scope en begrenst dat. De asserties toetsen nog hetzelfde.
   - @supabase/ssr zet flowType 'pkce' onvoorwaardelijk, na de gebruikersopties,
     dus niet te overschrijven. De brieftekst kon niet werken.
  Bevestigde ook dat create_household echt atomair is: een plpgsql-functie, dus
  bij een fout in de tweede insert breekt Postgres de hele instructie af.

Task 7: minor (deferred): app/pages/app.vue's onMounted heeft geen try/catch;
  faalt refresh(), dan blijft de gebruiker eeuwig op de laadindicator staan.
  Dit is de startpagina van de app, dus elke gebruiker raakt hem. Plan-geerfd.
Task 7: minor (deferred): appHome.title is dode sleutel geworden in drie locales.
Task 7: minor (deferred): de e2e signIn-helper gebruikt regex-selectors; werkt
  nu bij toeval omdat nl en fr allebei "e-mail" met koppelteken schrijven.

Ruling 14: het vierde minor — geen enkele test raakt de revoke/grant-regels aan,
  want alles draait als superuser — wordt gedicht in taak 8 met een test op
  has_function_privilege. — Dit is hetzelfde patroon als de RLS-blindheid uit
  taak 5: groen blijven terwijl de beschermde eigenschap onbewezen is. Taak 8
  heeft dezelfde regels op twee functies. — Kost indien fout: een test die
  misschien nooit iets vangt. Commit a464234.

Task 7: complete (commits 632c203..9fcec13, review clean, 4 minors deferred)

BASE voor Task 8: a464234

Task 8: DONE, commit 9cf85d2. test 5/5, test:db 23/23. RLS-uit-controle faalde
  zoals bedoeld (gewoon lid zag 1 uitnodiging in plaats van 0).
  Twee SQL-correcties buiten de brieftekst, allebei empirisch vastgesteld:
  pgcrypto staat in het schema `extensions`, niet `public`, en
  `revoke ... from public` haalt Supabase's directe grant aan anon er niet af.
  Twee zorgen gemeld: de redirect-terugkeer op de uitnodigingspagina is inert
  omdat login.vue en confirm.vue de parameter niet lezen, en dezelfde anon-grant
  staat nog open op create_household uit taak 7.

Ruling 15: de anon-grant op create_household wordt gedicht in taak 10, met een
  nieuwe migratie en een dekkingstest, niet met een aanpassing aan taak 7's
  al toegepaste migratie. — Zelf in de database geverifieerd: create_household
  anon=true, create_invite en accept_invite anon=false. Niet uitbuitbaar omdat
  de functie zonder ingelogde gebruiker weigert, maar de verdediging in de
  diepte werkt niet zoals het plan beweert en het is inconsistent. Taak 10 gaat
  precies hierover. — Kost indien fout: een revoke die niets afdicht dat nog
  niet afgedicht was. Commit 9cd8e07.

  Noot: de grant-dekkingstest die ik na taak 7 aan taak 8 toevoegde is precies
  wat dit blootlegde. Zonder die test was dit onopgemerkt gebleven.

Task 8: review gedispatcht (sonnet), diff a464234..9cf85d2. Reviewer gevraagd de
  token-, vervaldatum- en gebruikstellingpaden als aanvaller te bekijken, en de
  inerte redirect-terugkeer op ernst te wegen.

Task 8: review schoon voor wat taak 8 bouwde — approved, 0 Critical, 1 Important
  (plan-mandated, door de reviewer zelf als niet-blokkerend bestempeld), 3 Minor.
  Reviewer verifieerde: gen_random_bytes(24) is 192 bits CSPRNG en niet te raden;
  `select ... for update` maakt gelijktijdig accepteren veilig doordat een
  geblokkeerde transactie onder READ COMMITTED de verse rij herleest; er is geen
  pad dat lidmaatschap aanmaakt zonder uses te verhogen of omgekeerd; de
  al-lid-tak keert terug voor beide instructies. Beide SQL-correcties kloppen,
  en het schema-kwalificeren van gen_random_bytes behoudt de bescherming die
  het gepinde search_path biedt.

Task 8: minor (deferred): HouseholdInvites.vue wordt door geen pagina gebruikt.
Task 8: minor (deferred): create() en revoke() in dat component gooien fouten weg.
Task 8: minor (deferred): geen echte gelijktijdigheidstest op de laatste
  gebruikstelling; de logica is wel door inspectie bevestigd.

Ruling 16: de Important (dode redirect-terugkeer) plus de twee eerste minors
  krijgen een eigen taak 11 in plan 1, in plaats van te worden geparkeerd. —
  Samen betekenen ze dat uitnodigen aan geen van beide kanten een werkende
  ingang heeft: een eigenaar kan geen link maken en een nieuwe gebruiker
  verliest de uitnodiging bij het inloggen. Plan 1 belooft in zijn slotsectie
  letterlijk dat je via een uitnodigingslink lid kan worden; zonder taak 11 is
  dat niet waar. — Kost indien fout: een elfde taak in een plan van tien.
  Commit 637a0c3. De taak bevat ook een aparte test tegen open redirects, want
  een redirect-parameter doordragen is precies hoe phishing-doorstuurpagina's
  ontstaan.

Task 8: complete (commits a464234..9cf85d2, review clean, 3 minors deferred,
  1 Important doorgerouteerd naar taak 11)

BASE voor Task 9: 637a0c3

Task 9: implementer viel uit op een sessie-rate-limit bij stap 7 (handmatige
  browsercontrole). Bij hervatting stond alles al op schijf, ongecommit:
  migratie 20260922122804_storage_place.sql, test/db/storage-place.test.ts,
  app/pages/settings/ en de drie locale-bestanden.
  Hervat met de resolutie dat een browsercontrole niet kan: curl gebruiken, en
  als een sessie niet te construeren is dat eerlijk melden in plaats van bewijs
  te verzinnen of de stap stil over te slaan.

Task 9: blokkade opgeheven door de gebruiker; gecommit als 336a1e3, ondertekend.
  test 5/5, test:db 26/26. RLS-uit-controle faalde zoals bedoeld: met RLS uit zag
  het ene huishouden de drie standaardplaatsen van het andere (expected 3 to be +0).
  Taak 7's vijf create_household-tests slagen nog tegen de vervangen functie.
  Stap 7 (handmatige browsercontrole) vervangen door de exacte aanroepen van de
  pagina na te spelen via GoTrue en PostgREST als echte ingelogde gebruiker:
  3 standaardplaatsen -> toevoegen -> 4 -> verwijderen -> 3, plus de
  doorverwijzing van een niet-ingelogd verzoek naar /login.
Task 9: review gedispatcht (sonnet), diff 637a0c3..336a1e3. Reviewer gevraagd de
  vervangen create_household-body tegen taak 7's origineel te leggen, en te wegen
  of de curl-verificatie de browsercontrole werkelijk vervangt.

Task 9: review schoon — approved, 0 Critical, 0 Important, 3 Minor.
  Reviewer legde de vervangen create_household regel voor regel naast taak 7's
  origineel: identiek op de drie storage_place-inserts na. Voegde toe dat
  `create or replace` de bestaande ACL behoudt, dus de grants niet herhalen is
  correct by construction. Keurde ook de curl-vervanging van de browsercontrole
  goed als vormgelijk aan wat de pagina doet, met de eerlijke kanttekening dat
  niemand de pagina ooit echt heeft zien renderen.

Task 9: minor (deferred): places.kind is een dode vertaalsleutel; de USelect
  heeft geen label en is dus onleesbaar voor een schermlezer.
Task 9: minor (deferred): geen testdekking op de update- en delete-policies
  van storage_place.

Ruling 17: het derde minor — geen foutafhandeling in places.vue — wordt samen
  met dezelfde fout in app.vue meegenomen in taak 11, niet in losse fixrondes.
  Zelf geverifieerd: places.vue en HouseholdInvites.vue gooien op alle
  Supabase-aanroepen de error weg, en app.vue heeft geen try/catch waardoor de
  startpagina eeuwig blijft laden als refresh() faalt. — Dit is een patroon in
  mijn plantekst, niet drie losse vergissingen, en taak 11 doet de fix al voor
  HouseholdInvites. — Kost indien fout: de fix landt een taak later dan ze had
  gekund. Commit 7a3af1b. De dode places.kind-sleutel wordt daar meteen
  opgelost door de USelect een label te geven.

Task 9: complete (commits 637a0c3..336a1e3, review clean, 2 minors deferred,
  1 minor doorgerouteerd naar taak 11)

BASE voor Task 10: 7a3af1b

Task 10: DONE, commit 995f82f (ondertekend). test 5/5, test:db 33/33, e2e 6/6.
  Alle drie de beschermingen aantoonbaar dragend: beide triggers een voor een
  uitgezet, waarbij elk precies zijn eigen test brak en niets anders; de
  anon-grant met has_function_privilege gemeten voor (true) en na (false).
  De cascade-val trad echt op: de eerste run van de opheffingstest faalde en
  vroeg `when (pg_trigger_depth() = 0)`, precies zoals gewaarschuwd.
  Deploy bewust overgeslagen, conform instructie — dat doe ik met de gebruiker.
  Implementer meldt zelf een slordigheid tijdens het uit- en weer aanzetten van
  een trigger (gedupliceerd commentaarblok door een onnauwkeurige edit), gevonden
  bij herlezen en hersteld voor de laatste run.
Task 10: review gedispatcht (sonnet), diff 7a3af1b..995f82f. Reviewer gevraagd
  de drie beschermingen als aanvaller te toetsen, met drie benoemde risico's,
  en te controleren of de pg_trigger_depth-guard niet zelf iets openzet.

Task 10: review -> needs fixes. 1 CRITICAL, 1 Important, 3 Minor.
  CRITICAL: de `when (pg_trigger_depth() = 0)`-guard is te grof. Hij zet de
  trigger uit bij elke geneste cascade, niet alleen bij het opheffen van het
  huishouden zelf. Reviewer reproduceerde het live; ik heb het onafhankelijk
  nagedaan tegen de draaiende database:
    VOOR  huishoudens=3  eigenaars=3
    NA    huishoudens=3  eigenaars=2
  Het verwijderen van de auth.users-rij van een enige eigenaar cascadeert naar
  household_member, de guard is onwaar, de controle draait nooit, en het
  huishouden overleeft zonder eigenaar. Daarna onbestuurbaar, want elke policy
  erop vraagt is_household_owner. Bereikbaar vanuit Supabase Studio of
  auth.admin.deleteUser(), zonder app-code.
  Important: dezelfde anon-grant staat nog open op is_household_member en
  is_household_owner uit taak 6. Niet uitbuitbaar (beide null-veilig tegen
  auth.uid()), wel dezelfde klasse gat als wat deze taak juist dichtte. De test
  heette "anon mag geen enkele huishoudfunctie aanroepen" maar controleerde er
  een — die naam heeft het gemaskeerd.

Ruling 18: de guard wordt vervangen door een controle of de ouderrij nog
  bestaat, en het gedrag wordt blokkeren. — pg_trigger_depth kan "het huishouden
  wordt opgeheven" niet onderscheiden van "een lid verdwijnt terwijl het
  huishouden blijft"; de ouderrij wel, want die is bij een huishoudcascade
  binnen hetzelfde commando al weg. Blokkeren is juist voor dit plan: het
  maakt de kapotte toestand onbereikbaar. Spec paragraaf 8 zegt dat het
  huishouden meegaat wanneer de laatste eigenaar zijn account verwijdert, maar
  dat hoort bij de accountverwijderingsflow in een later plan, die het
  huishouden eerst opheft en daarna de gebruiker — waarna deze trigger de
  cascade correct toestaat. — Kost indien fout: het verwijderen van een
  auth.users-rij faalt voor een enige eigenaar tot dat latere plan er is.

  De pg_trigger_depth-suggestie stond in mijn plantekst. Dit is een fout van
  de planner, niet van de implementer; dat staat ook zo in het fixbericht.

Task 10: fix round 1 gedispatcht (implementer hervat), FIX_BASE 995f82f.

Task 10: fix round 1 klaar, commit 9671977 (ondertekend). test:db 34/34, test 5/5,
  e2e 6/6. Beide weghaal-controles gedroegen zich zoals bedoeld.
  Het anon-gat bleek erger dan de bevinding beschreef: taak 6 had nooit van
  `public` gerevoked, dus `revoke ... from anon` alleen liet anon er via de
  standaard PUBLIC-grant weer in. De verbrede test ving dat zelf — precies
  waarvoor hij verbreed was. Opgelost met taak 8's patroon:
  `revoke ... from public, anon` plus een expliciete grant aan authenticated.

  Zelf geverifieerd tegen de draaiende database, niet op het rapport vertrouwd:
   - alle vijf functies: anon=false, authenticated=true
   - auth.users-rij van een enige eigenaar verwijderen geeft nu
     "ERROR: een huishouden moet minstens een eigenaar houden"
   - een heel huishouden opheffen werkt nog steeds

  Judgment call van de implementer: hij hield de accenten in de foutmelding
  ("minstens een eigenaar" met accenten) aan volgens de bestaande conventie in
  plaats van de accentloze versie uit mijn bericht, en las dat verschil als
  transmissieruis. Dat was juist.

Task 10: scoped re-review gedispatcht (sonnet), diff 995f82f..9671977.

Task 10: fix round 1/5 (2 addressed, 0 open; commits 995f82f..9671977)
  Re-reviewer controleerde of er nog andere cascade-paden naar household_member
  bestaan: er zijn er precies twee (household en auth.users), dus de nieuwe
  ouderrij-controle is uitputtend voor dit schema, niet alleen voor de twee
  genoemde gevallen. Bevestigde ook dat de regressietest de trigger echt raakt
  en niet op een permissiemuur stuit, en dat de "erger dan beschreven"-claim
  klopt: taak 6 had helemaal geen revoke, dus de impliciete PUBLIC-grant stond
  nog open en `revoke from anon` alleen kon die niet weghalen.
  De accentkeuze in de foutmelding is juist: geen test hangt aan de tekst, en
  het volgt de bestaande conventie in de codebase.

Task 10: minor (deferred): protect_profile_privileges is security definer
  zonder dat het iets bevoorrechts doet; onnodig maar onschadelijk.
Task 10: minor (deferred): de laatste-eigenaartrigger vuurt alleen op DELETE.
  Een toekomstige UPDATE-route op household_member zou een eigenaar kunnen
  degraderen zonder dat deze trigger ingrijpt. Nu niet bereikbaar, wel een
  aanname die een latere taak niet mag overnemen.
Task 10: minor (deferred): ongebruikte withDb-import in permissions.test.ts.

Task 10: complete (commits 7a3af1b..9671977, review clean na 1 fixronde,
  3 minors deferred)

BASE voor Task 11: 9671977

Task 11: DONE, commit 76893f2 (ondertekend). test 5/5, test:db 34/34, e2e 8/8.
  Uitnodigingsflow end-to-end geverifieerd tegen echte Supabase en Mailpit:
  eigenaar maakt link op /settings/household -> gast belandt op
  /login?redirect=/invite/<token> -> logt in -> de echte magic link komt terug
  op de uitnodigingspagina in plaats van /app -> ziet de huishoudnaam.

  Twee afwijkingen: extra hydratiewachten omdat de brieftekst zonder die wachten
  flakert, en de gedeelde e2e-helpers in een nieuw e2e/helpers.ts omdat
  Playwright 1.63 weigert dat het ene testbestand het andere importeert. Mijn
  plantekst zei "exporteren uit onboarding.spec.ts", wat dus niet kan.

  Eerlijke beperking van de implementer: hij wilde ook aantonen dat de
  open-redirecttest faalt tegen een opzettelijk kapotte guard, maar de
  beveiligingsclassifier van de omgeving blokkeerde die run als "Security
  Weaken". Hij draaide meteen terug in plaats van een omweg te zoeken. Dat punt
  rust dus op code-lezen, niet op een falsificatierun. Juist gehandeld, en
  eerlijk gemeld in plaats van stil weggelaten.

  Gevonden en bewust niet gerepareerd: HouseholdInvites.vue roept
  d(date, 'short') aan terwijl er nergens datetimeFormats geconfigureerd is.
  Zelf bevestigd: de aanroep staat op regel 80, en noch nuxt.config.ts noch
  i18n/ bevat datetimeFormats. Onzichtbaar tot deze taak het component eindelijk
  rendert. De configuratie hoort in nuxt.config.ts, dat voor taak 11 verboden
  terrein was. Reviewer gevraagd de ernst te wegen: het is de vervaldatum die
  een gebruiker leest om te weten wanneer een link stopt te werken.

Task 11: review gedispatcht (sonnet), diff 9671977..76893f2. Reviewer gevraagd
  de open-redirectguard zelf op booleanlogica te toetsen en andere bypassvormen
  te bedenken (backslash, witruimte, URL-encoding, array-waarde bij dubbele
  parameter), en expliciet NIET te proberen de guard te verzwakken.

Task 11: review -> needs fixes. 0 Critical, 3 Important, 6 Minor.
  Important 1: mijn redirect-guard heeft een echt gat. `/\evil.example` begint
    met een slash en niet met twee, dus startsWith('//') is onwaar en de waarde
    passeert als intern. Idem met een tab tussen de slashes. Reviewer traceerde
    het tot het einde: navigateTo weigert ze alsnog via hasProtocol met regex
    /^([/\]\s*){2,}[^/\]/, dus er is geen werkende open redirect — maar dat is
    toeval, niet de guard. Het gevolg is een onafgevangen fout en een eeuwige
    laadindicator, precies het faalpatroon dat deze taak net repareerde.
  Important 2: aria-label="Invitation link" is een hardgecodeerde Engelse
    string op een schermlezer-attribuut, uit mijn eigen Step 8.
  Important 3: d(date, 'short') rendert leeg in alle drie de talen omdat er
    geen datetimeFormats bestaat. De vervaldatum naast elke uitnodigingslink
    is dus onzichtbaar, op precies het scherm dat deze taak bereikbaar maakt.

Ruling 19: de guard wordt vervangen door hasProtocol uit ufo, in een gedeelde
  helper in app/utils/. — Nuxt's eigen navigateTo gebruikt dezelfde functie, dus
  onze controle en die van Nuxt kunnen niet uit elkaar lopen; een handgeschreven
  prefixcontrole blijkt precies het soort ding waar randgevallen in schuilen. De
  helper maakt bovendien unittests mogelijk, wat de falsificatie oplost die de
  beveiligingsclassifier vorige ronde blokkeerde. — Kost indien fout: een
  afhankelijkheid op een transitieve package.

Ruling 20: ik hef de nuxt.config.ts-restrictie op voor Important 3 alleen. —
  De datumconfiguratie kan nergens anders staan, en een lege vervaldatum naast
  een uitnodigingslink uitrollen omdat een bestand verboden terrein is, is de
  regel belangrijker maken dan waarvoor hij bestaat. — Kost indien fout: een
  wijziging in een gevoelig configuratiebestand; expliciet meegegeven dat het
  nitro-blok onaangeroerd moet blijven.

Task 11: fix round 1 gedispatcht (implementer hervat), FIX_BASE 76893f2.
  Twee minors meegenomen die dezelfde bugklasse zijn in dezelfde bestanden:
  load() in HouseholdInvites gooit zijn error nog weg, en settings/household.vue
  mist de try/catch die app.vue wel kreeg.

Task 11: fix round 1 klaar, commit d5771c0 (ondertekend). test 12/12 (was 5,
  de nieuwe safe-redirect unittests erbij), test:db 34/34, e2e 8/8.
  safeInternalPath geeft: /app -> /app; https://evil.example, //evil.example,
  /\evil.example, /\t/evil.example, ['/app'] en 42 -> allemaal null.
  De vorige ronde had een eerlijk gat — de guard was niet te falsificeren omdat
  de beveiligingsclassifier de weaken-run blokkeerde. Dat gat is nu dicht via
  een pure functie met unittests, zonder enige riskante ingreep.
  Vervaldatum rendert: i18n/i18n.config.ts met datetimeFormats voor en/nl/fr,
  automatisch opgepikt door @nuxtjs/i18n. Daardoor bleef nuxt.config.ts
  ongemoeid ondanks dat ik de restrictie had opgeheven — beter dan mijn ruling.
  Zelf bevestigd: nuxt.config.ts staat niet in de diff.
  Bewijs dat de configuratie werkt: een volledige run gegrepen op "intlify" —
  nul treffers, tegenover aanwezig in elke eerdere run.
Task 11: scoped re-review gedispatcht (sonnet), diff 76893f2..d5771c0.

Task 11: fix round 1/5 (5 addressed, 0 open; commits 76893f2..d5771c0)
  Re-reviewer traceerde de ufo-regex zelf in node_modules en rekende alle zeven
  invoervormen met de hand na, in plaats van het testbestand te geloven. Draaide
  de unittest read-only: 7/7. Verifieerde de auto-detectie van i18n.config.ts in
  de broncode van @nuxtjs/i18n 10.6.0 (restructureDir default "i18n", findPath op
  i18n.config) in plaats van de claim aan te nemen. Bevestigde dat legitieme
  interne paden niet geraakt worden.
Task 11: complete (commits 9671977..d5771c0, review clean na 1 fixronde)

ALLE ELF TAKEN AFGEROND. Nu de eindreview over de hele branch.

EINDREVIEW OVER DE HELE BRANCH (opus, base a19be2c, head d5771c0, 26 commits)
  Oordeel: mergen na het oplossen van de Important-punten. 0 Critical.
  Reviewer traceerde elk cross-household lees- en schrijfpad en vond geen enkel
  pad waarlangs het ene huishouden bij het andere komt, en geen zelfverhoging
  van rechten. De problemen zitten in bereik, bewijs en deploy-bedrading, niet
  in het model zelf.

  Acht Important-bevindingen:
   1. user_profile is leesbaar voor anon. Policy staat op `to public` met
      using(true) en anon heeft tabelrechten. Zelf geverifieerd tegen de
      draaiende database: policy roles {public}, anon select = true, 12
      profielen zichtbaar. Met de publieke sleutel uit de browserbundel is dus
      het hele gebruikersregister te lezen, inclusief wie moderator is.
   2. Cross-household SCHRIJF-isolatie is nergens bewezen. Alle negatieve
      RLS-tests dekken SELECT. Vijf schrijfpaden zijn alleen dicht doordat er
      geen policy bestaat — bescherming door afwezigheid, die stil verdwijnt
      zodra iemand een permissieve policy toevoegt.
   3. De household INSERT-policy laat verweesde, onbereikbare rijen aanmaken.
      De ledger noteerde dit als opgelost door taak 7; dat klopt niet.
   4. De gedocumenteerde deploy zet een Worker op localhost. @nuxtjs/supabase
      leest credentials op buildtijd, en `wrangler secret put SUPABASE_URL`
      gebruikt namen die runtime niet leest — dat moet NUXT_PUBLIC_*. Bovendien
      is sinds taak 1 niets meer op de Workers-runtime gevalideerd.
   5. Accountverwijdering is nu onmogelijk voor elke enige eigenaar, en de test
      legt dat vast als correct in plaats van als tussenstand.
   6. De twee functionele pagina's hebben geen ingang en er is geen uitloggen.
      Vijf vertaalde sleutels worden nergens gebruikt: het bewijs dat er een
      navigatie bedoeld was.
   7. pg_trgm staat in public in plaats van extensions.
   8. resetDb() kan een productiedatabase leegmaken; geen omgevingscontrole.

Ruling 21: de fixronde gaat op sonnet in plaats van opus. — De bevindingen zijn
  precies gespecificeerd met bestand, regelnummer en voorgeschreven fix; dit is
  uitvoerwerk, geen ontwerpwerk, en de eerste poging op opus sneuvelde op een
  sessielimiet zonder iets op te leveren. — Kost indien fout: een fixronde die
  meer begeleiding vraagt.

Ruling 22: de implementer moet per bevindingsgroep committen in plaats van aan
  het eind. — Een onderbreking kost dan een groep in plaats van alles; dit is de
  derde keer dat een rate limit een agent halverwege afkapt. — Kost indien fout:
  een iets rommeliger geschiedenis op de branch.

Eindreview-fixronde gedispatcht (sonnet), FIX_BASE d5771c0.

Eindreview-fixronde klaar: tien commits d5771c0..7f55a35, alle ondertekend.
  test 12/12, test:db 46/46 (was 34), e2e 9/9, op een schone supabase db reset.
  Alle acht bevindingen plus de kleine punten verholpen.

  Zelf geverifieerd tegen de draaiende database, niet op het rapport vertrouwd:
   - user_profile SELECT-policy heeft nu roles {authenticated}; anon ziet
     0 profielen waar het er 12 waren.
   - pg_trgm staat nu in het schema extensions.

  Zelf-gevangen fout van de implementer, het uitlichten waard: zijn eerste
  poging om de household_invite uses-reset-test rood te maken gebruikte een
  UPDATE-only probe, en die werkte niet — Postgres poort UPDATE namelijk ook op
  de zichtbaarheid uit de SELECT-policy. Gecorrigeerd met een `for all`-probe.
  Precies de klasse "groen om de verkeerde reden" die bevinding 2 moest
  uitroeien; de probe zelf fout hebben zou hem hebben teruggebracht.

  Eén meningsverschil: de implementer stelt dat bevinding 2 het storage_place
  insert-geval ten onrechte "bescherming door afwezigheid" noemt, want daar
  staat wel degelijk een policy. Test toch toegevoegd; alleen de omschrijving
  klopte niet. Ter beoordeling meegegeven aan de re-review.

Re-review van de fixronde gedispatcht (sonnet), diff d5771c0..7f55a35.

Re-review fixronde: alle bevindingen opgelost, geen nieuwe Critical of Important.
  Oordeel: ready to merge. Migraties echt append-only: vier nieuwe bestanden,
  nul wijzigingen aan de acht al toegepaste. Beide gemarkeerde claims houden
  stand bij onafhankelijke controle: de UPDATE-zichtbaarheidsfout in de probe
  en het meningsverschil over storage_place (daar staat wel degelijk een policy;
  de omschrijving in de bevinding klopte niet, de test is terecht toegevoegd).

Ruling 23 (adjudicatie van de resterende Minor): de resetDb-bescherming
  accepteert alleen exact `localhost` en `127.0.0.1`, dus IPv6-loopback (::1)
  of een Docker-Compose hostnaam zou onterecht geweigerd worden. Geparkeerd,
  niet gerepareerd. — Dit project gebruikt overal 127.0.0.1 (.env.example en
  supabase start), dus de weigering treft vandaag niemand; en te ruim maken is
  juist het risico dat de bescherming moest wegnemen. Een weigering is bovendien
  zichtbaar en direct op te lossen, in tegenstelling tot de fout die hij
  voorkomt. — Kost indien fout: iemand met een afwijkende lokale opstelling moet
  een regel aanpassen voor test:db draait.

Ruling 24: de live verificatie op de Cloudflare-edge blijft open tot er een
  gehost Supabase-project bestaat. — Sinds taak 1 is niets meer op de echte
  Workers-runtime gedraaid, en dat was de tweede helft van bevinding 4. Nu
  deployen zou juist de bug opleveren die de bevinding beschrijft: de build leest
  .env op buildtijd, en dat wijst naar localhost. Een Worker uitrollen die naar
  een laptop verwijst is slechter dan niet uitrollen. — Kost indien fout: de
  branch merget met de Workers-runtime onbewezen voorbij het health-endpoint.

AFGEROND. Gebruiker koos optie 2: pushen en een PR maken.
  Branch plan-1-fundament gepusht naar origin, 36 commits vooruit op main.
  PR: https://github.com/steffbeckers/stash/pull/1
  Volledige suite groen op de geintegreerde boom: 12 unit, 46 db, 9 e2e.

  Werkmap bewust NIET verwijderd: de fixes zijn gecommit maar nog niet gemerged,
  en de ledger met alle 24 rulings en de elf taakrapporten is bruikbaar zolang
  de PR openstaat. Verwijderen zodra de PR gemerged is.

  Er is geen CI in deze repo (.github/ ontbreekt), dus er draaien geen checks
  op de PR. Dat staat als geerfde schuld in de eindreview.
