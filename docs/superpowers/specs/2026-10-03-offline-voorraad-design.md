# Offline voorraad — ontwerp

§9 van het hoofdontwerp (`2026-09-21-stash-design.md`) belooft een
voorraadlijst die werkt zonder netwerk: je staat in de kelder of bij de
vriezer in de garage. De PWA-ronde (`2026-09-25-pwa-design.md`) maakte de
schil offline bruikbaar, maar hield data bewust buiten de cache. De
voorraadronde (`2026-10-01-voorraad-design.md`) maakte afstrepen idempotent,
met het oog op precies deze ronde. Deze spec maakt de belofte waar.

## 1. Wat dit oplevert, en wat niet

**Wel:** zonder netwerk zie je de laatst gesynchroniseerde voorraad van je
actieve huishouden, en kan je items afstrepen als opgemaakt of weggegooid.
Die afstrepingen wachten op het toestel en worden verstuurd zodra er weer
netwerk is. Valt het netwerk weg terwijl de voorraadpagina openstaat, dan
gaat afstrepen gewoon door.

**Niet:**

- **Toevoegen, bewerken en verwijderen zonder netwerk.** Toevoegen vraagt
  product-id's die offline bestaan, dus een lokale catalogus, en bewerken
  vraagt conflictregels. Offline toont geen knoppen voor deze drie.
- **De voorraadpagina zelf offline openen.** Offline geeft de service worker
  de offline-pagina (zie §3), en die toont de lokale kopie. De URL blijft die
  van de voorraad; de inhoud is de offline-weergave.
- **Meer dan één huishouden offline.** Alleen het actieve huishouden wordt
  gekopieerd.
- **Achtergrondsynchronisatie** via de Background Sync API. Die bestaat niet
  in Safari. Versturen gebeurt wanneer de app open is.

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Lezen en afstrepen, niets anders | Dat is het kelderscenario. Afstrepen is al idempotent, en de rest vraagt een lokale catalogus of conflictregels. | Wie offline iets wil toevoegen, moet wachten. |
| De offline-pagina toont de kopie, geen app-shell | Hergebruikt het geteste vangnet. De service worker en de privacykeuze uit het PWA-ontwerp (nooit HTML met huishouddata cachen) blijven ongemoeid. Geen SSR-wijziging. | Offline is een aparte weergave, geen gewone voorraadpagina. |
| De kopie hangt niet af van een geldige sessie | De offline-pagina is publiek en geprerenderd, en een Supabase-sessie verloopt standaard na een uur. Wie langer offline is, heeft geen bruikbare sessie meer. De kopie draagt daarom zelf haar eigenaar. | Wie niet uitlogt, laat de kopie op het toestel staan, net zoals de sessie zelf blijft staan. |
| `localStorage`, niet IndexedDB | Een voorraad van een paar honderd items is enkele honderden KB. Synchroon, geen extra pakket, en makkelijk te testen met een nep-opslag. | Wordt de kopie ooit veel groter, dan is overstappen een wijziging in één bestand. |
| Gewist bij uitloggen en bij een andere gebruiker | Privédata op een toestel; dezelfde grens als in het PWA-ontwerp. | Een wachtrij die bij uitloggen nog niet verstuurd is, gaat verloren, met een bevestiging vooraf. |
| `closed_at` = het moment dat de server het ontvangt | De stempeltrigger zet `now()`, en de kolomrechten laten de client dat veld bewust niet schrijven (voorraad-spec §3). Een RPC die een tijdstip uit het verleden aanvaardt, breekt "de database bepaalt wanneer" open. | Een offline afstreping krijgt een tijdstip uren of dagen na de tik. Voor verspillingscijfers per jaar onbelangrijk. |
| Versturen via het bestaande `close()` | Het filter op `in_stock` maakt dubbel versturen onschadelijk. Er is geen nieuw schrijfpad. | Geen. |

## 3. Hoe de voorraad offline opent

