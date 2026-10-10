# Ongedaan maken heropent alleen je eigen afstreping — ontwerp

Ongedaan maken roept `useInventory().reopen(id)` aan. Die zet het item terug
in voorraad als het gesloten is, ongeacht wie het sloot. In twee gevallen
heropent dat de afstreping van een huisgenoot. Zie de rij "Ongedaan maken na
een vervallen verzending heropent andermans afstreping" in
`docs/superpowers/open-bevindingen.md`.

1. **Een vervallen verzending.** Ik streep offline af, en intussen streept
   een huisgenoot hetzelfde item af. Mijn verzending raakt niets en vervalt.
   Ongedaan maken vindt de afstreping niet meer in de wachtrij en doet
   `reopen`. Dat zet het item van de huisgenoot terug.
2. **Een onzekere afstreping** (`2026-10-04-termijn-design.md` §5). Mijn
   verzending kwam misschien niet aan, en de huisgenoot streepte het item
   intussen af. Ongedaan maken doet `reopen` en zet het item van de
   huisgenoot terug.

Deze spec laat `reopen` alleen je eigen afstreping heropenen, en meldt het
wanneer het item intussen van een ander is.

## 1. Wat dit oplevert, en wat niet

**Wel:**
- `reopen` raakt alleen een item dat de ingelogde gebruiker zelf afstreepte.
- Raakt het niets, dan weet de app of het item in voorraad staat of van een
  ander is, en meldt ze dat laatste.

**Niet:**
- **Afdwingen in de database.** Het filter staat in de client. Een
  huisgenoot kan andermans afstreping nog altijd terugzetten als daar ooit
  een knop voor komt.
- **Een databasefunctie** die heropenen en nalezen in één keer doet.

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Filteren op `closed_by` in de client | Raakt alle drie de paden die `reopen` aanroepen, zonder migratie. `closed_by` is leesbaar voor `authenticated` (`grant select` op de tabel) en wordt door de trigger gezet, nooit door de client. | Een andere client of een toekomstige knop kan andermans afstreping nog steeds terugzetten. |
| Niet in de database (trigger of RLS) | Dat blokkeert elke toekomstige functie om andermans afstreping te herstellen. Een item van een verwijderd account (`closed_by` leeg) kon dan door niemand meer heropend worden. | Geen. |
| Na nul geraakte rijen nalezen | "Nul rijen" betekent twee dingen: het item stond nooit gesloten (mijn afstreping kwam niet aan), of iemand anders sloot het. Het eerste moet terug in de lijst, het tweede niet. | Eén extra leesverzoek, alleen in dat randgeval. De update en het nalezen hebben elk hun eigen termijn van 10 s, dus ongedaan maken kan in dit randgeval tot ~20 s duren. |
| Niet: eerst lezen, dan heropenen | Altijd twee verzoeken, en een groter venster voor een huisgenoot ertussen. | Geen. |
| Niet: een RPC | De voorraad-spec (`2026-10-01-voorraad-design.md` §3) koos voor rechtstreeks schrijven onder RLS, zonder RPC's. | Geen. |
| Een verwijderd item telt als "van een ander" | Voor de gebruiker is het hetzelfde: het komt niet terug, en iemand anders deed iets. Eén melding dekt beide. | De melding noemt beide mogelijkheden. |

## 3. Wat `reopen` belooft

In `app/composables/useInventory.ts`:

```ts
export type Heropening = 'heropend' | 'nietGesloten' | 'vanEenAnder'

async function reopen(id: string): Promise<Heropening>
```

1. **Geen ingelogde gebruiker:** `reopen` gooit.
2. **De update** filtert op `id`, op `status = 'closed'` én op
   `closed_by = de ingelogde gebruiker`. Raakt ze één rij, dan is de
   uitkomst `'heropend'`. De trigger wist `closed_at`, `closed_by` en
   `closed_reason`, zoals nu.
