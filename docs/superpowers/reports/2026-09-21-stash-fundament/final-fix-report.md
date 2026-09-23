# Plan 1 fundament — eindfix-rapport

Startpunt: `d5771c0` (branch `plan-1-fundament`). Alle acht bevindingen uit de
whole-branch eindreview zijn opgelost, plus de "also fix"-lijst. Tien commits,
één per bevinding/groep, allemaal ondertekend (`git log --pretty="%G?"` → `G`
op elk van de tien).

```
7f55a35 feat: gegenereerde Supabase-types verbinden en handcasts verwijderen
0352f2e chore: kleine bevindingen uit de eindreview opruimen
916999b fix: resetDb() beschermen tegen een niet-lokale DATABASE_URL (bevinding 8)
97b3d2f fix: pg_trgm naar extensions-schema verplaatsen (bevinding 7)
61c5451 feat: navigatie en uitloggen toevoegen aan app.vue (bevinding 6)
0882539 docs: laatste-eigenaarblokkade markeren als tijdelijk (bevinding 5)
2901199 docs: deploy-wiring voor Supabase-env-variabelen corrigeren (bevinding 4)
e72708e fix: onbereikbare household-rommel via directe insert voorkomen (bevinding 3)
1569411 test: cross-household schrijfisolatie bewijzen (bevinding 2)
debcebe fix: user_profile leesbaar door anon dichtzetten (bevinding 1)
```

---

## Bevinding 1 — user_profile leesbaar door anon

**Fixed.** Nieuwe migratie `20260923060000_restrict_user_profile_select.sql`
laat de select-policy vallen en herschept haar met `to authenticated`.