Offline faalt elke navigatie. De navigatiehandler in `app/sw.ts` geeft dan de
offline-pagina uit de precache die bij de taalprefix hoort. Die is per taal
geprerenderd, heeft geen auth en heeft geen data nodig. Dat blijft zo.

Wat erbij komt: `app/pages/offline.vue` leest na het mounten de lokale kopie
uit `localStorage`. Is er een kopie, dan toont de pagina de offline-weergave
(§7) in plaats van alleen de melding. Er gaat niets via het netwerk en er is
geen sessie voor nodig.

De service worker verandert niet. Er wordt geen HTML met huishoudgegevens
gecachet: alleen de data staat op het toestel, en die is te wissen.

## 4. De lokale opslag

Twee sleutels in `localStorage`, elk één JSON-waarde.

**`stash.offline.kopie`**

```ts
interface Kopie {
  versie: 1
  eigenaar: string                         // gebruikers-id
  huishouden: { id: string; naam: string }
  bewaardOp: string                        // ISO-tijdstip
  plaatsen: Bewaarplaats[]
  items: VoorraadItem[]                    // in_stock, naam al in de taal van de gebruiker
}
```

**`stash.offline.wachtrij`**

```ts
interface Wachtrijitem {
  itemId: string
  reden: Reden
  eigenaar: string
  afgestreeptOp: string                    // ISO-tijdstip van de tik, alleen voor weergave
  item: VoorraadItem                       // om ongedaan maken terug te zetten
}
type Wachtrij = Wachtrijitem[]
```

`Bewaarplaats`, `VoorraadItem` en `Reden` zijn de typen uit
`app/utils/voorraad.ts`.

**Lezen is altijd veilig.** Ontbreekt een waarde, is ze geen geldige JSON,
heeft ze een andere `versie` of de verkeerde vorm, dan is er "geen kopie" of
een lege wachtrij. Nooit een crash: de offline-pagina moet altijd openen.

**Schrijven mag mislukken.** `localStorage` kan vol zijn of geblokkeerd
(privémodus). Dan wordt dat gelogd, en werkt de online pagina verder alsof
er niets aan de hand is. Offline is er dan gewoon geen kopie.

## 5. Gegevensstroom

1. **De voorraadpagina opent (online).**
   - Ze wacht eerst op `verstuur()` (§6). Pas daarna laadt ze van de server,
     zodat de server geen item terugzet dat in de wachtrij al afgestreept is.
   - Na een geslaagde lading schrijft ze de kopie weg.
   - Elke geslaagde verversing schrijft de kopie opnieuw.
2. **Het netwerk valt weg terwijl de pagina openstaat.** Faalt `close()` met
   een netwerkfout (§6), en alleen dan:
   - de afstreping gaat in de wachtrij;
   - het item verdwijnt uit de lijst op het scherm en uit de kopie;
   - de toast zegt "Afgestreept — wordt verstuurd zodra je weer online
     bent", met Ongedaan maken, dat de afstreping uit de wachtrij haalt en
     het item terugzet.

   Elke andere fout gedraagt zich zoals nu.
3. **De app opent offline.** De offline-pagina toont de kopie (§7).
   Afstrepen haalt het item uit de kopie en zet het in de wachtrij. Ongedaan
   maken doet het omgekeerde.
4. **Het netwerk komt terug.** Een client-plugin roept `verstuur()` aan bij
   elk `online`-event, en bij het opstarten van de app als er een gebruiker
   is.

## 6. Versturen

De kern is een pure functie, zonder Nuxt:

```ts
verstuurWachtrij(
  wachtrij: Wachtrij,
  sluit: (itemId: string, reden: Reden) => Promise<boolean>,
): Promise<{ resterend: Wachtrij; verstuurd: number; vervallen: number; mislukt: number }>
```

In volgorde, per item:

| Uitkomst van `sluit` | Gevolg |
|---|---|
| `true` | verstuurd, uit de wachtrij |
| `false` (nul rijen: al afgestreept of verwijderd) | vervallen, stil uit de wachtrij. Dat is de idempotentie uit voorraad-spec §7. |
| een netwerkfout | blijft staan; de rest wacht ook, want het netwerk is weg |
| een expliciete data- of integriteitsfout (SQLSTATE klasse `22` of `23`, bv. `23514`) | mislukt, uit de wachtrij |
| elke andere fout (`42501`, `PGRST…`, een serverfout, geen of een lege code, een afgebroken verzoek) | blijft staan, net als bij een netwerkfout; de rest wacht ook |

Sluiten is idempotent: bewaren kost niets, weggooien verliest werk. Een
verlopen sessie geeft `42501` (supabase-js stuurt dan de anon-sleutel mee), en
een captive portal of proxy geeft een antwoord zonder databasecode. Die mogen
geen afstrepingen wissen. "Geen lid meer" is geen fout: RLS op UPDATE maakt er
nul rijen van, en dat is `false`, dus vervallen.

`useOfflineVoorraad().verstuur()` koppelt dit aan `useInventory().close()`.
Het neemt alleen afstrepingen van de huidige gebruiker mee, en schrijft het
`resterend` terug. Is `mislukt` groter dan nul, dan toont het één toast "N
afstrepingen konden niet verstuurd worden". Lopen er twee aanroepen tegelijk
(plugin en pagina), dan delen ze één lopende verzending, zodat de pagina
écht wacht op de verzending die de plugin al startte.

**Een netwerkfout herkennen.** `isNetwerkfout(oorzaak, online)` is waar als
`online` onwaar is (`navigator.onLine`). Ook waar is: een fout zonder
databasecode met een fetchmelding van de browser. Chromium zegt "Failed to
fetch", Firefox "NetworkError…", Safari "Load failed". **De exacte vorm die
supabase-js in dat geval teruggeeft, meet het plan eerst na.** Deze spec
kent hem alleen uit een consolemelding ("TypeError: Failed to fetch").

## 7. De offline-weergave

`offline.vue` met een kopie toont:

- de bestaande titel "Je bent offline" en de knop "Opnieuw proberen";
- de naam van het huishouden en "laatst bijgewerkt op 3 okt om 14:20";
- het aantal wachtende afstrepingen, als dat er zijn;
- de strook "vervalt binnenkort" en de plaatsen met hun productgroepen, met
  dezelfde componenten als de voorraadpagina.

`InventoryPlace` en `InventoryGroup` krijgen een prop `alleenAfstrepen`. Die
verbergt de Toevoegen-link, Bewerken en Verwijderen. Afstrepen, met de
variantvraag, blijft. "Vandaag" is ook hier de lokale datum van het toestel.

Zonder kopie blijft de offline-pagina precies zoals ze nu is.

## 8. Privacy

- **Uitloggen** wist de kopie en de wachtrij. Staat er nog iets in de
  wachtrij, dan vraagt `UserMenu.vue` eerst een bevestiging: "N afstrepingen
  zijn nog niet verstuurd en gaan verloren als je nu uitlogt".
- **Een andere gebruiker.** Start de app met een ingelogde gebruiker die niet
  de eigenaar van de kopie is, dan wist de plugin de kopie meteen. Wat in de
  wachtrij van die andere eigenaar staat, wordt nooit verstuurd en ook gewist.
- **De offline-pagina** controleert geen sessie, want die is er offline
  misschien niet. Ze toont de kopie van wie de laatste eigenaar was. Wie het
  toestel deelt zonder uit te loggen, laat die kopie staan, net zoals de
  sessie zelf blijft staan.

## 9. Foutgevallen

