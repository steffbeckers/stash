# Termijn voor Supabase-verzoeken — ontwerp

Een verbinding die er is maar niet werkt, laat de app nu eindeloos wachten.
Je ziet dat bijvoorbeeld bij de vriezer in de garage met één streepje
signaal. Afstrepen blijft dan laden, de voorraad blijft op haar spinner
staan, en ongedaan maken lijkt niets te doen, omdat het wacht op een
verzending die niet eindigt. De offline-ronde
(`2026-10-03-offline-voorraad-design.md`) aanvaardde dat als de prijs van
haar garantie: een ongedaanmaking tijdens een verzending gaat niet verloren.
Zie de rij "zonder timeout" in `docs/superpowers/open-bevindingen.md`.

Deze spec begrenst elk PostgREST-verzoek (`/rest/v1/`) in de browser op 10
seconden. De garantie blijft daarbij overeind: wie een afstreping ongedaan
maakt waarvan niemand weet of de server ze kreeg, heropent haar ook op de
server.

## 1. Wat dit oplevert, en wat niet

**Wel:**
- Elk PostgREST-verzoek uit de browser (`/rest/v1/`), of het nu een tabel of
  een RPC is, telt na 10 s zonder antwoord als netwerkfout.
- Een afstreping die op de termijn stuit, komt in de wachtrij.
- De voorraadpagina toont haar foutstand in plaats van een spinner die
  nooit verdwijnt.
- Ongedaan maken wacht niet meer onbegrensd.

**Niet:**
- **SSR.** Verzoeken vanuit de server krijgen geen termijn. Ze lopen over het
  netwerk van de host, niet over dat van de gebruiker.
- **Auth-verzoeken.** Breekt de termijn een tokenvernieuwing af die de
  server al verwerkte, dan probeert auth-js opnieuw met het oude
  refresh-token. Dat is dan geroteerd, en buiten de reuse-interval van 10 s
  (`supabase/config.toml`) antwoordt GoTrue "already used". Is het
  access-token verlopen, dan wist auth-js de sessie, en is de gebruiker
  uitgelogd. Ook verify en de PKCE-uitwisseling lukken maar één keer. Een
  hangende tokenvernieuwing blokkeert dus zoals vóór deze spec (§8).
- **Twee tabbladen.** Die blijven zoals ze zijn (open-bevindingen).

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Eén termijn voor alle PostgREST-verzoeken, niet alleen de offline-wachtpunten | Een gewone afstreping of het laden van de lijst hangt bij slecht signaal net zo goed. De app doet geen uploads, realtime of edge functions: alles wat de termijn raakt, is een klein REST-verzoek. | Komen er ooit uploads bij, dan hebben die een eigen, langere termijn nodig. |
| 10 seconden | Ruim genoeg voor een trage mobiele verbinding die wél werkt, en voor een koude start van de database. Kort genoeg om niet lang naar een spinner te kijken. | Een verbinding die trager is dan 10 s maar wel werkt, valt terug op de wachtrij. Afstrepen is idempotent, dus dat kost alleen een verzending later. |
| `window.fetch` omwikkelen, alleen voor `/rest/v1/` van de Supabase-URL | `@nuxtjs/supabase` maakt de client aan met zijn eigen `fetchWithRetry`, en een `fetch` kan niet via de runtimeconfig. Die `fetchWithRetry` roept bij elk verzoek de globale `fetch` aan. Eén plek dekt zo tabellen en RPC's. Auth valt erbuiten: een afgebroken tokenvernieuwing die de server al verwerkte, kan de sessie wissen (§1). | Een globale `fetch` vervangen is een ingreep. Het voorvoegsel houdt auth, Nuxts `$fetch` en al het andere erbuiten. Een hangende tokenvernieuwing houdt via de auth-lock elk verzoek erachter tegen, zoals vóór deze spec. |
| Afbreken met een eigen `AbortController`, niet met `AbortSignal.timeout` | `AbortSignal.timeout` geeft een `TimeoutError`, en die probeert postgrest-js bij een GET tot drie keer opnieuw. Een gewone `abort()` geeft een `AbortError`, en die herhaalt het nooit. | Geen: het verschil zit alleen in de naam van de fout. |
| Het signaal op het `init`-object zetten | De herhaallus van `@nuxtjs/supabase` stopt alleen als `init.signal.aborted` waar is. Anders probeert hij elke afgebroken poging nog twee keer, telkens met een nieuwe termijn. | Verandert de module haar lus, dan duurt een hangend verzoek weer langer. De e2e-test telt de pogingen en wordt dan rood (§8, test 6). |
| Een onzekere afstreping wordt bij ongedaan maken ook op de server heropend | Na een termijn of een verbroken verbinding weet niemand of de server de afstreping kreeg. Alleen uit de wachtrij halen kan dan een ongedaanmaking verliezen. `reopen()` filtert op `status = 'closed'`, dus had de server haar niet, dan raakt het niets. | Streepte een huisgenoot het item intussen zelf af, dan heropent dit die afstreping. Dat is dezelfde soort fout als de bestaande bevinding over vervallen verzendingen. |
| Onzeker houden we in het geheugen bij, niet in de wachtrij | Ongedaan maken kan alleen via de toast, en die overleeft een herlaad niet. De opslagversie blijft `1`. | Geen. |