Bewijs, in volgorde:
1. Test `user-profile.test.ts` inverteerde ("laat profielen lezen door
   andere ingelogde gebruikers") plus een nieuwe test ("laat anon geen enkel
   profiel lezen"). Gedraaid tegen de OUDE migratie: de nieuwe anon-test
   faalde — `AssertionError: expected 1 to be +0` (anon zag de rij nog).
2. Migratie toegepast (`npx supabase db reset`), tests opnieuw: 6/6 groen.
3. Live bevestigd via de echte REST API met de lokale anon-sleutel:
   `curl .../rest/v1/user_profile?select=*` gaf vóór de fix een rij terug
   (niet apart gelogd, maar consistent met de testuitslag); ná de fix: `[]`.

## Bevinding 2 — cross-household schrijfisolatie nergens bewezen

**Fixed.** Zes nieuwe tests, drie bestaande tests gerepareerd.

Nieuwe tests (elk met savepoint waar een throw verwacht wordt):
- `household.test.ts`: buitenstaander insert in `household_member` (INSERT,
  bescherming door afwezigheid); gewoon lid update `role = 'owner'` op
  zichzelf (UPDATE, afwezigheid); gewoon lid delete van een ander lid
  (DELETE — dit dekt meteen de nooit-geteste DELETE-policy zelf)
- `storage-place.test.ts`: buitenstaander insert in `storage_place` voor
  andermans huishouden (INSERT — **correctie op de bevinding**: dit is,
  anders dan de andere vier, niet "bescherming door afwezigheid". Er bestaat
  al een echte policy `with check (is_household_member(household_id))`. De
  gevraagde test is nog steeds volledig terecht en nu toegevoegd; alleen de
  classificatie in de bevinding klopte niet voor dit ene geval.)
- `household-invite.test.ts`: buitenstaander insert met zelfgekozen token
  (INSERT, afwezigheid); buitenstaander reset `uses = 0` (UPDATE, afwezigheid)

Bestaande tests gerepareerd: `permissions.test.ts` regel 48, 92 en 138 riepen
nooit `enableRls()` aan en gaven de `household_member` DELETE-policy zo geen
enkele dekking. De test op regel 92 ("een eigenaar kan wel weg als er een
tweede eigenaar is") had een probleem: hij voegt een tweede eigenaar
rechtstreeks toe via `insert`, wat zelf geen policy heeft — dat gebeurt nu
bewust vóór `enableRls()` als opzet, niet als onderdeel van wat de test
bewijst.

**Load-bearing-bewijs, elke nieuwe test apart (rood dan groen):**

| Test | Tabel/commando | Methode | Rood bevestigd | Groen na herstel |
|---|---|---|---|---|
| buitenstaander insert household_member | INSERT, afwezigheid | tijdelijke policy `for insert with check (true)` toegevoegd | ✅ `promise resolved "[]" instead of rejecting` | ✅ |
| lid self-promote household_member | UPDATE, afwezigheid | tijdelijke policy `for update using (true) with check (true)` | ✅ `expected 1 to be +0` | ✅ |
| lid verwijdert ander lid | DELETE, afwezigheid | tijdelijke policy `for delete using (true)` | ✅ `expected 1 to be +0` | ✅ |
| buitenstaander insert storage_place | INSERT, **echte policy** | tijdelijke `for insert with check (true)` ernaast (OR'd) | ✅ `promise resolved "[]" instead of rejecting` | ✅ |
| buitenstaander insert household_invite | INSERT, afwezigheid | tijdelijke `for insert with check (true)` | ✅ `promise resolved "[]" instead of rejecting` | ✅ |
| buitenstaander reset uses household_invite | UPDATE, afwezigheid | zie hieronder — eerste poging faalde stil | ✅ (na correctie) | ✅ |

**Zelfgevonden en gecorrigeerde meetfout, waard om te melden:** voor de
laatste test (household_invite uses-reset) bleek een UPDATE-only probe-policy
(`for update using (true) with check (true)`) de test **niet** rood te maken
— hij bleef groen ondanks de permissieve policy. Uitgezocht met een
losstaande scratch-tabel: Postgres RLS vereist voor UPDATE/DELETE dat de rij
ook zichtbaar is onder een toepasselijke SELECT-policy (of een policy die
SELECT impliciet meedekt), niet alleen onder de UPDATE-policy zelf.
household_invite's enige SELECT-policy is eigenaar-only, dus een
buitenstaander faalt die sowieso, ongeacht de UPDATE-probe — de test kon dus
onmogelijk rood worden met die probe, wat het bewijs waardeloos maakte. Een
`for all using (true) with check (true)`-probe (die ook SELECT-zichtbaarheid
geeft) toonde de test wél rood. Dit is precies het "een test die niet rood
kan, bewijst niets"-principe uit de opdracht, hier op mezelf toegepast vóórdat
het rapport werd geschreven.

Alle tijdelijke probe-policies zijn na elke proef verwijderd; geverifieerd met
`select * from pg_policies where policyname like 'tmp%'` → 0 rijen vóór de
uiteindelijke commit.

## Bevinding 3 — household INSERT-policy is misbruikvector

**Fixed.** Nieuwe migratie `20260923061000_drop_household_self_insert.sql`
trekt de policy in. Nieuwe test in `create-household.test.ts` bewijst dat een
rechtstreekse insert nu faalt terwijl `create_household()` blijft werken.
Load-bearing bewijs: oude policy tijdelijk teruggezet → test rood
(`promise resolved "[]" instead of rejecting`) → policy weer verwijderd →
groen.

## Bevinding 4 — deploy zou een Worker naar localhost laten wijzen

**Fixed**, als wiring + documentatie, geen deploy uitgevoerd.

- `.env.example`: uitleg toegevoegd dat dit bestand alleen lokaal telt, en
  dat de Worker op runtime alleen `NUXT_PUBLIC_`-voorvoegsels leest.
- `README.md`: nieuwe sectie "Deploying" met exact welke drie variabelen
  (`NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_KEY`,
  `NUXT_PUBLIC_APP_VERSION`) als Worker-secret gezet moeten worden, en met
  welk commando (`wrangler secret put <naam>`), vóór `npm run deploy`.
- `wrangler.jsonc`: korte verwijzing naar diezelfde sectie, als commentaar
  (geen `vars` toegevoegd met echte waarden — die zijn er niet, dit is de
  lokale stack).
- Geverifieerd in de broncode van `@nuxtjs/supabase` (`node_modules/@nuxtjs/
  supabase/dist/module.mjs`) dat de module `NUXT_PUBLIC_SUPABASE_URL` al als
  eerste keuze leest vóór de legacy `SUPABASE_URL`, en dat Nitro's generieke
  runtime-override daarna hetzelfde `NUXT_PUBLIC_`-voorvoegsel gebruikt —
  vandaar dat precies deze namen, en niet de namen die het plan noemde,
  nodig zijn.
- `NUXT_PUBLIC_APP_VERSION` volgt exact hetzelfde mechanisme (het is een
  gewone `runtimeConfig.public`-sleutel); zonder een Worker-secret blijft de
  build-tijd-default (`dev` uit `.env`) staan, dus dat is nu ook expliciet
  gedocumenteerd in plaats van stilzwijgend fout.

**Niet gedaan, met opzet:** geen `wrangler deploy` of `wrangler secret put`
uitgevoerd. Dat is aan de mens met toegang tot het echte Cloudflare-project.
De operator moet vóór een echte deploy de drie `wrangler secret put`-
commando's uit de README draaien.

## Bevinding 5 — accountverwijdering geblokkeerd voor solo-eigenaars

**Fixed als documentatie, geen gedragswijziging** — precies zoals gevraagd.

De toegepaste migratie (`20260923055349_...sql`) is niet aangeraakt (append-
only). Nieuwe migratie `20260923062000_document_last_owner_block_as_interim.sql`
zet een echte `comment on function prevent_last_owner_removal()` met de
uitleg dat dit bewust maar tijdelijk is en dat plan 8 het huishouden eerst
moet verwijderen. Geverifieerd met `obj_description(...)` dat de comment
persisteert.

`permissions.test.ts`: testnaam veranderd van "...wordt geblokkeerd" naar
"...wordt tijdelijk geblokkeerd (plan 8 moet eerst het huishouden
verwijderen)", met een uitgebreide toelichting erboven. Het gedrag van de
test zelf (still `rejects.toThrow()`) is ongewijzigd.

## Bevinding 6 — geen navigatie, geen uitloggen

**Fixed.** `app/app.vue` (de root-layout — niet `app/pages/app.vue`) kreeg
een kopbalk met `UNavigationMenu` (Inventory → `/app`, Settings →
`/settings/household`) en een uitlogknop (`supabase.auth.signOut()`),
zichtbaar met `v-if="user"`. `/settings/household` kreeg zelf een link naar
`/settings/places` (label: het al bestaande `places.title`) — geen dropdown,
geen nieuwe navigatiesleutels nodig.

Alle vijf genoemde dode sleutels zijn nu in gebruik: `nav.inventory`,
`nav.settings`, `auth.signOut` (kopbalk), `appHome.title` (vervangt de
dubbele "Stash"-tekst op de /app-startpagina), `invite.joining` (bijschrift
onder de voortgangsbalk tijdens het accepteren van een uitnodiging). Geen
nieuwe i18n-sleutels toegevoegd — alles bestond al in alle drie de locales;
`test/i18n/locales.test.ts` blijft groen.

E2e: nieuwe test in `onboarding.spec.ts` klikt na het starten van een
huishouden echt door "Settings" naar `/settings/household` en dan door
"Storage places" naar `/settings/places`, in plaats van er met `page.goto()`
heen te springen.

Handmatig geverifieerd via de dev server en de browserpane: inloggen via een
echte magic link uit Mailpit → onboarding (nav al zichtbaar, ook zonder
huishouden) → huishouden starten → `/app` toont "Your household" +
huishoudnaam, "Inventory" actief gemarkeerd → klik Settings → `/settings/
household` → klik "Storage places" → `/settings/places` toont de drie
standaardplaatsen → klik "Sign out" → terug naar de publieke landingspagina.
Geen consolefouten tijdens de hele flow.

## Bevinding 7 — pg_trgm in public in plaats van extensions

**Fixed.** Nieuwe migratie `20260923063000_move_pg_trgm_to_extensions.sql`:
`alter extension pg_trgm set schema extensions`.

Geverifieerd vóór de fix dat `pg_trgm` inderdaad de enige extensie in
`public` was (`pg_extension` × `pg_namespace`): `uuid-ossp` en `pgcrypto`
stonden al in `extensions`, `plpgsql` in `pg_catalog`, `supabase_vault` in
`vault` — dus de bevinding "elke andere extensie staat al in extensions"
klopt. Na de migratie: `pg_trgm` → `extensions`, `similarity('melk',
'melkk')` resolveert nog steeds zonder kwalificatie (default search_path op
deze stack bevat al `extensions`), `test/db/extensions.test.ts` blijft
groen. EXECUTE-rechten voor anon/authenticated zijn ongewijzigd (een
schemaverplaatsing raakt geen grants) — dat was ook niet gevraagd.

## Bevinding 8 — resetDb() kan een productiedatabase wissen

**Fixed.** `assertLocalDatabase()` in `test/db/helpers.ts` weigert te draaien
tegen elke host behalve `localhost`/`127.0.0.1`, met een foutmelding die
zegt waarom. `resetDb()` roept hem als eerste stap aan. Nieuwe tests in
`test/db/reset-db-guard.test.ts` bewijzen de guard rechtstreeks (geen
databaseverbinding nodig): accepteert `localhost` en `127.0.0.1`, weigert een
`*.supabase.co`-host en een willekeurige externe host.

---

## Ook gefixt, allemaal klein

- `settings/places.vue`: `await refresh()` in `onMounted` had als enige van
  de drie pagina's geen `try`/`catch`. Nu hetzelfde patroon als `app.vue` en
  `settings/household.vue`, met de al bestaande `error`-ref.
- `package.json`: `"engines": { "node": ">=20" }` toegevoegd.
- `vitest.config.ts`: comment over nuxt/test-utils#1490 gecorrigeerd van
  "open bug" naar "gedocumenteerd gedrag, gesloten 2026-09-01" — uitleg
  behouden.
- Ongebruikte `withDb`-import verwijderd uit `create-household.test.ts`,
  `household-invite.test.ts`, `household.test.ts`, `permissions.test.ts`,
  `storage-place.test.ts`.
- `invite/[token].vue`: `route.params.token` liep ongecodeerd een URL in;
  nu `encodeURIComponent()`.
- `README.md` volledig vervangen (was ongewijzigde Nuxt-starterboilerplate):
  wat Stash is, vereisten, opstartstappen, de drie testcommando's met wat
  elk nodig heeft, en de "Deploying"-sectie uit bevinding 4.
- Supabase-types gegenereerd (`npx supabase gen types typescript --local` →
  `app/types/database.types.ts`) en verbonden. Geverifieerd in de
  broncode van `@nuxtjs/supabase` dat het standaardpad
  (`~/types/database.types.ts`, wat onder Nuxt 4's `srcDir` op
  `app/types/database.types.ts` uitkomt) al precies overeenkomt — geen
  wijziging aan `nuxt.config.ts` nodig, `nitro`-blok dus sowieso onaangeroerd.
  Alle vier genoemde casts verwijderd:
  - `useHousehold.ts:33` — `(row: any) =>` weg; alleen `role` (tekstkolom
    met check-constraint, geen Postgres-enum) houdt een gerichte cast
  - `settings/places.vue:36` — `as Place[]` weg; alleen `kind` houdt een
    gerichte cast, `id`/`name` komen al getypeerd binnen
  - `HouseholdInvites.vue:31` — `as Invite[]` weg zonder vervanging
  - `invite/[token].vue:37` — cast op de huishoudnaam weg zonder vervanging
  Elke plek eerst geverifieerd met een losstaande `tsc`-check tegen de echte
  gegenereerde types (bewijst dat `role`/`kind` als kale `string`
  terugkomen, en dat de rest zonder cast compileert).

---

## Testuitslag (drie suites, schone `npx supabase db reset` eraan vooraf)

```
npm test
  Test Files  3 passed (3)
       Tests  12 passed (12)

npm run test:db
  Test Files  8 passed (8)
       Tests  46 passed (46)

npm run test:e2e
  9 passed (46.9s)
```

Alle twaalf migraties passen schoon toe, in volgorde, op een verse
`npx supabase db reset`.

**Ruis die niet van mij is** (per de resolutions, niet onderzocht):
`SUPABASE_SERVICE_KEY is deprecated`-waarschuwing, `Using secrets defined in
.env`, Postgres NOTICE-regels van `resetDb()`'s cascade-truncate. De
eerder ontbrekende-database-types-notice is nu weg, zoals verwacht na het
genereren van de types.

**Wel van mij, geobserveerd en verklaard:** tijdens het itereren zag ik één
keer `e2e\invite.spec.ts` falen op de allereerste `page.goto('/login')` van
een parallelle run (`net::ERR_ABORTED`), vóórdat er iets van mijn
navigatiewijziging zelfs maar aan bod kwam. Serieel en in isolatie draaide
dezelfde test daarna herhaaldelijk groen, inclusief de volledige flow door
`/settings/household` (die ik wel wijzigde). Dat wijst op een koude-start/
parallelliteitstiming van de dev-server, niet op een regressie — bevestigd
door de uiteindelijke volledige `npm run test:e2e`-run hierboven, die met de
standaard workers-instelling gewoon 9/9 groen gaf.

---

## Waar ik het niet mee eens was

**Bevinding 2's classificatie van de storage_place-test als "bescherming
door afwezigheid".** De bevinding zegt: "Nothing tests these writes, all
denied today only because no INSERT/UPDATE policy exists" voor alle vijf
genoemde operaties, storage_place-insert inbegrepen. Dat klopt niet voor die
ene: `storage_place` heeft al sinds `20260922122804_storage_place.sql` een
echte, correct scopende INSERT-policy (`with check
(is_household_member(household_id))`). De gevraagde test zelf is nog steeds
volledig terecht (er was inderdaad geen test die een buitenstaander expliciet
afwees) en is toegevoegd; alleen de "waarom" in de bevinding was voor dit
ene geval onnauwkeurig. Ik heb de test toegevoegd zoals gevraagd, het
load-bearing-bewijs aangepast aan de werkelijke situatie (een probe-policy
ernaast in plaats van de enige bescherming wegnemen, want die laatste zou
door Postgres' default-deny toch al rood noch groen onderscheiden), en het
hier vermeld in plaats van de karakterisering stilzwijgend over te nemen.

Verder niets waarvan ik denk dat het fout zit — alle acht bevindingen zijn
zoals beschreven geïmplementeerd, binnen de gegeven scope.

---

## Nieuwe migraties (append-only, toegepaste migraties niet aangeraakt)

```
20260923060000_restrict_user_profile_select.sql       (bevinding 1)
20260923061000_drop_household_self_insert.sql          (bevinding 3)
20260923062000_document_last_owner_block_as_interim.sql (bevinding 5)
20260923063000_move_pg_trgm_to_extensions.sql           (bevinding 7)
```

## Niet gedaan

- Geen `wrangler deploy`, geen `wrangler secret put` — met opzet, zie
  bevinding 4.
- Geen subagents gebruikt op enig moment in deze sessie.
- `.claude/launch.json` toegevoegd voor handmatige browserverificatie van
  bevinding 6, bewust **niet** gecommit (untracked, zoals `.vscode/`).
