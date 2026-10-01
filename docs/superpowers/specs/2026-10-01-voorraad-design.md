# Voorraad — ontwerp

De eerste versie van waar de app om draait: wat er in huis is, waar het ligt
en wanneer het vervalt. Items toevoegen uit de catalogus per bewaarplaats, met
vervaldatums, en afstrepen met onderscheid tussen opgemaakt en weggegooid.

Het hoofdontwerp (`2026-09-21-stash-design.md`) schetst de tabel in §4
("Huishouden en voorraad (privé)") en de flow in §5 ("Voorraad en
afstrepen"). Deze spec maakt daar een bouwbaar geheel van, en zegt waar en
waarom hij van de schets afwijkt.

## 1. Wat dit oplevert, en wat niet

**Wel:** een lid van een huishouden ziet de voorraad per bewaarplaats,
gegroepeerd per product, met bovenaan wat binnenkort vervalt. Het kan items
toevoegen — ook van een product dat nog niet in de catalogus staat, dat
maakt het dan ter plekke aan — en items afstrepen als opgemaakt of
weggegooid, met de mogelijkheid dat meteen ongedaan te maken. Een fout
ingevoerd item kan echt weg.

**Niet:**

- **Offline.** §9 van het hoofdontwerp belooft een voorraadlijst die werkt
  zonder netwerk. Dat is een synchronisatieprobleem — een wachtrij van
  schrijfacties, twee huisgenoten die hetzelfde item afstrepen — en krijgt
  een eigen ronde. Deze ronde houdt de deur open: afstrepen is idempotent
  (§7).
- **Het verspillingsoverzicht in euro.** Daar zijn prijzen voor nodig, en die
  bestaan niet. `closed_reason` wordt wel vanaf de eerste dag vastgelegd, dus
  het overzicht kan later terugkijken.
- **`receipt_line_id`.** De kolom is nullable, maar `receipt_line` zelf
  bestaat nog niet, en een foreign key naar een onbestaande tabel laat zich
  niet aanmaken. Hij komt met de scanner, met één `alter table` — zoals de
  catalogus `category_id` wegliet.
- **Standaardhoudbaarheid.** Categorieën en geleerde houdbaarheid bestaan
  niet; een vervaldatum is voorlopig handwerk, en optioneel.

**Eerlijke grens:** zonder scanner is elk item met de hand ingevoerd, en
zonder OFF-import begint bijna elke toevoeging de eerste weken met een
product aanmaken. Daarom zit dat aanmaken ín de toevoegflow (§6).

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Rechtstreeks schrijven onder RLS, geen RPC's | Elke invariant gaat over één rij of over een verwijzing; Postgres dwingt die zelf af (§3). | Blijkt er toch een invariant over meerdere rijen nodig, dan komt er alsnog een RPC — zonder datamigratie. |
| Geen nieuwe `SECURITY DEFINER`-functies | Niets hier hoeft langs RLS heen. | Geen. De lijst van de beveiligingsadviseur blijft op elf. |
| Plaats verwijderen geblokkeerd zolang er voorraad ligt | Cascade zou met één misklik de inhoud van de vriezer wissen, inclusief de afstreepgeschiedenis. | Een gebruiker moet eerst verplaatsen of afstrepen. |
| Afgestreepte items overleven het verwijderen van hun plaats | De geschiedenis is van het huishouden, niet van de plaats. | `storage_place_id` wordt nullable — een afwijking van de schets. |
| Echt verwijderen naast afstrepen | Een fout ingevoerd item dat als "weggegooid" wordt afgestreept vervuilt de verspillingscijfers. | Verwijderen is onomkeerbaar; de UI vraagt bevestiging. |
| Ongedaan maken via een toast, de database staat het altijd toe | Een verkeerde tik is het gewone ongeluk. | Een vergissing die je pas de dag erna ziet, is niet meer via de UI te herstellen. Bewust; zie §10. |
| Eén vervaldatum bij toevoegen, per stuk achteraf aan te passen | Het gewone geval (zelfde lot) kost één veld. | Gemengde loten kosten na het toevoegen een paar tikken extra. |
| Vervaldatum optioneel | Rijst en zout hebben geen datum die iemand wil intikken. | Items zonder datum staan nooit in "vervalt binnenkort". |
| Product inline aanmaken in de toevoegflow | De catalogus is leeg; dit is de eerste weken het hoofdpad. | Een tweede plek die `create_product` aanroept, naast `/products/new`. |
| Bij verschillende vervaldatums vraagt afstrepen welke | Stil de vroegste kiezen verbergt dat er nog een oudere ligt. | Eén tik meer, alleen wanneer de items niet uitwisselbaar zijn. |
| "Vandaag" is de lokale datum van het toestel | `current_date` in de database rekent in UTC; 's avonds laat springt alles dan een dag op. | Twee toestellen in verschillende tijdzones zien een andere strook. Aanvaardbaar. |
| Geen Realtime | De lijst ververst bij openen en na eigen acties. | Een huisgenoot ziet jouw afstreping pas na herladen. |

## 3. Datamodel

```sql
inventory_item (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references household on delete cascade,
  product_id       uuid not null references product,     -- restrict
  storage_place_id uuid,                                 -- zie samenhang
  amount           numeric not null default 1,
  unit             text not null default 'stuk',
  acquired_at      date not null default current_date,
  expires_at       date,
  status           text not null default 'in_stock',
  closed_at        timestamptz,
  closed_by        uuid references auth.users on delete set null,
  closed_reason    text,
  created_at       timestamptz not null default now(),

  foreign key (household_id, storage_place_id)
    references storage_place (household_id, id)
    on delete set null (storage_place_id)
)
```

### Afwijkingen van de schets in §4

| Wat | Waarom |
|---|---|
| Geen `receipt_line_id` | De tabel bestaat niet. Zie §1. |
| `storage_place_id` nullable | Alleen bij `closed`, afgedwongen door de samenhangcheck. Zo overleeft de geschiedenis het verwijderen van een plaats. |
| `created_at` erbij | `acquired_at` is een datum; voor een stabiele volgorde binnen een dag is een tijdstip nodig. |
| Samengestelde FK in plaats van een gewone | RLS controleert alleen `household_id`. Met een gewone FK kan een item in huishouden A naar een bewaarplaats van huishouden B wijzen — het enige wat de aanvaller nodig heeft is een uuid. |

`storage_place` krijgt daarvoor `unique (household_id, id)`: een samengestelde
FK moet naar een unieke sleutel over precies die kolommen wijzen.

### Constraints

| Constraint | Inhoud |
|---|---|
| `inventory_item_hoeveelheid` | `amount > 0` |
| `inventory_item_eenheid` | `unit in ('stuk','kg','g','l','ml')` |
| `inventory_item_status` | `status in ('in_stock','closed')` |
| `inventory_item_reden` | `closed_reason is null or closed_reason in ('consumed','discarded')` |
| `inventory_item_samenhang` | zie hieronder |

```sql
(status = 'in_stock'
   and storage_place_id is not null
   and closed_at is null and closed_by is null and closed_reason is null)
or
(status = 'closed'
   and closed_at is not null and closed_reason is not null)
```

`closed_by` mag leeg zijn bij `closed`: een verwijderd account wist zijn
toeschrijving (`on delete set null`), en het afstrepen zelf blijft dan
gewoon gebeurd.

De eenheden van een item (`stuk|kg|g|l|ml`) zijn bewust niet die van het
product (`ml|g|stuk`). Het product beschrijft de verpakking, het item de
hoeveelheid die er ligt: 2 × 1 L melk zijn twee items van 1 `stuk`, en losse
gehakt is één item van 0,684 `kg`.

### Rechten per kolom

Supabase geeft `anon` en `authenticated` standaard alle rechten op elke
tabel in `public`. Die gaan er eerst af, en daarna komt er precies terug wat
nodig is:

```sql
revoke all on inventory_item from anon, authenticated;
grant select, delete on inventory_item to authenticated;
grant insert (household_id, product_id, storage_place_id,
              amount, unit, acquired_at, expires_at)
  on inventory_item to authenticated;
grant update (product_id, storage_place_id, amount, unit,
              acquired_at, expires_at, status, closed_reason)
  on inventory_item to authenticated;
```

Gevolgen:

- Een item begint altijd als `in_stock`: `status` en de `closed_*`-velden
  staan niet in de insert-lijst.
- `household_id` is na het aanmaken niet meer te wijzigen, ook niet door
  iemand die lid is van beide huishoudens.
- `closed_at` en `closed_by` zijn voor de client nooit schrijfbaar; de
  trigger hieronder vult ze.

### De stempeltrigger

`before update`, `security invoker`, met de grants ingetrokken zoals bij
elke triggerfunctie in dit project.

| Overgang | Wat de trigger doet |
|---|---|
| `in_stock` → `closed` | `closed_at = now()`, `closed_by = auth.uid()` |
| `closed` → `in_stock` (ongedaan maken) | `closed_at`, `closed_by` en `closed_reason` leeg |
| `closed` → `closed` | **niets** |
| `in_stock` → `in_stock` | niets |

De derde regel is geen nalatigheid. Het ligt voor de hand om bij
`closed` → `closed` de oude stempels terug te zetten "voor de zekerheid",
maar een referentiële actie is ook een update en vuurt deze trigger: wordt
een account verwijderd, dan zet `on delete set null` `closed_by` op `null`,
en een trigger die de oude waarde terugzet maakt dat stil ongedaan. Hetzelfde
geldt voor de `set null` op `storage_place_id`. De kolomrechten houden de
client al bij deze velden weg; de trigger hoeft dat niet nog eens te doen.

### RLS

Vier policies — select, insert, update, delete — elk met
`is_household_member(household_id)`, en update ook in `with check`. Zelfde
vorm als `storage_place`.

### Indexen

- `(household_id, expires_at) where status = 'in_stock'` — de voorraadquery
  en de strook.
- `(storage_place_id)` — de FK-actie bij het verwijderen van een plaats.
- `(product_id)` — de FK naar de catalogus.

## 4. Een plaats verwijderen

Het blokkeren is geen aparte regel maar volgt uit twee dingen die er al
staan: de FK zet `storage_place_id` op `null`, en de samenhangcheck verbiedt
`null` bij `in_stock`. Ligt er nog voorraad, dan faalt het verwijderen met
`23514` (`check_violation`) en de naam `inventory_item_samenhang`. Liggen er
alleen afgestreepte items, dan lukt het en houden die hun geschiedenis met
een lege plaats.

`settings/places.vue` herkent die fout aan code én constraintnaam en toont
"Er ligt nog voorraad in deze plaats — verplaats of streep die eerst af" in
plaats van de generieke foutmelding.

### De valkuil: een huishouden opheffen

Een huishouden opheffen cascadeert tegelijk naar `inventory_item` (via
`household_id`) en naar `storage_place`, en die laatste vuurt de `set null`
op de items. Voert Postgres die `set null` uit op een `in_stock`-item voordat
het item zelf via de andere cascade weg is, dan faalt de check en faalt het
opheffen.

**Gemeten, vóór het implementatieplan:** het opheffen slaagt. Een
teruggerolde spike tegen Postgres 17 deed het in beide aanmaakvolgordes van
de foreign keys; de `set null` op de items vuurt pas nadat de cascade vanaf
`household` de items al verwijderd heeft. De test `een huishouden met
voorraad in meerdere plaatsen opheffen lukt` in `test/db/inventory.test.ts`
houdt dat zo.

De terugvaloptie die hier eerder stond — de plaats-eis uit de check halen en
een `before delete`-trigger op `storage_place` — is daarmee niet nodig, en
had een gat: een samengestelde FK met een `null`-kolom wordt onder `MATCH
SIMPLE` niet gecontroleerd, dus zonder de plaats-eis in de check kon een lid
`storage_place_id` van een `in_stock`-item gewoon op `null` zetten. Valt de
test ooit om, dan moet de vervanger ook dát afdekken.

## 5. Leespad

### `voorraad(target_household, voorkeurstaal)`

`language sql`, `stable`, `security invoker`. Geeft de `in_stock`-items van
één huishouden terug, met per item: `id`, `product_id`, de getoonde naam en
uit welke taal die komt, merk, `net_content` en de eenheid van het product,
`storage_place_id`, `amount`, `unit`, `acquired_at`, `expires_at` en
`created_at`. Gesorteerd op `expires_at nulls last`, dan `created_at`.

Invoker, want RLS laat de aanroeper al precies zien wat hij mag zien; een
niet-lid krijgt een lege lijst, geen fout. `execute` voor `authenticated`,
niet voor `anon` of `public`.

De bewaarplaatsen komen apart, rechtstreeks uit `storage_place`: ook lege
plaatsen moeten getoond worden, en die zitten per definitie niet in een
itemquery.

### De terugvalketen naar één plek

De keten — eigen taal, dan `en`, dan de eerste beschikbare — staat vandaag
twee keer als inline `lateral` in `search_products`. Een derde kopie in
`voorraad()` is de plek waar die drie uit elkaar gaan lopen. Hij verhuist
daarom naar `product_weergavenaam(product, voorkeurstaal)`, `language sql`,
`stable`, `security invoker`, en zowel `search_products` als `voorraad()`
gebruiken hem via `cross join lateral`.

`search_products` wordt met `create or replace` in een nieuwe migratie
herschreven, met dezelfde signatuur, zodat zijn grants blijven staan. De
bestaande zoektests zijn de bewaking van die refactor, en ze moeten
**ongewijzigd** groen blijven.

## 6. UI

### Routes

| Routesleutel | en · nl · fr |
|---|---|
| `inventory` | `/inventory` · `/nl/voorraad` · `/fr/stock` (bestaat) |
| `inventory/new` | `/inventory/new` · `/nl/voorraad/nieuw` · `/fr/stock/nouveau` |

`app/pages/inventory.vue` verhuist naar `app/pages/inventory/index.vue`.
Anders maakt Nuxt van `inventory/new.vue` een kindroute van `inventory.vue`,
die dan een `<NuxtPage>` nodig heeft. De routenaam blijft `inventory`, net
zoals `products/index.vue` de naam `products` draagt, dus
`localePath('inventory')` in `index.vue` en `AppHeader.vue` blijft werken.

### De voorraadpagina

Van boven naar onder:

1. **Vervalt binnenkort.** `in_stock`-items met een vervaldatum vóór of op
   vandaag + 3 dagen, vroegste eerst. Vervallen items krijgen een markering
   en blijven staan — ze verdwijnen niet vanzelf, zoals §5 van het
   hoofdontwerp vraagt. Is de strook leeg, dan staat hij er niet.
2. **Per bewaarplaats** een blok, in dezelfde volgorde als in de
   instellingen (`created_at`). Lege plaatsen staan er ook, met "leeg". Elk
   blok heeft een knop **Toevoegen** naar `inventory/new?plaats=<id>`.
3. **Binnen een plaats per product**, op naam gesorteerd. Een groep toont
   "×N" als alle items 1 `stuk` zijn, en anders het totaal per eenheid
   ("Gehakt · 1,184 kg"). De vroegste vervaldatum staat erbij.

Heeft het huishouden geen enkel item, dan staat er boven de plaatsen een
korte uitleg met een knop Toevoegen.

### Afstrepen

**Op een groep.** Items binnen een groep zijn *uitwisselbaar* als ze dezelfde
vervaldatum (of allebei geen) en dezelfde `amount` en `unit` hebben.

- **Allemaal uitwisselbaar:** één tik, dan één vraag in een modal —
  *Opgemaakt* of *Weggegooid*. Welke rij het wordt, maakt niets uit; voor een
  vaste uitkomst de oudste `created_at`.
- **Niet allemaal uitwisselbaar:** de modal toont eerst de varianten,
  vroegste datum eerst en "geen datum" achteraan, elk met aantal en
  markering ("12 sep ×1 · vervallen", "3 okt ×2", "geen datum ×1"). **Niets
  is voorgeselecteerd**; *Opgemaakt* en *Weggegooid* zijn pas actief als er
  een variant gekozen is. Zo zie je bij elke tik dat er nog een oudere ligt.

**Op een los item**, in de uitgeklapte groep: meteen de vraag *Opgemaakt* of
*Weggegooid* — welk item het is, is daar al duidelijk.

Na afstrepen verschijnt een toast met **Ongedaan maken**. Die zet het item
terug op `in_stock`; de trigger wist de rest. Is de plaats van het item
intussen verwijderd, dan faalt dat op de samenhangcheck — een `in_stock`-item
zonder plaats bestaat niet — en meldt de toast dat het item niet meer terug
kan.

### Een uitgeklapte groep

Toont de losse items, elk met vervaldatum en drie acties:

- **Afstrepen** — zie hierboven.
- **Bewerken** — vervaldatum, plaats en hoeveelheid. Zo krijgt één pot uit
  een rij van drie een andere datum, en verhuist gehakt naar de vriezer.
- **Verwijderen** — met een bevestigingsstap, want onomkeerbaar. Bedoeld voor
  wat er nooit had mogen staan.

### Toevoegen (`/inventory/new`)

1. **Product kiezen.** Zoeken via de bestaande `useProducts().search`. Onder
   de resultaten staat permanent *Maak "‹zoekterm›" aan*; dat klapt inline
   open met de naam (vooringevuld uit de zoekterm, in de taal van de
   interface), optioneel merk, en optioneel inhoud met eenheid. Bevestigen
   roept `create_product` aan en selecteert het nieuwe product. Zoeken gaat
   dus nog altijd vooraf aan aanmaken — de duplicaatverzachting uit de
   catalogus blijft. Volledig bewerken blijft op de productpagina.
2. **Details.**
   - **Plaats** — voorgekozen uit `?plaats=`, anders de eerste.
   - **Aantal** — standaard 1, in het formulier begrensd op 50 tegen een
     typefout die vijfhonderd rijen maakt.
   - **Vervaldatum** — optioneel, één voor alle stuks.
   - **Op gewicht** — inklapbaar: hoeveelheid en eenheid (`kg|g|l|ml`) per
     stuk. Standaard 1 `stuk`.
3. **Opslaan** doet één `insert` met N rijen, `acquired_at` op de lokale
   datum van vandaag. Terug naar de voorraad, met een toast
   "3 × Passata toegevoegd".

### Mobiel

Velden die naast elkaar staan, stapelen onder `sm`, zoals elders in de app.
De stapeltest in `e2e/mobile.spec.ts` krijgt een geval voor het
toevoegformulier; de veegtest neemt `inventory/new` vanzelf mee.

### Code

- **`useInventory()`** — `load`, `add`, `close`, `reopen`, `update`,
  `remove`, naar het voorbeeld van `useProducts`: geen `useState`, fouten
  doorgooien.
- **Pure functies in `app/utils/`** — de groepering, de uitwisselbaarheid en
  de varianten, en "vervalt binnenkort". "Vandaag" komt als parameter binnen,
  niet uit `new Date()`. Daarmee zijn ze te testen zonder Nuxt-runtime — het
  gat dat `useProfile` heeft (zie de bevindingen).
- **Vertalingen** — een `inventory`-blok in alle drie de locales;
  `test/i18n/locales.test.ts` dwingt dat af.

## 7. Gelijktijdigheid

Er is geen Realtime. Twee huisgenoten kunnen dus hetzelfde item afstrepen
vanaf een verouderde lijst.

Afstrepen is daarom een update **met de verwachte begintoestand erin**:
`where id = … and status = 'in_stock'`, met de geraakte rijen terug. Nul rijen
betekent dat iemand anders je voor was: de app meldt "al afgestreept" en
herlaadt. Ongedaan maken doet hetzelfde in omgekeerde richting
(`status = 'closed'`).

Dat maakt afstrepen idempotent, en dat is de eigenschap waar de
offline-ronde een wachtrij op kan bouwen.

## 8. Testen

De terugkerende faalmodus van dit project is een groene test die de
eigenschap die hij bewaakt niet bewijst. Daarom is de regel hier: **elke
bewaking wordt één keer rood gemaakt door weg te halen wat ze bewaakt**,
vóór de test als bewijs telt. De kolom "Falsificatie" hieronder zegt per
test wát er weg moet; het implementatieplan neemt dat als expliciete stap op,
en de review loopt die stappen na.

### Database — `test/db/inventory.test.ts`

| Eigenschap | Test | Falsificatie: haal weg… |
|---|---|---|
| Huishoudens gescheiden | Een buitenstaander ziet, wijzigt en verwijdert de items van A **niet**; een lid van A **wel**. Per handeling een paar. | elke policy apart: select, insert, update, delete |
| Geen plaats van een ander huishouden | Een item in A met de plaats van B faalt; met een plaats van A lukt het. De aanroeper is lid van **beide**, zodat RLS het niet al tegenhoudt. | de samengestelde FK, vervangen door een gewone FK op `storage_place(id)` |
| Afstrepen stempelt server-side | `status = 'closed'` zetten levert `closed_by` = de aanroeper en een gevulde `closed_at`. | de `in_stock` → `closed`-tak van de trigger |
| Stempels zijn niet te vervalsen | Een rechtstreekse update van `closed_by` of `closed_at` wordt geweigerd. | de update-kolomrechten (volledige update-grant terug) |
| Ongedaan maken wist | Terug naar `in_stock` laat alle drie de `closed_*`-velden leeg achter. | de `closed` → `in_stock`-tak van de trigger |
| Een verwijderd account wist zijn toeschrijving | Het account verwijderen dat een item afstreepte laat `closed_by` leeg en het item `closed`. | (omgekeerd) een `closed` → `closed`-tak toevoegen die de oude stempels terugzet — dan moet deze test rood |
| Samenhang | `closed_reason` zetten zonder `status = 'closed'` faalt. | de samenhangcheck |
| Huishouden ligt vast | Een update van `household_id` wordt geweigerd, ook voor een lid van beide huishoudens. | de update-kolomrechten |
| Een item begint `in_stock` | Een insert met `status = 'closed'` wordt geweigerd. | de insert-kolomrechten |
| Plaats met voorraad blijft staan | Verwijderen faalt met `23514` en `inventory_item_samenhang` zolang er een `in_stock`-item in ligt; **lukt** met alleen afgestreepte items, die blijven bestaan met een lege plaats. | de plaats-eis in de samenhangcheck |
| Huishouden opheffen werkt met voorraad | Een huishouden met `in_stock`-items in meerdere plaatsen opheffen slaagt; alle items zijn weg. | — rood betekent §4's terugvaloptie, niet de test aanpassen |
| `anon` kan niets | Geen enkel tabelrecht op `inventory_item`, geen `execute` op `voorraad` of `product_weergavenaam`. Getoetst met `has_table_privilege` en `has_function_privilege`, zoals de bestaande tests. | de revokes |
| Alleen `in_stock` in de lijst | `voorraad()` laat afgestreepte items weg. | de `status`-filter |
| Een niet-lid ziet niets | `voorraad(A)` door een buitenstaander geeft een lege lijst; door een lid niet. | — invoker is de bewaking; falsificatie: de functie op `security definer` zetten, dan moet hij rood |
| Terugvalketen | Een product met alleen een Engelse naam geeft voor `nl` de Engelse naam **en** `en` als getoonde taal; met een Nederlandse naam erbij de Nederlandse. | de `en`-tak in `product_weergavenaam` |
| Afstrepen is idempotent | Een tweede `update … where status = 'in_stock'` op hetzelfde item raakt nul rijen en laat de eerste stempels staan. | het `status`-filter in de update |

De refactor van `search_products` heeft geen eigen falsificatie: zijn
bewaking zijn de bestaande tests in `test/db/product-search.test.ts`, en die
moeten **zonder enige aanpassing** groen blijven. Een test die voor de
refactor moet worden bijgesteld, bewijst de refactor niet.

### Pure functies — `test/utils/`

| Eigenschap | Test | Falsificatie |
|---|---|---|
| Strookgrens | Vandaag + 3 dagen zit erin, vandaag + 4 niet; vervallen zit erin; geen datum niet. | de grens één dag verschuiven |
| Uitwisselbaarheid | Zelfde datum en hoeveelheid: één variant. Andere datum: twee. Zelfde datum, andere hoeveelheid: twee. | de hoeveelheid uit de vergelijking halen |
| Volgorde van varianten | Vroegste eerst, "geen datum" achteraan. | `nulls last` omdraaien |
| Groepslabel | Alle items 1 `stuk`: "×N"; anders het totaal per eenheid. | de "alle items 1 `stuk`"-voorwaarde weglaten |

### End-to-end — `e2e/inventory.spec.ts`

| Eigenschap | Test |
|---|---|
| Toevoegen met inline aanmaken | Een onbekend product aanmaken vanuit de toevoegflow, aantal 3 → "×3" in de gekozen plaats. |
| Afstrepen en ongedaan maken | Uitwisselbare items: één vraag, ×3 wordt ×2. Ongedaan maken, **pagina herladen**, weer ×3 — de toast alleen bewijst niets over de database. |
| De variantvraag | Twee items met een andere datum: de varianten staan er, niets is geselecteerd, en de redenknoppen zijn uitgeschakeld tot er gekozen is. |
| De strook | Een item van over 2 dagen staat erin; een item van over 10 dagen **niet**. Alleen de positieve kant zou ook slagen met een strook die alles toont. |
| Plaats met voorraad | Verwijderen toont de specifieke melding, en na herladen staat de plaats er nog. |

### Wat niet beloofd wordt

Gelijktijdig afstrepen vanaf twee toestellen wordt alleen op databaseniveau
getoetst (de tweede update raakt nul rijen), niet met twee browsers.

## 9. Falsificatie

Waaraan we zien dat dit werkt, en niet alleen dat het groen is:

1. **Elke rij met een falsificatie in §8 is één keer rood gezien**, met de
   bewaking weggehaald, en daarna weer groen met de bewaking terug. Een test
   die bij die ingreep groen blijft, meet iets anders dan hij beweert en
   wordt herschreven — niet bijgevoegd.
2. **De samengestelde FK wordt aangevallen door iemand die lid is van beide
   huishoudens.** Een buitenstaander faalt al op RLS, en dan bewijst de test
   niets over de FK.
3. **De valkuil van §4 wordt gemeten, niet beredeneerd.** Het opheffen van
   een huishouden met voorraad draait als test vóór de rest van de
   plaatslogica in de UI gebouwd wordt.
4. **De e2e-test voor ongedaan maken herlaadt de pagina**, en de strooktest
   heeft een negatief geval. Allebei zijn het plekken waar een test op de
   UI-toestand zou slagen zonder dat de onderliggende eigenschap klopt.

## 10. Wat hier niet in zit

- **Offline** — eigen ronde; afstrepen is er al idempotent voor (§7).
- **Verspillingsoverzicht** — wacht op prijzen. `closed_reason` ligt klaar.
- **Een lijst "recent afgestreept"** — een vergissing die je pas de dag erna
  ziet, is via de UI niet terug te draaien. De database staat het toe; het
  is een scherm, geen migratie.
- **`receipt_line_id`** — met de scanner.
- **Standaardhoudbaarheid en geleerde houdbaarheid** — met de categorieën.
- **Realtime tussen huisgenoten.**
- **Herinneringen per e-mail of push over vervaldata.**

## 11. Gevolgen voor bestaand werk

| Wat | Gevolg |
|---|---|
| `routes.config.ts` | Eén routesleutel erbij, `inventory/new`. Niet publiek, dus `supabaseExclude` blijft ongemoeid. |
| `app/pages/inventory.vue` | Verhuist naar `app/pages/inventory/index.vue`; de placeholder wordt de voorraadpagina. |
| `app/pages/settings/places.vue` | Herkent de blokkeerfout bij verwijderen en toont een eigen melding. |
| `storage_place` | Krijgt `unique (household_id, id)`. |
| `search_products` | Gebruikt `product_weergavenaam`; signatuur en gedrag ongewijzigd. |
| Gegenereerde databasetypes | Opnieuw genereren voor `inventory_item`, `voorraad` en `product_weergavenaam`. |
| `i18n/locales/*.json` | Een `inventory`-blok in alle drie. |
| `e2e/mobile.spec.ts` | De veegtest neemt `inventory/new` vanzelf mee; de stapeltest krijgt een geval. |
| `docs/superpowers/open-bevindingen.md` | De regel "Offline data" noemt `stock_item`; de tabel heet `inventory_item`, en offline is nu expliciet de volgende ronde. De telling van `SECURITY DEFINER`-functies blijft elf. |
