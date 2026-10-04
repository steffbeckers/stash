# Ongedaan maken over twee tabbladen — ontwerp

De offline-ronde (`2026-10-03-offline-voorraad-design.md`) en de termijn
(`2026-10-04-termijn-design.md`) garanderen dat een ongedaanmaking tijdens een
verzending niet verloren gaat. Die garantie geldt binnen één tabblad.
`wachtOpVerzending()` wacht alleen op `lopend` in hetzelfde tabblad, en het
onzeker-merk leeft in het geheugen van dat ene tabblad. Zie de rij "Ongedaan
maken over twee tabbladen" in `docs/superpowers/open-bevindingen.md`.

Twee gevallen gaan nu mis:

1. **De race.** Je streept af in tabblad 2, offline. Tabblad 1 krijgt het
   online-event en verstuurt de wachtrij. Ongedaan maken in tabblad 2 haalt
   de afstreping uit de wachtrij terwijl tabblad 1 ze al naar de server
   stuurt. De gebruiker ziet het item terugkomen, maar de server sluit het.
2. **Het merk.** Stuit de verzending van tabblad 1 op de termijn, dan is de
   afstreping onzeker. Tabblad 2 weet dat niet, en heropent bij ongedaan
   maken niets op de server.

Deze spec maakt de garantie geldig over alle tabbladen heen.

## 1. Wat dit oplevert, en wat niet

**Wel:**
- Versturen en ongedaan maken nemen hetzelfde slot, over alle tabbladen heen.
- Het onzeker-merk staat in de wachtrij-ingang zelf, zodat elk tabblad het ziet.

**Niet:**
- **Eén verzendend tabblad.** Elk tabblad verstuurt nog zelf, alleen nooit
  tegelijk. Een tweede verzending vindt de wachtrij leeg of de afstreping al
  gesloten, en sluiten is idempotent.
- **Browsers zonder Web Locks.** Daar blijft het gedrag binnen één tabblad
  zoals het was (§3).

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Web Locks (`navigator.locks`) | De browser regelt de wachtrij tussen tabbladen. Een tabblad dat sluit of vastloopt, laat het slot vanzelf los. Safari heeft het sinds iOS 15.4. supabase-js biedt er een wrapper rond, maar gebruikt ze hier niet: auth-js is standaard zonder slot. | Een browser zonder Web Locks valt terug op het oude gedrag. Het slot ordent alleen de code van de tabbladen, niet de opslag: `localStorage` kan tussen processen even achterlopen, zie de bevinding "Het wachtrijslot ordent de code, niet de opslag" in `docs/superpowers/open-bevindingen.md`. |
| Niet: één verzendend tabblad via BroadcastChannel | Leiderskeuze en het overnemen bij een gesloten leider zijn extra onderdelen. Het slot voor ongedaan maken blijft dan toch nodig. | Geen: het slot volstaat. |
| Niet: een eigen mutex in `localStorage` | Een tabblad dat crasht, laat een slot achter dat pas na een timeout vrijkomt. Het bouwt na wat de browser al biedt. | Geen. |
| De sessiecontrole vóór het slot | Auth valt buiten de termijn. Een hangende tokenvernieuwing binnen het slot zou het voor alle tabbladen vasthouden. | Tussen de controle en het slot kan de sessie verlopen. Dan antwoordt de server met `42501`, en `verstuurWachtrij` houdt de afstreping vast, zoals bij elke verlopen sessie. |
| Binnen het slot bij ongedaan maken alleen het synchrone deel | De ingang lezen en weghalen duurt geen tijd. `reopen` kan tot 10 s duren en hoort het slot niet zo lang vast te houden. | Geen: na het weghalen kan geen verzending de afstreping nog meenemen. |
| Het merk in de ingang, niet in het geheugen | Elk tabblad leest dezelfde wachtrij. Een extra veld past in versie `1`, want `leesWachtrij` controleert alleen de verplichte velden en houdt de rest. | Een ingang uit een oudere versie heeft geen merk en geldt als zeker, net als nu. |

## 3. Het slot

In `app/utils/offlineVoorraad.ts`, puur:

```ts
export const WACHTRIJ_SLOT = 'stash.wachtrij'

export function metWachtrijslot<T>(
  locks: LockManager | undefined,
  anders: () => Promise<unknown>,
  werk: () => T | Promise<T>,
): Promise<T>
```