| Geval | Gedrag |
|---|---|
| Opslag niet beschikbaar of vol | Online werkt alles, offline is er geen kopie. Gelogd, niet getoond. |
| Kopie onleesbaar of van een andere versie | Behandeld als geen kopie. |
| Kopie van een andere gebruiker | Gewist bij het eerste opstarten met een gebruiker. |
| Afstreping in de wachtrij, item intussen afgestreept of verwijderd | Vervallen, stil. |
| Afstreping faalt met een data- of integriteitsfout (klasse `22`/`23`) | Valt weg, met één toast met het aantal. Elke andere fout houdt haar vast (§6). |
| Twee tabbladen | Geen coördinatie. Dubbel versturen is onschadelijk. |
| De offline-pagina online geopend | Toont de kopie ook. Het is dezelfde pagina; "Opnieuw proberen" brengt je terug. |

## 10. Testen

De terugkerende faalmodus van dit project is een groene test die zijn
eigenschap niet bewijst. Elke bewaking hieronder wordt daarom één keer rood
gezien door weg te halen wat ze beschermt.

### Unit — `test/utils/offlineVoorraad.test.ts`

| Eigenschap | Falsificatie: haal weg… |
|---|---|
| Kapotte JSON, een andere `versie` of een ontbrekende waarde geeft geen kopie, geen crash | de `try` / de versiecontrole |
| Afstrepen in de kopie haalt precies dat item weg; terugzetten zet het terug | de filter / het terugzetten |
| `wachtrijVoor` geeft alleen afstrepingen van de eigenaar | het eigenaarsfilter |
| `isNetwerkfout`: waar voor de nagemeten fetchfout, voor "Load failed" en bij offline; onwaar voor `23514` en voor `permission denied` | elke tak apart |
| `verstuurWachtrij`: `true` verstuurd, `false` vervallen, een netwerkfout of een andere onzekere fout blijft staan en houdt de rest tegen, een fout uit klasse `22`/`23` telt als mislukt | elke tak apart |

### End-to-end tegen de dev-server — `e2e/offline.spec.ts`

Hier is geen service worker nodig. `context.setOffline()` laat elke fetch
falen, en `/offline` is gewoon te openen.

| Eigenschap | Falsificatie |
|---|---|
| De voorraadpagina bewaart een kopie: daarna toont `/offline` het item en "laatst bijgewerkt" | `bewaar()` niet aanroepen |
| Afstrepen zonder netwerk: ×2, offline, afstrepen → toast "wordt verstuurd" en ×1; online en herladen → nog steeds ×1, nu uit de database | `verstuur()` doet niets |
| Afstrepen op de offline-pagina: het item verdwijnt, "1 wachtend"; daarna de voorraadpagina openen en herladen → het aantal is gezakt | `verstuur()` doet niets |
| Uitloggen wist de kopie: daarna toont `/offline` geen voorraad | het wissen weghalen |
| Uitloggen met een wachtrij vraagt eerst bevestiging | de controle weghalen |
| Een andere gebruiker ziet de kopie van de vorige niet: A heeft een kopie, de sessiecookies worden gewist zonder uit te loggen, B logt in → `/offline` toont niets | de eigenaarscontrole weghalen |

### End-to-end tegen de gebouwde app — `e2e/pwa/offline.spec.ts`

| Eigenschap | Falsificatie |
|---|---|
| Offline opent `/inventory` de lokale voorraad: een kopie wordt via `localStorage` in de pagina gezet, de context gaat offline, en navigeren naar `/inventory` levert via de service worker de offline-pagina mét het item | de offline-pagina toont de kopie niet |

Deze test logt niet in: de offline-weergave heeft geen sessie nodig. Zo
bewijst hij de koppeling service worker → offline-pagina → kopie, die de
dev-tests niet kunnen zien, zonder een magic link tegen poort 3001.

### Wat niet beloofd wordt

- **Safari en iOS** worden niet automatisch getoetst. Playwright's WebKit is
  geen echte iOS-PWA. De meldingtekst van Safari staat wel in de unittest.
- **Twee tabbladen tegelijk** worden niet getoetst. De idempotentie is in de
  voorraadronde in de database bewezen.