3. **Raakt ze niets**, dan leest `reopen` het item na: `select('status')`
   op `id`, met `maybeSingle()`.
   - Staat het in voorraad: `'nietGesloten'`. Mijn afstreping kwam nooit
     aan, of iemand zette het al terug.
   - Is het gesloten, door een huisgenoot of door een verwijderd account
     (`closed_by` leeg): `'vanEenAnder'`.
   - Is het niet meer te vinden, omdat het verwijderd is: `'vanEenAnder'`.
4. **Fouten** gooien zoals nu: een netwerkfout, de termijn, en de
   samenhangfout van een verwijderde plaats (`isSamenhangFout`). Een fout bij
   het nalezen gooit ook.

Zet een huisgenoot het item terug tussen de update en het nalezen, dan geeft
dat `'nietGesloten'`. Dat klopt, want het staat dan in voorraad.

## 4. Wat de pagina's ermee doen

**De melding.** Nieuw in `i18n/locales/*.json`, als `inventory.undoByOther`:
- **nl:** "Niet ongedaan gemaakt: iemand anders heeft dit item intussen
  afgestreept of verwijderd."
- **en:** "Not undone: someone else checked off or deleted this item in the
  meantime."
- **fr:** "Pas remis en stock : quelqu'un d'autre a retiré ou supprimé cet
  article entre-temps."

**Voorraadpagina, `ongedaanMaken`.** Hier komt ook het pad "niet meer in de
wachtrij" langs.

| Uitkomst | Gevolg |
|---|---|
| `'heropend'` | Het item terug in de kopie (`zetTerugInDeKopie`), zoals nu bij `true`, dan verversen. |
| `'nietGesloten'` | Alleen verversen, zoals nu bij `false`. |
| `'vanEenAnder'` | De melding `inventory.undoByOther` (kleur `warning`), dan verversen. |
| Een fout | `cannotUndo` of de algemene fout, zoals nu. |

**Een onzekere afstreping, `ongedaanMakenInWachtrij`.** `Ongedaanuitkomst`
krijgt een vierde waarde, `'vanEenAnder'`.

| Uitkomst van `reopen` | `ongedaanMakenInWachtrij` geeft |
|---|---|
| `'heropend'` of `'nietGesloten'` | `'teruggezet'`, zoals nu |
| `'vanEenAnder'` | `'vanEenAnder'`. `haalUitWachtrij` zette het item al terug in de kopie; de composable streept het daar weer af (`streepAfInDeKopie`). |
| Een fout | `'nietBevestigd'`, zoals nu |

**De pagina's bij `'vanEenAnder'`:**
- De voorraadpagina (`ongedaanMakenOffline`) zet het item níet terug in de
  lijst en toont `inventory.undoByOther`.
- De offline-pagina (`maakOngedaan` in `OfflineVoorraad.vue`) toont
  `inventory.undoByOther`. Het item blijft weg, want het staat niet meer in
  de kopie.

**Ongewijzigd.** Op de offline-pagina geeft "niet meer in de wachtrij" nog
altijd `alreadySent`, zonder `reopen`.

## 5. Testen

Elke bewaking krijgt een test die rood wordt als je ze weghaalt. De termijn
blijft 10 s, en er zijn geen vaste pauzes als vervanging voor volgorde.

**De huisgenoot nabootsen.**
- Een helper in `e2e/offline.spec.ts` maakt met `createUser` uit
  `test/db/helpers.ts` een tweede, echte gebruiker aan.
- Daarna streept hij binnen een transactie, met `actAs(huisgenoot)`, het item
  af: `status = 'closed'` en een reden. De trigger zet `closed_by` dan op die
  gebruiker. De update raakt alleen een item in voorraad en gooit tenzij er
  precies één rij terugkomt: was het al gesloten, dan zegt de fout dat.
- Het item-id komt uit de wachtrij-ingang van mijn eigen afstreping, zodat de
  huisgenoot precies dat item raakt.
- `DATABASE_URL` staat in de e2e-job van CI en in de lokale `.env`. Elke
  databasehelper eist een lokale host, vóór er verbonden wordt: `withDb` en
  `withTwoConnections` roepen `assertLocalDatabase` aan, dus ook `createUser`
  en `withTx`. Bewezen in `test/db/reset-db-guard.test.ts`.