## 3. De termijn

`app/utils/termijn.ts`, puur:

```ts
export const SUPABASE_TERMIJN_MS = 10_000

export function metTermijn(
  fetch: typeof globalThis.fetch,
  voorvoegsel: string,
  ms: number,
): typeof globalThis.fetch
```

Per aanroep `(invoer, init)`:

1. **De URL** komt uit `invoer`: een string, een `URL` of een `Request`.
   Begint ze niet met `voorvoegsel`, dan gaat de aanroep ongewijzigd door.
2. **Een nieuwe `AbortController`.** Na `ms` volgt `abort()` zonder reden,
   wat een `AbortError` geeft. De timer wordt niet gewist: na een afgerond
   verzoek doet `abort()` niets. Loopt het lezen van het antwoord nog na
   `ms`, dan breekt dat ook af, zodat de termijn het hele verzoek begrenst.
3. **Een signaal dat de aanroeper al meegaf**, in `init.signal` of op het
   `Request`, blijft gelden. Is het al afgebroken, dan breekt de controller
   meteen af; anders breekt hij af zodra dat signaal dat doet.
4. **Is er een `init`, dan wordt `init.signal` het nieuwe signaal.** Daaraan
   ziet de herhaallus van `@nuxtjs/supabase` dat het verzoek afgebroken is.
   `metTermijn` wijzigt het `init`-object dus bewust.
5. **De aanroep** wordt `fetch(invoer, { ...init, signal })`.

`app/plugins/termijn.client.ts`:

```ts
const { url } = useRuntimeConfig().public.supabase
window.fetch = metTermijn(window.fetch.bind(window), postgrestVoorvoegsel(url), SUPABASE_TERMIJN_MS)
```

Alleen in de browser. Supabase-js en de module roepen de globale `fetch` pas
op het moment van het verzoek aan, dus de volgorde van de plugins doet er
niet toe. Het voorvoegsel is `/rest/v1/` en niet de hele Supabase-URL: auth
valt erbuiten (§1).

Herhaalt de lus van `@nuxtjs/supabase` een poging na een `TypeError` met
hetzelfde `init`, dan volgt die poging via `init.signal` de termijn van de
eerste. Het hele verzoek, alle pogingen samen, blijft dus binnen 10 s.

**Wat de app ziet.** postgrest-js maakt van een `AbortError` deze fout:

```ts
{ code: '', message: 'AbortError: …', hint: 'Request was aborted (timeout or manual cancellation)' }
```

De tekst na `AbortError: ` verschilt per browser.