## 11. Wat hier niet in zit

- Toevoegen, bewerken en verwijderen zonder netwerk.
- Een lokale catalogus.
- Achtergrondsynchronisatie.
- Meerdere huishoudens offline.
- Het werkelijke tijdstip van een offline afstreping in de database (§2).

## 12. Gevolgen voor bestaand werk

| Wat | Gevolg |
|---|---|
| `app/pages/offline.vue` | Toont de kopie als die er is. De commentaarregel "Geen data, geen auth, geen netwerk" wordt "geen auth, geen netwerk; wel de lokale kopie als die er is". |
| `app/pages/inventory/index.vue` | Verstuurt eerst, bewaart na elke lading, zet een afstreping met een netwerkfout in de wachtrij. |
| `app/components/InventoryPlace.vue`, `InventoryGroup.vue` | Prop `alleenAfstrepen`. |
| `app/components/UserMenu.vue` | Bevestiging bij een wachtrij; wissen bij uitloggen. |
| `app/sw.ts` | Ongewijzigd. |
| Nieuw | `app/utils/offlineVoorraad.ts`, `app/composables/useOfflineVoorraad.ts`, `app/plugins/wachtrij.client.ts`, `app/components/OfflineVoorraad.vue` (de weergave uit §7, zodat `offline.vue` klein blijft). |
| `i18n/locales/*.json` | Een blok `offlineVoorraad` in de drie talen. |
| `docs/superpowers/open-bevindingen.md` | De rij "Offline data" verdwijnt. De beperkingen uit §11 komen erbij waar ze een bevinding zijn. |

## 13. Afwijkingen tijdens de uitvoering

- **`verstuurWachtrij` heeft een derde parameter `online`** (standaard
  `navigator.onLine`). Offline is elke fout onzeker, ook een die online
  definitief zou zijn. Daarnaast valt een item alleen weg bij een fout uit
  SQLSTATE-klasse `22` of `23`; al het andere, ook een afgebroken verzoek,
  blijft staan (§6). Reden: sluiten is idempotent, en een verlopen sessie of
  een serverfout wiste anders de hele wachtrij.
- **Mislukt het schrijven naar de wachtrij, dan krijg je een foutmelding en
  blijft het item staan.** §9 zei "niet getoond". Reden: anders zegt de toast
  "wordt verstuurd" over een afstreping die nergens bewaard is.
- **De melding `offlineVoorraad.alreadySent` op de offline-pagina.** Reden:
  was de afstreping intussen verstuurd, dan kan de offline-pagina haar niet
  meer terugdraaien (heropenen vraagt de server), en zwijgen zou lijken alsof
  het ongedaan maken gelukt is.
- **`wachtOpVerzending()` en `voegWachtrijSamen()`.** Reden: de race bij
  ongedaan maken tijdens een verzending. Ongedaan maken wacht op de lopende
  verzending, en het terugschrijven van de wachtrij houdt rekening met wat er
  intussen veranderde, zodat een ongedaanmaking niet verloren gaat of
  teruggedraaid wordt.
- **Het filter op de eigen wachtrij in `laad()` en in `OfflineVoorraad.vue`.**
  Reden: een verversing tijdens een verzending zette een afgestreept item
  anders terug, in de lijst én in de kopie; alleen de wachtrij van de huidige
  gebruiker telt.
- **De wikkel-`<div>` in `UserMenu.vue`.** Reden: met de bevestigingsmodal
  erbij kreeg de component meerdere wortels, en dan valt de `class="ml-auto"`
  die `AppHeader` meegeeft weg.
- **De kopie wordt direct bijgewerkt na een online afstreping of
  ongedaanmaking** (`streepAfInDeKopie`, `zetTerugInDeKopie`). Reden: faalt de
  verversing na een geslaagde `close()` of `reopen()`, dan toonde de
  offline-pagina het item anders verkeerd.