### End-to-end — `e2e/offline.spec.ts`

1. **Een vervallen verzending, dan ongedaan maken.**
   - Ik streep offline af. Daarna streept de huisgenoot hetzelfde item af.
   - Ik kom online; de verzending raakt niets en vervalt (de wachtrij is leeg).
     Dan klik ik Ongedaan maken.
   - **Verwacht:** de melding `undoByOther`, en na een herlaad `×1`.
   - **Rood** zonder het filter op `closed_by` (dan `×2`), en zonder de
     melding.
2. **Een onzekere afstreping, en intussen de huisgenoot.**
   - Mijn PATCH bereikt de server nooit en stuit op de termijn. De huisgenoot
     streept hetzelfde item af. Ik maak ongedaan.
   - **Verwacht:** de melding, het item blijft weg (`×1`), en het staat niet
     meer in de kopie.
   - **Rood** zonder het filter, wanneer `'vanEenAnder'` als `'teruggezet'`
     behandeld wordt, en zonder `streepAfInDeKopie`.
3. **Een onzekere afstreping die nooit aankwam, zonder huisgenoot.**
   - **Verwacht:** het item staat terug (`×2`), zonder melding.
   - **Rood** wanneer `'nietGesloten'` als `'vanEenAnder'` behandeld wordt.
4. **Op de offline-pagina: een onzekere afstreping, en intussen de
   huisgenoot.**
   - Ik streep af op de offline-pagina. Het online-event laat de plugin
     versturen, maar de PATCH bereikt de server nooit en stuit op de termijn.
     De huisgenoot streept hetzelfde item af. Ik maak ongedaan.
   - **Verwacht:** de melding `undoByOther`, en het item blijft weg.
   - **Rood** zonder de melding in `OfflineVoorraad.vue`.
5. **Een fout bij het nalezen.**
   - Mijn PATCH stuit op de termijn; de huisgenoot streept het item af. Elk
     nalezen (`GET` met `select=status`) wordt afgebroken, ook de herhalingen
     van postgrest-js.
   - **Verwacht:** de melding `undoUnconfirmed`, niet `undoByOther`: de
     waarheid is onbekend.
   - **Rood** zonder `if (leesfout) throw leesfout` (dan `nu === null`, dus
     `'vanEenAnder'`).
6. **Een verwijderd item.**
   - Mijn PATCH stuit op de termijn; de huisgenoot verwijdert het item. Ik
     maak ongedaan.
   - **Verwacht:** de melding `undoByOther`, het item blijft weg (`×1`), en het
     staat niet meer in de kopie.
   - **Rood** wanneer `nu === null` als `'nietGesloten'` behandeld wordt.

**Bestaande tests.** "Een hangende afstreping … heropent haar op de server"
(mijn afstreping kwam wel aan, dus `'heropend'`) en de gewone online
ongedaanmaking blijven groen.

### Wat niet beloofd wordt

- **`reopen` gooit zonder ingelogde gebruiker.** Daar is geen test voor:
  ongedaan maken zonder sessie loopt al eerder vast op de server.

## 6. Gevolgen voor bestaand werk

| Wat | Gevolg |
|---|---|
| `app/composables/useInventory.ts` | `reopen` geeft `Heropening` terug en filtert op `closed_by`. |
| `app/composables/useOfflineVoorraad.ts` | `Ongedaanuitkomst` krijgt `'vanEenAnder'`; `ongedaanMakenInWachtrij` vertaalt de uitkomst van `reopen`. |
| `app/pages/inventory/index.vue` | `ongedaanMaken` en `ongedaanMakenOffline` behandelen de nieuwe uitkomsten. |
| `app/components/OfflineVoorraad.vue` | `maakOngedaan` toont `undoByOther` bij `'vanEenAnder'`. |
| `i18n/locales/*.json` | `inventory.undoByOther` in de drie talen. |
| `e2e/offline.spec.ts` | Een helper voor de huisgenoot en vier tests. |
| `docs/superpowers/open-bevindingen.md` | De rij "Ongedaan maken na een vervallen verzending heropent andermans afstreping." verdwijnt. |