**`isNetwerkfout`** herkent voortaan ook een fout zonder databasecode waarvan
de melding begint met `AbortError: `, naast de bestaande `TypeError: `. Een
melding met `AbortError: ` mét een code is geen netwerkfout. Een
`DOMException` met de naam `AbortError` is er wel een, net als een
`TypeError`-instantie.

`verstuurWachtrij` hoeft voor de classificatie niet te veranderen. Een
afgebroken verzoek heeft geen code uit klasse `22` of `23`, en blijft dus al
staan (offline-spec §6).

## 4. Gedrag per handeling

| Handeling | Na 10 s zonder antwoord |
|---|---|
| Online afstrepen (`close` in `afstrepen`) | Netwerkfout. De afstreping gaat in de wachtrij, met de bestaande toast en Ongedaan maken, en is **onzeker** (§5). Kreeg de server haar toch, dan valt ze bij het versturen stil weg als vervallen. |
| Wachtrij versturen | Het item blijft staan en de rest wacht ook, zoals nu. Het item is onzeker als het toestel vóór de poging online was (§5). |
| Voorraad openen | `verstuur()` eindigt zoals hierboven, dan volgt `laad()`. Hangt ook dat, dan toont de pagina na 10 s haar bestaande foutstand. |
| Verversen na een handeling | De bestaande toast `inventory.refreshFailed`. |
| Online ongedaan maken (`reopen` in `ongedaanMaken`) | De bestaande foutmelding. |

## 5. Onzeker verstuurd

Een afstreping is **onzeker** als een verzendpoging faalde zonder antwoord
van de server, terwijl het toestel vóór die poging online was. De server
kan haar dan gekregen hebben: bij een termijn, maar ook bij een verbinding
die wegvalt midden in het antwoord. Daarom telt de online-status van vóór de
poging, niet die in de `catch`: valt de verbinding weg midden in het
antwoord, dan is `navigator.onLine` daar al onwaar.

Ze is zeker niet verstuurd in twee gevallen:
- **Het toestel was vóór de poging al offline.**
- **De fout heeft een niet-lege string als `code`**, zoals `42501` of
  `PGRST301`. Dan antwoordde de server en weigerde hij.

- **`verstuurWachtrij`** krijgt in haar resultaat een veld
  `onzeker: string | null`. Dat is het `itemId` van het item waarvan de
  poging faalde, als `online()` vóór die poging waar was, de fout geen
  niet-lege `code` had, en het item daardoor blijft staan. In alle andere
  gevallen is het `null`: offline, een fout met een code, een definitieve
  fout, of geen fout. Of het item blijft staan of definitief valt, beslist
  nog altijd `online()` in de `catch` (offline-spec §6).
- **`useOfflineVoorraad`** houdt een `Set<string>` met onzekere item-id's bij,
  op moduleniveau naast `lopend`.
  - `verstuurNu` voegt `r.onzeker` toe.
  - `zetInWachtrij(item, reden, { onzeker })` zet het merk als de aanroeper
    dat vraagt, en wist het anders. Zo erft een nieuwe, zekere afstreping
    nooit het merk van een vorige. `afstrepen` op de voorraadpagina vraagt
    het als `navigator.onLine` waar was vóór `close()`, en de fout geen
    niet-lege `code` had.
  - Het merk blijft staan zolang het item in de wachtrij staat, en verder
    wordt het niet gewist. De set groeit met één id per onzekere verzending,
    en dat is verwaarloosbaar.

Sinds `2026-10-04-twee-tabbladen-design.md` staat het merk niet meer in een
set in het geheugen, maar als `onzeker: true` in de wachtrij-ingang zelf,
zodat elk tabblad het ziet. Versturen en ongedaan maken nemen daar ook
hetzelfde slot over alle tabbladen heen.

## 6. Ongedaan maken

Eén gedeelde functie in `useOfflineVoorraad`, zodat de voorraadpagina en de
offline-pagina hetzelfde doen:

```ts
ongedaanMakenInWachtrij(item: VoorraadItem): Promise<'teruggezet' | 'nietBevestigd' | 'nietInWachtrij'>
```

1. Wachten op de lopende verzending (`wachtOpVerzending()`), zoals nu.
2. Staat de afstreping niet meer in de wachtrij, dan `'nietInWachtrij'`. De
   pagina doet dan wat ze nu doet:
   - de voorraadpagina een gewone `reopen` via `ongedaanMaken`;
   - de offline-pagina de melding `offlineVoorraad.alreadySent`.
3. Anders haalt de functie haar uit de wachtrij en zet ze het item terug in
   de kopie (`haalUitWachtrij`).
4. Was ze onzeker, dan volgt `reopen(item.id)`:
   - `true` of `false` geeft `'teruggezet'`. `true` betekent dat de server
     haar had; `false` dat hij haar niet had, of dat iemand anders het item
     al terugzette.
   - Een fout of een termijn geeft `'nietBevestigd'`.
5. Was ze zeker niet verstuurd, dan `'teruggezet'`, zonder verzoek naar de
   server.

Bij `'teruggezet'` en `'nietBevestigd'` toont de pagina het item weer. Bij
`'nietBevestigd'` toont ze ook de nieuwe melding
`offlineVoorraad.undoUnconfirmed`:

- **nl:** "Ongedaan maken kon niet bevestigd worden. Kijk de voorraad straks na."
- **en:** "Undo couldn't be confirmed. Check your inventory again later."
- **fr:** "La remise en stock n'a pas pu être confirmée. Vérifiez votre stock plus tard."

## 7. Foutgevallen

| Geval | Gedrag |
|---|---|
| Het verzoek naar een andere host dan Supabase | Ongewijzigd, zonder termijn. |
| Een auth-verzoek (`/auth/v1/`) | Ongewijzigd, zonder termijn (§2). |
| Een Supabase-URL met een slash erachter | Dezelfde prefix als zonder: `postgrestVoorvoegsel` bouwt haar zoals supabase-js zijn REST-URL bouwt. |
| Een aanroeper breekt zelf af | Het verzoek breekt af zoals voorheen. |
| De browser kent `AbortController` niet | Dat komt niet voor: elke browser die de PWA draagt, kent hem. |
| Onzekere afstreping, heropenen lukt | Het item staat weer open, zonder melding. |
| Onzekere afstreping, heropenen faalt | Het item staat lokaal weer, met de melding `undoUnconfirmed`. De volgende verversing toont de waarheid van de server. |
| Onzekere afstreping, een huisgenoot streepte het item intussen af | Heropenen zet ook die afstreping terug (§2). |

## 8. Testen

Elke bewaking krijgt een test die rood wordt als je ze weghaalt. De e2e-tests
gebruiken de echte termijn van 10 s, geen kortere voor de test: een te korte
termijn maakt de suite met meerdere workers wispelturig. Een verzoek dat
moet hangen, laat de route echt bij de server aankomen (`route.fetch()`) en
houdt alleen het antwoord tegen. Zo stuit alleen de termijn het af, en heeft
de server de afstreping intussen echt.

### Unit — `test/utils/termijn.test.ts`

| Test | Falsificatie |
|---|---|
| Een verzoek naar het voorvoegsel met een nep-`fetch` die nooit antwoordt, faalt na de termijn met een `AbortError` (termijn van enkele ms) | Zonder signaal hangt de test |
| Een andere URL gaat ongewijzigd door, zonder signaal | De termijn op alles zetten |
| Een signaal van de aanroeper breekt nog steeds af, ook als het al afgebroken was | Het eigen signaal laten vallen |
| Na de aanroep is `init.signal` het signaal dat afbreekt | De toewijzing weghalen |
| Een `Request`-object als invoer wordt herkend | Alleen strings lezen |
| Een `URL`-object als invoer wordt herkend | De `URL`-tak weghalen |
| `postgrestVoorvoegsel` geeft dezelfde prefix met en zonder slash achter de URL | De prefix als `` `${url}/rest/v1/` `` bouwen |
| Met die prefix gaat een auth-verzoek ongewijzigd door en breekt een PostgREST-verzoek af | De hele URL als prefix nemen |