- **Met een `LockManager`:** `locks.request(WACHTRIJ_SLOT, werk)`. Het slot
  is exclusief, over alle tabbladen van dezelfde oorsprong.
- **Zonder:** eerst `anders()` afwachten, dan `werk()`. In de app is
  `anders` het wachten op `lopend` in het eigen tabblad, het gedrag van
  vóór deze spec.

In `app/composables/useOfflineVoorraad.ts` geeft een kleine helper
`navigator.locks` mee als die bestaat, anders `undefined`.

**Versturen** (`verstuurNu`):
1. Gebruiker en sessie controleren, buiten het slot, zoals nu.
2. Binnen het slot:
   - de eigen wachtrij opnieuw lezen, want een ander tabblad kan intussen
     verstuurd hebben;
   - is ze leeg, dan stoppen;
   - anders versturen (`verstuurWachtrij`) en terugschrijven, met het merk
     (§4).
3. De toast `notSent` volgt na het slot.

`lopend` blijft bestaan: binnen één tabblad delen de plugin en de pagina zo
één verzending. Versturen gebruikt als `anders` niets (`Promise.resolve()`),
want zonder Web Locks is er geen slot tussen tabbladen.

**Ongedaan maken** (`ongedaanMakenInWachtrij`):
1. Binnen het slot, synchroon, met als `anders` het wachten op `lopend`:
   - lezen of een ingang voor dit item het merk heeft;
   - de ingang weghalen en het item terugzetten in de kopie
     (`haalUitWachtrij`).
2. Stond ze er niet meer in, dan `'nietInWachtrij'`.
3. Na het slot: was ze onzeker, dan `reopen`, zoals in de termijn-spec §6.

Met Web Locks vervangt het slot het aparte `await wachtOpVerzending()` in
`ongedaanMakenInWachtrij`. Een verzending in hetzelfde tabblad houdt het slot
ook vast.

**Wachttijd.** Ongedaan maken in tabblad 2 wacht op een verzending in
tabblad 1. Die duurt ten hoogste 10 s per verzoek dat hangt, en de
verzending stopt bij de eerste fout.
Die grens gaat ervan uit dat het tabblad met het slot blijft draaien (een bevroren tabblad vuurt zijn timer niet af), en de voorraadpagina wacht bij het openen ook op de verzending van een ander tabblad. Zie de bevinding "Een bevroren tabblad houdt het wachtrijslot vast" in `docs/superpowers/open-bevindingen.md`.

## 4. Het onzeker-merk in de ingang

- **Het type.** `Wachtrijitem` krijgt een optioneel veld `onzeker?: true`.
  Alleen precies `true` telt.
- **Bij het afstrepen.** `zetInWachtrij(item, reden, { onzeker })` schrijft
  het veld alleen als `onzeker` waar is. Een nieuwe ingang is een nieuw
  object en erft dus nooit een oud merk.
- **Na een verzending.** Een pure functie
  `markeerOnzeker(wachtrij: Wachtrij, ingang: Wachtrijitem): Wachtrij` zet
  `onzeker: true` op de ingang met hetzelfde `itemId` én `afgestreeptOp`, en
  laat alle andere ongemoeid. `verstuurNu` past haar toe bij het
  terugschrijven, op de ingang uit de verzonden momentopname waarvan
  `itemId` gelijk is aan `r.onzeker`.
- **Bij ongedaan maken.** Het merk komt uit de opslag:
  `wachtrij.some((w) => w.itemId === item.id && w.onzeker === true)`. Staat
  hetzelfde item twee keer in de wachtrij (twee keer afgestreept tijdens een
  hangend verzoek), dan is één merk genoeg.
- **De set in het geheugen** (`const onzeker = new Set<string>()`) verdwijnt.

## 5. Foutgevallen

| Geval | Gedrag |
|---|---|
| De browser kent `navigator.locks` niet | Het gedrag van vóór deze spec: wachten op de verzending in het eigen tabblad. |
| Een tabblad sluit tijdens een verzending | De browser laat het slot los. De afstreping staat nog in de wachtrij, en het volgende versturen neemt haar mee. |
| Twee tabbladen versturen na elkaar | Het tweede vindt de wachtrij leeg, of de afstreping al gesloten (`vervallen`). |
| Ongedaan maken in tabblad 2, de verzending van tabblad 1 lukte | `'nietInWachtrij'`. De voorraadpagina heropent op de server, de offline-pagina toont `alreadySent`. |
| Ongedaan maken in tabblad 2, de verzending van tabblad 1 was onzeker | Het merk staat in de ingang, dus `reopen`. |