### Unit — `test/utils/offlineVoorraad.test.ts`

| Test | Falsificatie |
|---|---|
| `isNetwerkfout` is waar voor `{ code: '', message: 'AbortError: …' }` en voor een `DOMException` met de naam `AbortError` | De nieuwe tak weghalen |
| `isNetwerkfout` is onwaar voor `AbortError: ` mét een databasecode | De codecontrole weghalen |
| `verstuurWachtrij` geeft als `onzeker` het id van het item dat online faalde | Het veld niet zetten |
| `verstuurWachtrij` geeft het item ook als `onzeker` als het toestel pas tijdens de poging offline ging | De online-status in de `catch` lezen |
| `onzeker` is `null` als het offline faalde, bij een fout met een code (`42501`), bij een definitieve fout en bij succes | Het veld altijd zetten; de codecontrole weghalen |

### End-to-end — `e2e/offline.spec.ts`

1. **Online afstrepen dat hangt** komt na de termijn in de wachtrij, met de
   toast `offlineVoorraad.queued`. Rood zonder de plugin, en zonder de tak
   `AbortError` in `isNetwerkfout`.
2. **Ongedaan maken van die afstreping** heropent haar op de server: na een
   herlaad staat het item er weer. Rood zonder `reopen` in
   `ongedaanMakenInWachtrij`, en zonder het merk in `afstrepen`.
3. **Hetzelfde voor een afstreping die de wachtrij onzeker verstuurde:**
   offline afgestreept, online gekomen, antwoord tegengehouden. Rood zonder
   het merk in `verstuurNu`.
4. **Faalt ook het heropenen**, dan verschijnt `undoUnconfirmed`. Rood
   zonder die melding.
5. **Zeker niet verstuurd:** de bestaande test "ongedaan maken zonder
   netwerk haalt de afstreping uit de wachtrij" krijgt erbij dat er geen
   PATCH vertrekt en geen foutmelding komt. Rood als elke ongedaanmaking zou
   heropenen.
6. **Een hangende `voorraad()`** bij het openen geeft na de termijn de
   foutstand, en het verzoek vertrekt precies één keer. Rood zonder de
   plugin, en zonder de toewijzing aan `init.signal`.
7. **Op de offline-pagina** heropent het ongedaan maken van een onzekere
   afstreping ook. Rood als de offline-pagina haar oude logica houdt.
8. **Faalt daar ook het heropenen**, dan verschijnt `undoUnconfirmed` op de
   offline-pagina. Rood zonder die melding in `OfflineVoorraad.vue`.
9. **Een verbinding die wegvalt midden in een afstreping** maakt haar
   onzeker. Een antwoord met een databasecode en daarna offline maakt haar
   niet onzeker. Rood als `afstrepen` de online-status in de `catch` leest,
   of de codecontrole mist.
10. **Een opnieuw afgestreept item erft het onzeker-merk niet.** Rood als
    `zetInWachtrij` het merk niet wist.
11. **Een verversing tijdens het heropenen** zet het item niet dubbel terug.
    Rood als `ongedaanMakenOffline` niet eerst filtert.
12. **Een tokenvernieuwing valt niet onder de termijn.** De route houdt het
    token-verzoek langer vast dan de termijn; de vernieuwing slaagt met één
    verzoek. Rood als de plugin de volle Supabase-URL als prefix neemt: dan
    breekt de termijn af en probeert auth-js een tweede keer.

Test 1 en 2 zijn één test: dezelfde hangende afstreping, eerst in de
wachtrij, dan ongedaan gemaakt. Zo kost dat één termijn in plaats van twee.

Toasts met Ongedaan maken worden in deze tests aangewezen met de muis, zoals
in de bestaande race-tests. Zo pauzeert hun timer van 5 s.

### Wat niet beloofd wordt

- **Safari en iOS** worden niet automatisch getoetst. Playwright's WebKit
  is geen echte iOS-PWA. De meldingtekst van een `AbortError` verschilt per
  browser, maar de naam niet, en daarop toetst `isNetwerkfout`.
- **Een hangende tokenvernieuwing** blokkeert zoals vóór deze spec, omdat
  auth buiten de termijn valt (§1). Via de auth-lock houdt ze elk verzoek
  erachter tegen.

## 9. Wat hier niet in zit

- Een termijn voor SSR-verzoeken.
- Een termijn voor auth-verzoeken (§1).
- Coördinatie tussen tabbladen.
- Een termijn per soort verzoek.

## 10. Gevolgen voor bestaand werk

| Wat | Gevolg |
|---|---|
| Nieuw | `app/utils/termijn.ts`, `app/plugins/termijn.client.ts`, `test/utils/termijn.test.ts` |
| `app/utils/offlineVoorraad.ts` | `isNetwerkfout` kent `AbortError`; `Verzendresultaat` krijgt `onzeker`. |
| `app/composables/useOfflineVoorraad.ts` | De onzeker-set, `zetInWachtrij(…, { onzeker })` en `ongedaanMakenInWachtrij`. |
| `app/pages/inventory/index.vue` | `afstrepen` markeert onzeker; `ongedaanMakenOffline` gebruikt `ongedaanMakenInWachtrij`. |
| `app/components/OfflineVoorraad.vue` | `maakOngedaan` gebruikt `ongedaanMakenInWachtrij`. |
| `i18n/locales/*.json` | `offlineVoorraad.undoUnconfirmed` in de drie talen. |
| `docs/superpowers/open-bevindingen.md` | De rij "zonder timeout" verdwijnt. Het risico van de huisgenoot komt bij de rij over vervallen verzendingen. |
| `docs/superpowers/specs/2026-10-03-offline-voorraad-design.md` | §6 krijgt een verwijzing naar deze spec. |

## 11. Afwijkingen tijdens de uitvoering

| Wat | Waarom |
|---|---|
| **De termijn geldt alleen voor PostgREST**, niet voor auth. Het voorvoegsel komt uit `postgrestVoorvoegsel(url)`, dat het bouwt zoals supabase-js (met of zonder slash erachter dezelfde prefix); `order: -25` vervalt. | Breekt de termijn een tokenvernieuwing af die de server al verwerkte, dan probeert auth-js opnieuw met een refresh-token dat al geroteerd is. Buiten de reuse-interval van 10 s antwoordt GoTrue "already used", en is het access-token verlopen, dan wist auth-js de sessie. Verify en de PKCE-uitwisseling lukken maar één keer. |
| **Onzeker hangt af van de online-status vóór de poging**, in `verstuurWachtrij` en in `afstrepen`. | Valt de verbinding weg midden in het antwoord, dan is het toestel in de `catch` al offline. De afstreping telde dan als zeker, terwijl de server haar kan hebben, en ongedaan maken ging stil verloren. |
| **Elke nieuwe wachtrij-ingang zet het merk of wist het** (`zetInWachtrij`). De deletes in `haalUitWachtrij` en `verstuurNu` vervallen. | Het merk werd alleen toegevoegd. Na uitloggen en weer inloggen, of na `ruimOp`, kon een oud merk blijven staan, en dan erfde een latere, zekere afstreping van hetzelfde item het. Haar ongedaanmaking stuurde dan een `reopen`: offline een valse `undoUnconfirmed`, online mogelijk de heropening van de afstreping van een huisgenoot. |
| **`ongedaanMakenOffline` filtert het item eerst uit de lijst** voor het terugzetten. | Het terugzetten volgt op een `reopen` van tot 10 s. Een verversing in dat venster kan het item al bevatten, en dan stond het er twee keer. |