## 6. Testen

Elke bewaking krijgt een test die rood wordt als je ze weghaalt.

### Unit — `test/utils/offlineVoorraad.test.ts`

| Test | Falsificatie |
|---|---|
| `metWachtrijslot` met een nep-`LockManager`: de naam is `stash.wachtrij`, en twee werken lopen na elkaar, niet door elkaar | Het slot overslaan |
| `metWachtrijslot` zonder `LockManager` wacht eerst op `anders()` | Niet wachten |
| `markeerOnzeker` zet het merk op de ingang met hetzelfde `itemId` en `afgestreeptOp`, en niet op een opnieuw afgestreepte ingang van hetzelfde item | Alleen op `itemId` matchen |
| `leesWachtrij` bewaart `onzeker: true` | — (bestaand gedrag, vastgepind) |

### End-to-end — `e2e/offline.spec.ts`

**Opzet.** Twee pagina's in dezelfde context delen `localStorage` en de Web
Locks.
- Tabblad 2 is de offline-pagina, online geopend. Afstrepen daar komt altijd
  zeker in de wachtrij, zonder verzoek naar de server.
- Tabblad 1 is de voorraadpagina. De test vuurt het online-event alleen daar
  af, zodat alleen tabblad 1 verstuurt. Zou tabblad 2 zelf versturen, dan
  verborg die verzending het verschil.

1. **Ongedaan maken in tabblad 2 wacht op de verzending van tabblad 1.**
   - De PATCH van tabblad 1 blijft hangen tot de test hem vrijgeeft.
     Tabblad 2 klikt intussen Ongedaan maken.
   - Na het vrijgeven toont tabblad 2 `alreadySent`, en de afstreping staat
     op de server.
   - Rood zonder het slot: tabblad 2 haalt de ingang dan meteen weg, en
     `alreadySent` komt nooit.
2. **Een onzekere verzending van tabblad 1 wordt in tabblad 2 heropend.**
   - De PATCH van tabblad 1 komt op de server aan, maar het antwoord blijft
     hangen tot de termijn.
   - Ongedaan maken in tabblad 2 heropent het item. Na een herlaad staat er
     `×2`.
   - Rood als het merk uit het geheugen komt in plaats van uit de ingang, en
     rood zonder het slot.

**Bestaande tests.** De race-tests en de onzeker-tests binnen één tabblad
blijven groen. "Ongedaan maken tijdens een verzending wacht op die
verzending" bewaakt voortaan het slot en wordt rood zonder.

### Wat niet beloofd wordt

- **De sessiecontrole vóór het slot** heeft geen test. Een tokenvernieuwing
  op commando laten hangen tijdens een verzending is in e2e niet betrouwbaar
  uit te lokken. Deze bewaking is gecontroleerd door de code te lezen.
- **Het opnieuw lezen van de wachtrij binnen het slot** heeft geen e2e. Een
  verouderde lezing doet pas kwaad als een ongedaanmaking het slot krijgt
  tussen die lezing en de verzending, en dat vraagt drie verzendingen in een
  vaste volgorde over twee tabbladen. De code leest de wachtrij alleen binnen
  het slot; buiten het slot staat alleen een snelle controle op een lege
  wachtrij, zonder dat die lezing verder gebruikt wordt.
- **De terugval zonder Web Locks** is alleen in unit getoetst. Chromium heeft
  Web Locks altijd.
- **Safari en iOS** worden niet automatisch getoetst.

## 7. Gevolgen voor bestaand werk

| Wat | Gevolg |
|---|---|
| `app/utils/offlineVoorraad.ts` | `WACHTRIJ_SLOT`, `metWachtrijslot`, `markeerOnzeker`; `Wachtrijitem.onzeker?: true`. |
| `test/utils/offlineVoorraad.test.ts` | Tests uit §6. |
| `app/composables/useOfflineVoorraad.ts` | De set verdwijnt; `zetInWachtrij` schrijft het merk in de ingang; `verstuurNu` en `ongedaanMakenInWachtrij` nemen het slot. |
| `e2e/offline.spec.ts` | Twee tests met twee tabbladen. |
| `docs/superpowers/open-bevindingen.md` | De rij "Ongedaan maken over twee tabbladen" verdwijnt. |
| `docs/superpowers/specs/2026-10-04-termijn-design.md` | §5 verwijst naar deze spec: het merk staat in de ingang. |
