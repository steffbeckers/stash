# Stash — ontwerp

**Datum:** 2026-09-21
**Status:** goedgekeurd ontwerp, klaar voor implementatieplan
**Talen:** Engels, Nederlands en Frans bij oplevering; Duits ligt voor de hand
als vierde, want de parser kan het al

---

## 1. Doel

Een app waarin je na het winkelen een foto van je kassaticket maakt. De app
leest de bon, herkent de producten, en houdt bij wat je in huis hebt, waar het
ligt en wanneer het vervalt. Alle gebruikers bouwen samen aan één publieke
productcatalogus en één publieke prijsgeschiedenis.

### De waardepropositie

De reden om de app te openen is **het overzicht**, niet het scannen. Scannen is
de prijs die je betaalt; de opbrengst is:

- weten wat er in huis is, en waar
- weten wat er binnenkort vervalt
- weten waar een product op dit moment het goedkoopst is
- weten wat je kan klaarmaken met wat er ligt

Dat ordent het ontwerp: de voorraad is het startscherm, niet de camera.

### De gedeelde inspanning

Het onderscheidende mechanisme is dat de vertaling van kassabontekst naar een
echt product **één keer** gelegd wordt en daarna voor iedereen geldt. Hoe meer
mensen scannen, hoe minder werk elke scan kost en hoe rijker de prijsdata.

---

## 2. Scope

### In versie 1

Bonnen fotograferen en laten uitlezen; producten herkennen via aliassen,
fuzzy matching, barcode en Open Food Facts; producten zelf aanmaken met een
eigen foto; een wachtrij van onherkende bonregels en aliasbeheer per product;
een globale catalogus met
correctie en revisiegeschiedenis; prijshistoriek en prijsvergelijking per
winkel; voorraad per huishouden met bewaarplaatsen en vervaldatums; afstrepen
met onderscheid tussen opgemaakt en weggegooid; huishoudens met
uitnodigingslinks; publieke registratie met consensus, moderatie, quota en
misbruikpreventie met een maandplafond voor de API-kosten; receptvoorstellen op
basis van de voorraad; een Engelse, Nederlandse en Franse interface, met
productnamen per taal; AVG-conformiteit met export, accountverwijdering,
bewaartermijnen en verwerkersovereenkomsten.

### Uitdrukkelijk niet in versie 1

Native app; boodschappenlijst; weekmenuplanner; "wat had deze kar bij een
andere keten gekost"; receptendatabank; delen van voorraad tussen
huishoudens; barcodes van de bon lezen (die staan er niet op).

### Bewust uitgesteld, maar niet geblokkeerd

Native app via Expo — het datamodel en de server-API zijn er klaar voor.
Karvergelijking tussen ketens — volgt vanzelf uit de prijsdata zodra die
dicht genoeg is.

---

## 3. Genomen beslissingen

| Beslissing | Keuze | Waarom |
|---|---|---|
| Platform | PWA | Eén codebase, camera werkt, deploy in seconden, geen App Store |
| Frontend | Nuxt 4 (Vue) met Nuxt UI, SSR | Bestaande huistaal; server-routes vervangen Edge Functions |
| Backend | Supabase | Postgres, Auth, Storage, RLS in één; `pg_trgm` voor fuzzy matching |
| Bon uitlezen | Claude met vision | Werkt dag één voor elke keten zonder parser per winkel |
| Productdata | Gebruikers, met Open Food Facts als voorzet | OFF versnelt de start, maar is nooit de enige bron; wat er niet in staat maakt de gebruiker zelf aan |
| Deelmodel | Catalogus en prijzen globaal, voorraad per huishouden | Gedeelde inspanning zonder je boodschappengedrag te delen |
| Publiek | Open voor iedereen, vanaf dag één | De gedeelde inspanning ís het product |
| Moderatie | Consensus uit herhaling, geen wachtrij vooraf | Onafhankelijke bonnen zijn bewijs; schaalt vanzelf |
| Afboeken | Handmatig, één tik | Vervallen is niet hetzelfde als weg |
| Voorraad | Eén rij per stuk | Anders geen twee vervaldatums per product mogelijk |
| Huismerken | Gewoon een product | Blijkt vanzelf uit de aliassen; scheelt een tabel |
| Meertaligheid | Engels, Nederlands en Frans vanaf de start | Productnamen zijn taalafhankelijk; achteraf inbouwen is een migratie. Frans is in België geen extra taal maar de helft van het land |

---

## 4. Domeinmodel

### Het centrale onderscheid

Twee lagen, niet meer:

- **Alias** — de letterlijke tekst op de bon bij één keten
  (`COLR BIO MELK HALFV 1L`)
- **Product** — het echte ding, gedeeld over winkels
  (*Bio halfvolle melk 1 L, 1000 ml, EAN 5400101234567*)

De alias is het hart van de app. Een barcode vervangt hem niet: een kassabon
bevat geen barcode, dus de brug van bontekst naar product moet altijd gelegd
worden en moet altijd handmatig corrigeerbaar blijven.

### Winkels

```sql
store_chain (
  id            uuid pk,
  name          text not null,
  country       char(2) not null,
  logo_url      text
)

store_location (
  id            uuid pk,
  chain_id      uuid not null references store_chain,
  name          text,
  street        text,
  city          text,
  postcode      text,
  vat_number    text,              -- staat op de bon, sterkste matchsleutel
  geo           geography(point)
)
```

### Catalogus (globaal leesbaar, schrijven alleen via server)

```sql
product_category (
  id                      uuid pk,
  parent_id               uuid references product_category,
  code                    text not null unique,   -- 'dairy.milk', taalonafhankelijk
  default_shelf_life_days int,
  default_storage_kind    text,     -- pantry | fridge | freezer | other
  tracks_inventory        bool not null default true
)

category_translation (
  category_id uuid not null references product_category,
  locale      text not null,        -- 'en' | 'nl' | 'fr' | ...
  name        text not null,
  primary key (category_id, locale)
)

product (
  id            uuid pk,
  gtin          text unique,        -- EAN/barcode, mag leeg
  brand         text,               -- merknaam, niet vertaald
  category_id   uuid references product_category,
  net_content   numeric,            -- 1000
  unit          text,               -- ml | g | stuk
  image_url     text,               -- uit OFF of door een gebruiker geüpload
  image_source  text,               -- off | user
  off_synced_at timestamptz,        -- laatst ververst uit Open Food Facts, leeg
                                    -- bij een zelf aangemaakt product
  status        text not null,      -- proposed | confirmed | established | rejected
  created_by    uuid references auth.users,
  created_at    timestamptz not null default now()
)

product_translation (
  product_id uuid not null references product,
  locale     text not null,         -- 'en' | 'nl' | 'fr' | ...
  name       text not null,
  source     text not null,         -- off | user | machine
  primary key (product_id, locale)
)

product_revision (
  id           uuid pk,
  product_id   uuid not null references product,
  changed_by   uuid not null,
  changed_at   timestamptz not null default now(),
  before       jsonb not null,
  after        jsonb not null,
  reverted_by  uuid
)
```

`net_content` en `unit` zijn geen luxe: zonder die twee velden kan je geen
eenheidsprijs berekenen, en zonder eenheidsprijs is elke prijsvergelijking een
illusie (€2,49 voor 1 L versus €4,29 voor 2 L).

**Productnamen staan in een aparte tabel, niet op het product zelf.** *Halfvolle
melk* en *semi-skimmed milk* zijn hetzelfde product, en de gedeelde catalogus
moet dat weten. Een `name`-kolom op `product` zou dwingen tot één taal, en
achteraf uitsplitsen is een pijnlijke migratie precies op het moment dat er al
data in zit.

Gevolgen daarvan:

- Elk product heeft minstens één vertaling. De app valt terug van de
  gebruikerstaal naar `en`, en daarna naar de eerste beschikbare vertaling,
  met een markering welke taal je ziet.
- Zoeken gebeurt over **alle** locales tegelijk — typ je "milk" of "melk", dan
  vind je hetzelfde product. De `pg_trgm`-index staat op
  `product_translation.name`.
- Open Food Facts levert `product_name_nl`, `product_name_en` en meer in één
  keer; die gaan bij het ophalen meteen als aparte rijen naar binnen met
  `source = 'off'`.
- Vertalingen die door een model zijn gemaakt krijgen `source = 'machine'` en
  worden als zodanig getoond, zodat een gebruiker ze kan corrigeren en er geen
  automatische onzin als feit in de catalogus belandt.
- Categorieën werken hetzelfde, maar hun sleutel is een taalonafhankelijke
  `code` (`dairy.milk`), zodat de standaardhoudbaarheid en bewaarplaats niet
  aan een taal hangen.

Merknamen worden **niet** vertaald: Boni is Boni.

### De vertaallaag

```sql
product_alias (
  id             uuid pk,
  chain_id       uuid references store_chain,   -- null = geldt bij elke keten
  raw_text_norm  text not null,
  product_id     uuid not null references product,
  store_sku      text,
  source         text not null,    -- user | vision | barcode | import
  confirmations  int not null default 1,
  status         text not null,    -- proposed | confirmed | established | rejected
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique nulls not distinct (chain_id, raw_text_norm, product_id)
)
```

`nulls not distinct` is niet optioneel. Zonder die toevoeging beschouwt Postgres
twee rijen met `chain_id = NULL` als verschillend, en kan dezelfde
ketenonafhankelijke alias eindeloos gedupliceerd worden.

Dezelfde bontekst mag naar meerdere producten wijzen. Dat is geen fout maar een
conflict, en consensus lost het op: de alias met de meeste bevestigingen wint.
Bij gelijkspel toont de app beide en vraagt het aan de gebruiker.

**Normalisatie van `raw_text_norm`** blijft bewust mager: hoofdletters, spaties
samentrekken, randleestekens weg. Meer wegstrippen (gewichten, merkafkortingen)
voelt slim maar verwijdert juist wat twee producten onderscheidt.

### Geleerde houdbaarheid

```sql
shelf_life_observation (
  id            uuid pk,
  product_id    uuid not null references product,
  storage_kind  text not null,
  days          int not null,
  submitted_by  uuid not null,
  created_at    timestamptz not null default now()
)
```

Geaggregeerd tot een mediaan per `(product, storage_kind)`. De bewaarplaats
hoort in de sleutel: gehakt is twee dagen houdbaar in de koelkast en drie
maanden in de vriezer.

### Bonnen (privé, maar de bron van publieke data)

```sql
receipt (
  id                uuid pk,
  household_id      uuid not null references household,
  uploaded_by       uuid not null,
  store_location_id uuid references store_location,
  purchased_at      timestamptz,
  currency          char(3) not null default 'EUR',
  total_cents       int,
  status            text not null,  -- uploaded | parsing | needs_review | confirmed | failed
  parse_model       text,
  parse_error       text,
  parsed_at         timestamptz,
  created_at        timestamptz not null default now()
)

receipt_image (
  id           uuid pk,
  receipt_id   uuid not null references receipt,
  page_no      int not null,
  storage_path text not null
)

receipt_line (
  id                 uuid pk,
  receipt_id         uuid not null references receipt,
  line_no            int not null,
  kind               text not null,   -- product | discount | deposit | total | other
  raw_text           text not null,
  quantity           numeric,
  unit               text,
  unit_price_cents   int,
  total_cents        int,
  is_promo           bool not null default false,
  applies_to_line_id uuid references receipt_line,   -- korting -> productregel
  product_id         uuid references product,
  match_method       text,   -- alias_exact | trgm_chain | trgm_global | vision | barcode | manual
  match_confidence   numeric,
  resolved_by        uuid
)
```

Meerdere foto's per bon is geen randgeval: een volle kar geeft een bon van een
meter, en één foto daarvan is onleesbaar.

Niet elke regel is een product. Leeggoed, kortingen, subtotalen,
btw-uitsplitsing en getrouwheidspunten krijgen een eigen `kind` en gaan niet de
matchladder in. Kortingsregels worden wel via `applies_to_line_id` aan hun
productregel gekoppeld, anders klopt de prijshistoriek niet.

### Prijzen (globaal)

```sql
price_observation (
  id                     uuid pk,
  product_id             uuid not null references product,
  store_location_id      uuid not null references store_location,
  observed_at            date not null,
  price_type             text not null,    -- shelf | paid
  unit_price_cents       int not null,     -- prijs per verkochte eenheid
  normalized_price_cents int,              -- afgeleid, in normalized_unit
  normalized_unit        text,             -- l | kg | stuk
  is_promo               bool not null default false,
  receipt_line_id        uuid references receipt_line,   -- niet publiek leesbaar
  submitted_by           uuid not null,
  status                 text not null,    -- proposed | confirmed | established | suspect | rejected
  created_at             timestamptz not null default now()
)
```

Prijzen hangen aan een **vestiging**, niet aan een keten: Colruyt past prijzen
per winkel aan op lokale concurrentie. Aggregeren naar keten kan altijd nog;
het omgekeerde niet.

`normalized_unit` moet erbij staan. Een genormaliseerde prijs zonder eenheid is
onvergelijkbaar: €2,15 per liter en €2,15 per stuk zien er in de database
identiek uit, en zonder dat veld sorteert je "goedkoopst"-lijst stilzwijgend
appels bij peren.

### Schapprijs en betaalde prijs

Een bon toont vaak twee prijzen voor hetzelfde product:

```
COLA 1,5L          2 x  2,49      4,98
   2E GRATIS                     -2,49
```

Daarom heeft elke waarneming een `price_type`:

| `price_type` | Wat het is | Waarvoor |
|---|---|---|
| `shelf` | De normale prijs per eenheid (€2,49) | "Waar is dit nu het goedkoopst" |
| `paid` | Wat je effectief per eenheid betaalde (€1,25) | Actieoverzicht, en wat je werkelijk uitgaf |

Regels:

- Er is **altijd** een `shelf`-waarneming.
- Een `paid`-waarneming wordt alleen weggeschreven als die van de schapprijs
  afwijkt, dus wanneer er een kortingsregel aan de productregel hangt.
- Staat er een actieprijs rechtstreeks op de regel, zonder aparte
  kortingsregel, dan is dat de `shelf`-prijs met `is_promo = true`.

Zonder dit onderscheid is de prijsvergelijking onbetrouwbaar: je zou iemands
toevallige 1+1-actie afzetten tegen andermans normale prijs, en concluderen dat
een winkel structureel goedkoper is terwijl er die week gewoon een promotie
liep. Met dit onderscheid zijn beide vragen te beantwoorden — waar het
structureel goedkoopst is, én waar nu een goede actie loopt.

### Huishouden en voorraad (privé)

```sql
household (
  id         uuid pk,
  name       text not null,
  created_at timestamptz not null default now()
)

household_member (
  household_id uuid not null references household,
  user_id      uuid not null references auth.users,
  role         text not null default 'member',   -- owner | member
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
)

household_invite (
  id           uuid pk,
  household_id uuid not null references household,
  token        text not null unique,
  created_by   uuid not null,
  expires_at   timestamptz not null,
  max_uses     int not null default 5,
  uses         int not null default 0
)

storage_place (
  id           uuid pk,
  household_id uuid not null references household,
  name         text not null,        -- "kelder", "garagevriezer"
  kind         text not null         -- pantry | fridge | freezer | other
)

inventory_item (
  id                uuid pk,
  household_id      uuid not null references household,
  product_id        uuid not null references product,
  storage_place_id  uuid not null references storage_place,
  amount            numeric not null default 1,
  unit              text not null default 'stuk',   -- stuk | kg | g | l | ml
  acquired_at       date not null,
  expires_at        date,
  receipt_line_id   uuid references receipt_line,
  status            text not null default 'in_stock',  -- in_stock | closed
  closed_at         timestamptz,
  closed_by         uuid,
  closed_reason     text              -- consumed | discarded
)
```

Eén rij per aankoop-eenheid. Drie potten passata met drie vervaldatums zijn
drie rijen; in de app zie je "Passata ×3" met het detail eronder. Zonder die
opsplitsing is "wat vervalt er binnenkort" niet te beantwoorden.

**Producten op gewicht passen daar niet vanzelf in.** Een bonregel
`GEHAKT 0,684 kg × €12,99/kg` kan geen 0,684 rijen worden. Daarom hebben
voorraaditems een `amount` en een `unit`:

| Aankoop | Rijen | `amount` | `unit` |
|---|---|---|---|
| 3 potten passata | 3 | 1 | `stuk` |
| 0,684 kg gehakt | 1 | 0.684 | `kg` |
| 2 × 1 L melk | 2 | 1 | `stuk` |

Afstrepen blijft **één tik op de hele rij**. Er wordt niet bijgehouden dat er
nog 200 g gehakt over is — dat is precies de invoerlast die eerder bewust is
afgewezen. `amount` dient om te kunnen tonen en optellen wat er ligt, niet om
deelverbruik te administreren.

Een gebruiker mag in meerdere huishoudens zitten (kot, ouderlijk huis) met één
actief huishouden in de app. Dat kost niets extra en voorkomt tweede accounts.

**Wat de rollen doen.** `member` mag alles wat met dagelijks gebruik te maken
heeft: scannen, bevestigen, afstrepen, bewaarplaatsen aanmaken. `owner` mag
daarnaast uitnodigingen maken en intrekken, leden verwijderen, het huishouden
hernoemen en het huishouden opheffen. Een huishouden heeft altijd minstens één
`owner`; de laatste kan zichzelf niet verwijderen zonder eerst iemand anders
te promoveren.

Verlaat iemand een huishouden, dan blijft de voorraad staan — die is van het
huishouden, niet van de persoon. Wordt het huishouden opgeheven, dan gaan de
voorraad en de bonnen mee weg; de bijdragen aan de gedeelde catalogus blijven,
zoals beschreven in §8.

### Moderatie, vertrouwen en quota

```sql
user_profile (
  user_id      uuid pk references auth.users,
  display_name text,
  trust_level  int not null default 0,     -- 0 nieuw | 1 normaal | 2 vertrouwd | 3 moderator
  role         text not null default 'user'
)

report (
  id          uuid pk,
  target_type text not null,   -- product | alias | price
  target_id   uuid not null,
  reason      text not null,
  note        text,
  reported_by uuid not null,
  status      text not null default 'open',
  handled_by  uuid,
  handled_at  timestamptz
)

usage_quota (
  user_id      uuid not null references auth.users,
  day          date not null,
  scans        int not null default 0,
  recipe_calls int not null default 0,
  primary key (user_id, day)
)

app_usage (
  month        date primary key,   -- eerste dag van de maand
  scan_calls   int not null default 0,
  recipe_calls int not null default 0,
  cost_cents   int not null default 0   -- werkelijke kost uit de API-respons
)
```

`app_usage` is de noodrem voor de hele app, los van het quotum per gebruiker.
Zie §7.

---

## 5. Flows

### Onboarding

```
e-mail + magic link  ->  verifieer  ->  Start een huishouden
                                     of Word lid  (uitnodigingslink)
```

De uitnodigingslink is `/invite/<token>` met een vervaldatum en een beperkt
aantal gebruiken, zodat een gelekte link in een familiegroep geen open deur
wordt. Wie de link opent zonder account registreert eerst en belandt daarna
automatisch in het juiste huishouden.

E-mailverificatie is verplicht voordat je mag scannen.

### Scannen

```
foto's -> Storage -> server/api/receipts/[id]/parse -> Claude vision
                                                            |
                          winkel herkennen (btw-nummer / adres / naam)
                                                            |
                                    per regel: de matchladder
                                                            |
                                              reviewscherm
                                                            |
     voorraaditems + prijswaarnemingen + nieuwe of bevestigde aliassen
```

### De matchladder

Per regel met `kind = 'product'`, in volgorde, stoppen bij de eerste treffer:

| Trede | Methode | Resultaat |
|---|---|---|
| 1 | Exacte alias op `raw_text_norm` met `chain_id = <keten>` **of** `chain_id IS NULL`, status >= `confirmed` | Automatisch |
| 2 | `pg_trgm` similarity > 0,8 binnen dezelfde keten | Voorstel, één tik |
| 3 | `pg_trgm` similarity over ketens heen | Voorstel, expliciete bevestiging |
| 4 | Gok van het vision-model, opgezocht in Open Food Facts | Voorstel met foto en merk |
| 5 | Niets | Gebruiker zoekt in de eigen catalogus, scant de barcode, of maakt het product zelf aan |

Trede 1 is het hele punt: bij een tweede bezoek aan dezelfde winkel is een
groot deel van de bon meteen opgelost, zonder API-kost en zonder handwerk. Elke
keer dat iemand op trede 5 uitkomt en het oplost, verhuist die regel voor
iedereen permanent naar trede 1. Het vision-model is dus geen vaste kost per
bon maar de ontdekkingskost voor onbekende regels, en die neemt af.

### Een onherkende regel oplossen

Trede 5 is geen mislukking maar een **taak**: er staat een stuk bontekst dat
nog geen product heeft, en dat moet verduidelijkt worden. De bontekst zelf is
al bekend — wat ontbreekt is waar hij naar wijst.

**Het blokkeert nooit.** Je kan een bon bevestigen met openstaande regels. Die
regels leveren alleen nog geen voorraaditem en geen prijswaarneming op; ze
blijven op je lijstje staan. Dat is bewust: je staat met volle tassen in de
keuken en je wil niet vastzitten op één onbekend potje.

Drie manieren om zo'n regel op te lossen, in volgorde van hoe weinig werk ze
kosten:

| | Weg | Wat er gebeurt |
|---|---|---|
| 1 | **Barcode van het product scannen** | GTIN → bestaand product, of → Open Food Facts → nieuw product met naam, merk en foto |
| 2 | **Zoeken in de catalogus** | Je typt een paar letters en kiest een bestaand product |
| 3 | **Zelf aanmaken** | Het formulier hieronder, met de bontekst als vertrekpunt |

Weg 1 is de bedoelde route, want je hebt het product op dat moment toch in
handen bij het uitpakken. Eén scan levert naam, merk, inhoud én foto op zonder
één toetsaanslag.

Wat alle drie de wegen doen: **de alias wegschrijven.** Op dat moment ontstaat
`product_alias` met de genormaliseerde bontekst, de keten en het gekozen
product. Vanaf de volgende bon valt die regel op trede 1.

### Aliassen beheren buiten de scanflow

Aliassen zijn niet alleen een bijproduct van het scannen. Op de productpagina
staat een overzicht van alle bonteksten die naar dat product wijzen, per keten,
en daar kan je er zelf bijzetten, corrigeren of losmaken.

Dat is nodig voor drie gevallen die anders blijven hangen:

- Een keten die zijn bontekst verandert (`COLR BIO MELK 1L` → `BIO MELK HALFV`)
- Een alias die naar het verkeerde product wijst en losgemaakt moet worden
- Dezelfde bontekst die bij verschillende ketens hetzelfde product blijkt te
  zijn, en die je dus alvast voor die andere keten kan vastleggen

Losmaken of corrigeren van een alias volgt dezelfde revisie- en
terugdraailogica als een productwijziging.

### De wachtrij van onopgeloste regels

Een onopgeloste regel is simpelweg een `receipt_line` met een lege
`product_id`. Er is geen aparte tabel voor nodig; een view groepeert ze op
`(chain_id, raw_text_norm)` en toont hoeveel mensen op dezelfde verduidelijking
wachten.

Dat geeft twee dingen gratis:

- **Jouw lijstje** — de openstaande regels van je eigen huishouden, om op een
  rustig moment af te werken
- **Het effect voor anderen** — los jij `LIDL PIKANTE SALAMI 100G` op, dan
  verdwijnt die regel ook uit de wachtrij van iedereen die hem nog open had
  staan. Alleen nog niet bevestigde regels worden zo bijgewerkt; een bevestigde
  bon verandert nooit met terugwerkende kracht.

### Een product zelf aanmaken

Open Food Facts is een **voorzet, geen voorwaarde**. Het vult velden vooraf in
zodat je meestal niets hoeft te typen, maar de catalogus is van de gebruikers.
Wat er niet in staat, maak je zelf aan — en dat is geen randgeval: voor
schoonmaakmiddelen, diepvriesproducten van huismerken, versafdeling en
streekproducten is zelf aanmaken eerder regel dan uitzondering.

Het formulier is bewust kort. Alleen de naam is verplicht:

| Veld | Status | Vooraf ingevuld uit |
|---|---|---|
| Naam, in de taal van de gebruiker | Verplicht | OFF, of de gok van het vision-model uit de bontekst |
| Merk | Optioneel | OFF, of de bontekst |
| Inhoud en eenheid | Sterk aangeraden | OFF, of uit de bontekst (`MELK 1L` → 1000 ml) |
| Categorie | Optioneel | OFF-categorie, anders een gok uit de naam |
| Barcode | Optioneel | Gescand |
| Foto | Optioneel | OFF, anders zelf maken |

Inhoud en eenheid zijn optioneel maar worden nadrukkelijk gevraagd, want
zonder die twee valt dit product uit de prijsvergelijking — dat wordt in het
formulier ook zo gezegd, in plaats van het stilletjes te laten gebeuren.

Een zelf aangemaakt product start op `proposed` en doorloopt daarna dezelfde
consensusladder als elk ander product. Een vertaling die de gebruiker zelf
intikt krijgt `source = 'user'` en weegt zwaarder dan een machinevertaling.

**Productfoto's.** Staat er geen afbeelding in Open Food Facts, dan maak je er
zelf een. Die gaat naar een **publieke** bucket, want een productfoto is
catalogusdata en hoort bij het gedeelde deel — in tegenstelling tot je
bonfoto's, die privé blijven. Een geüploade foto vervangt de OFF-afbeelding
niet automatisch; beide kunnen bestaan en de nieuwste bevestigde wint.

Later mogelijk, nu niet: producten die hier ontstaan **terugsturen naar Open
Food Facts**. Dat past bij dezelfde gedachte van gedeelde inspanning, maar het
vraagt een eigen account- en kwaliteitsafspraak met hen en hoort niet in
versie 1.

### Bevestigen van een bon

Bij bevestiging gebeurt alles in één transactie in
`server/api/receipts/[id]/confirm`:

1. Voor elke productregel met een `product_id`: `inventory_item`-rijen
   aanmaken, tenzij de categorie `tracks_inventory = false` heeft of de
   gebruiker het uitvinkte. Bij een aantal in stuks één rij per stuk; bij een
   gewicht of volume één rij met dat `amount` en die `unit`.
2. Bewaarplaats bepalen: voorstel uit `product_category.default_storage_kind`,
   overschreven door wat dit huishouden eerder voor dit product koos.
3. Vervaldatum bepalen: geleerde mediaan voor `(product, storage_kind)`, anders
   `default_shelf_life_days` van de categorie, anders leeg. De gebruiker past
   aan met snelknoppen (+3d / +1w / +1m / +6m) of een datumkiezer. Een
   aanpassing levert een `shelf_life_observation` op.
4. Prijswaarnemingen aanmaken: altijd één met `price_type = 'shelf'`, en een
   tweede met `price_type = 'paid'` wanneer er een kortingsregel aan hangt.
   `normalized_price_cents` en `normalized_unit` worden berekend uit
   `net_content` en `unit` van het product.
5. Nieuwe aliassen vastleggen of bestaande bevestigen.
6. Het maandplafond bijwerken in `app_usage`.

### Voorraad en afstrepen

Startscherm. Bovenaan een strook "vervalt binnenkort", daaronder gegroepeerd
per bewaarplaats, en binnen een plaats gegroepeerd per product met aantal.

Vervallen items verdwijnen **niet** automatisch — ze krijgen een markering.
Afstrepen is één tik, gevolgd door één vraag: **opgemaakt** of **weggegooid**.

Dat tweede antwoord levert gratis een verspillingsoverzicht op: *"dit jaar
gooide je €127 aan boodschappen weg; grootste posten: verse kruiden, yoghurt,
sla."* Eén kolom en een query.

### Prijsvergelijking

Drie weergaven:

- **Prijsverloop** van één product: lijn per keten over tijd, actieprijzen als
  aparte markeringen zodat een promo de trend niet vertekent.
- **Waar nu het goedkoopst**: de meest recente *verse* waarneming per keten,
  gesorteerd op genormaliseerde eenheidsprijs, met de leeftijd van de
  waarneming erbij ("gezien 3 dagen geleden"). Waarnemingen ouder dan 60 dagen
  vallen uit het antwoord en verhuizen naar de geschiedenis.
- **Promoties gescheiden** van normale prijzen. Een actieprijs van vorige week
  is geen antwoord op "waar is dit nu het goedkoopst".

### Receptvoorstellen

De voorraad, met wat binnenkort vervalt vooraan, gaat naar Claude en komt terug
als drie voorstellen, in de taal van de gebruiker. Geen receptendatabank, geen
weekmenuplanner, geen boodschappenlijst. Dezelfde quotabewaking als bij het
scannen.

Dit sluit de lus: voorraad -> vervaldatum -> recept -> minder verspilling. En
het is de enige reden om de app te openen op een dag dat je niet gewinkeld
hebt.

---

## 6. Gedeelde data: consensus en moderatie

### Het principe

Bijdragen komen van **onafhankelijke kassabonnen**. Dat is bewijs, geen mening.
Daarom is het primaire moderatiemechanisme consensus uit herhaling, en niet een
wachtrij met een mens erin.

### Aliassen

| Situatie | Status |
|---|---|
| Aangemaakt door een gebruiker met `trust_level = 0` | `proposed` |
| Aangemaakt door een gebruiker met `trust_level >= 1` | `confirmed` |
| Bevestigd door een tweede, onafhankelijk huishouden | `confirmed`, `confirmations++` |
| Drie of meer bevestigingen | `established` |
| Teruggedraaid of afgekeurd | `rejected` |

**Onafhankelijk** betekent: een bevestiging vanaf een bon van een ander
`household_id`. Tweemaal dezelfde alias bevestigen binnen hetzelfde huishouden
telt als één bevestiging — anders kan één persoon met één account zijn eigen
fout tot waarheid promoveren.

Alleen `confirmed` en hoger doen mee op trede 1 van de matchladder.
Voorstellen zijn zichtbaar, maar gemarkeerd.

### Prijzen

| Situatie | Status |
|---|---|
| Ingediend door `trust_level = 0` | `proposed` |
| Ingediend door `trust_level >= 1`, binnen de bandbreedte | `confirmed` |
| Buiten `[mediaan/3, mediaan*3]` van de laatste 90 dagen | `suspect`, telt niet mee |
| Tweede onafhankelijke waarneming binnen ±10% in 14 dagen | `established` |

De outlierdetectie vangt in één regel code zowel typefouten (`1299` in plaats
van `12,99`) als moedwillige onzin, zonder dat er een mens aan te pas komt.

### Productgegevens

Wikipedia-model: **wijzigen mag direct, alles is een revisie, terugdraaien is
één tik.** Een goedkeuringswachtrij vooraf remt duizend goede bijdragen om tien
slechte te stoppen. Wijzigingen van `trust_level = 0` blijven wel in
afwachting.

Rapporteren kan op elk product, elke alias en elke prijs. Moderatoren
(`trust_level = 3`) hebben een eenvoudig overzicht. Op dag één is dat één
persoon.

### Productgegevens: statusovergangen

`product.status` volgt dezelfde ladder als aliassen, maar hangt aan het gebruik
ervan in plaats van aan stemmen:

| Van | Naar | Wanneer |
|---|---|---|
| — | `proposed` | Aangemaakt door een gebruiker met `trust_level = 0`, of automatisch uit een gok van het vision-model |
| — | `confirmed` | Aangemaakt met een geldige barcode uit Open Food Facts, of door een gebruiker met `trust_level >= 1` |
| `proposed` | `confirmed` | Een tweede huishouden koppelt er een bonregel aan |
| `confirmed` | `established` | Drie of meer huishoudens, of een moderator bevestigt |
| elk | `rejected` | Moderator, of een gegronde melding |

Een `proposed` product is gewoon bruikbaar in je eigen voorraad — het wordt
alleen niet aan anderen voorgesteld op trede 2 tot 4 van de matchladder. Zo
zit je nooit vast omdat de catalogus je nog niet vertrouwt.

### Winkels aanmaken

Winkelvestigingen zijn ook gedeelde data, en dus ook een vervuilingsrisico.
Het btw-nummer op de bon is hier de redding: dat is uniek per vestiging en
staat op elke Belgische kassabon.

- Herkent de parser een btw-nummer dat al bestaat, dan wordt die vestiging
  gebruikt. Geen vraag, geen dubbele winkels.
- Is het btw-nummer nieuw, dan wordt de vestiging automatisch aangemaakt met
  status `proposed`, met naam en adres van de bon.
- Ontbreekt het btw-nummer, dan kiest de gebruiker uit vestigingen in de buurt
  of maakt er een aan.
- Een keten aanmaken kan **niet** door gewone gebruikers. Nieuwe ketens komen
  in de moderatiewachtrij, want dat is de plek waar één rommelige invoer
  honderden bonnen verkeerd groepeert.

### Vertrouwensniveaus

| Niveau | Wanneer |
|---|---|
| 0 | Nieuw account: minder dan 7 dagen oud, of minder dan 5 bijdragen |
| 1 | Normale gebruiker |
| 2 | 50+ bijdragen, waarvan niets is teruggedraaid of gegrond gemeld |
| 3 | Moderator, handmatig toegekend |

**Promotie hangt niet af van bevestiging door anderen.** Dat was de eerste
opzet, en die klopte niet: de bijdragen van een nieuwe gebruiker blijven
`proposed` tot een ánder huishouden hetzelfde product koopt, en bij een kleine
gebruikersbasis gebeurt dat voor de helft van de producten nooit. Een
enthousiaste eerste gebruiker zou dan permanent op niveau 0 blijven staan,
precies degene die je het hardst nodig hebt.

Daarom promoveert niveau 0 naar 1 op **tijd plus volume** — zeven dagen en vijf
bijdragen — zonder dat iemand anders iets hoeft te doen. Die drempel kost een
vandaal weinig moeite, maar hij maakt drive-by-vandalisme wel onaantrekkelijk,
en dat is wat hij moet doen. De echte bescherming zit in terugdraaien,
outlierdetectie en melden, niet in de wachttijd.

Een teruggedraaide of gegrond gemelde bijdrage zet je terug naar niveau 0.

---

## 7. Misbruik en kosten

Het grootste risico is niet vandalisme maar **je API-rekening**. Iemand die een
script op je parse-endpoint zet, kost echt geld.

- Quotum per gebruiker per dag op scans en receptvoorstellen, afgedwongen in de
  server-route tegen `usage_quota`, vóór de API-call
- Verplichte e-mailverificatie voordat er één scan mag
- Maximale beeldgrootte en maximaal aantal foto's per bon
- Bij overschrijding een expliciete melding, geen stille fout

### De noodrem voor de hele app

Een quotum per gebruiker beschermt je tegen één misbruiker, maar niet tegen
duizend legitieme gebruikers. Daarom staat er een **maandplafond** boven het
geheel:

| Verbruik | Wat er gebeurt |
|---|---|
| < 80% | Niets |
| 80% | Waarschuwing naar de beheerder |
| 100% | Scannen en receptvoorstellen stoppen voor iedereen, met een duidelijke melding |

Bij 100% blijft **de rest van de app gewoon werken**: je voorraad, je
vervaldatums, de prijsvergelijking en het afstrepen raken het plafond niet,
want die kosten niets. Alleen wat een API-call vereist valt stil.

De kost wordt niet geschat maar afgelezen uit het tokengebruik in de
API-respons, en per maand opgeteld in `app_usage`. Het plafond zelf staat in de
runtime config, zodat je het kan verhogen zonder te deployen.

Dit is bewust een harde stop en geen waarschuwing: de reden om het te bouwen is
juist het scenario waarin je niet kijkt — 's nachts, of tijdens je vakantie.

**Architectuurregel:** de client schrijft **nooit** rechtstreeks naar globale
data. Aliassen, producten en prijswaarnemingen gaan altijd via `server/api`.
Zonder die regel zijn quota, consensuslogica en outlierdetectie te omzeilen met
een gekopieerde anon-sleutel, en is de gedeelde databank binnen een week
onbruikbaar. Privédata (voorraad, bonnen, huishouden) mag wel rechtstreeks
vanuit de client, want RLS schermt die al af.

---

## 8. Privacy en AVG

Op een kassaticket staan de laatste vier cijfers van je betaalkaart, het exacte
tijdstip, de winkel en alles wat je die dag kocht. Je aankoopgeschiedenis is
bovendien verrassend onthullend: ze verraadt je gezinssamenstelling, je
gezondheid, je gewoontes en je inkomen. Dat mag nooit meeliften met een
publieke prijswaarneming.

### Scheiding van privé en publiek

- Bonfoto's in een private bucket, alleen leesbaar door leden van dat
  huishouden, afgedwongen met RLS op `storage.objects`
- **Productfoto's in een aparte, publieke bucket.** Die horen bij de gedeelde
  catalogus en mogen door iedereen gezien worden. De scheiding tussen die twee
  buckets is hard: een bonfoto belandt nooit in de publieke, wat de gebruiker
  ook doet
- Publiek zichtbaar bij een prijs: **product, winkel, datum, prijs, promo
  ja/nee.** Meer niet.
- `price_observation.receipt_line_id` bestaat voor audit en terugdraaien, maar
  is niet leesbaar voor andere gebruikers
- Wie een prijs bijdroeg is zichtbaar voor moderatoren, niet publiek

### Wat er naar derden gaat

Dit stond nergens en is de belangrijkste transparantieplicht van het hele
project:

| Ontvanger | Wat | Waarom |
|---|---|---|
| Anthropic | De bonfoto's, integraal | Om de bon uit te lezen |
| Anthropic | Je voorraadlijst | Om recepten voor te stellen |
| Supabase | Alle gegevens | Hosting van database, auth en opslag |

Dat wordt expliciet vermeld vóór de eerste scan, niet weggestopt in een
privacyverklaring. Beide verwerkers bieden een **verwerkersovereenkomst**; die
worden afgesloten vóór de app opengaat.

De Supabase-instantie draait in een **EU-regio** (Frankfurt). Voor de
Anthropic-API wordt de EU-verwerking vastgelegd in de verwerkersovereenkomst.

### Rechten van de gebruiker

| Recht | Hoe |
|---|---|
| Inzage en overdraagbaarheid | Exportknop: al je eigen gegevens als JSON, met de bonfoto's |
| Verwijdering | Account verwijderen in de instellingen, met een bevestigingsstap |
| Correctie | Alles is rechtstreeks bewerkbaar in de app |
| Bezwaar | Uitschrijven voor e-mails; de app stuurt geen marketing |

**Wat "account verwijderen" precies doet** is de lastigste vraag van dit
ontwerp, want je bijdragen zitten verweven in gedeelde data:

- **Weg:** je bonnen en bonfoto's, je voorraad, je huishoudlidmaatschap, je
  profiel, je quotumhistoriek. Ben je de laatste `owner` van een huishouden,
  dan gaat dat huishouden mee.
- **Blijft, geanonimiseerd:** aliassen, producten, vertalingen en
  prijswaarnemingen. `submitted_by` en `created_by` worden leeggemaakt.

Dat tweede is geen luiheid maar noodzaak: die bijdragen zijn de gedeelde
catalogus. Ze verwijderen zou de data van álle andere gebruikers kapotmaken.
Geanonimiseerd bevatten ze bovendien geen persoonsgegevens meer — een prijs
voor melk bij Colruyt op een datum is een feit over een winkel, niet over een
persoon. Dit staat zo in de privacyverklaring, zodat niemand erdoor verrast
wordt.

`price_observation.receipt_line_id` wijst naar een verwijderde bon en wordt
bij verwijdering leeggemaakt, zodat de koppeling naar een persoon echt breekt.

### Bewaartermijnen

- Bonfoto's worden automatisch verwijderd **twaalf maanden** na de aankoop. De
  uitgelezen regels blijven; de foto is daarna alleen nog audit-materiaal dat
  je zelden nodig hebt en veel risico draagt. De gebruiker kan ze eerder
  wissen, of de automatische verwijdering uitzetten.
- Afgesloten voorraaditems blijven bewaard, want daarop steunt het
  verspillingsoverzicht.

### Toestemming en cookies

De app zet alleen **strikt noodzakelijke** cookies: de sessie van Supabase Auth
en de taalkeuze. Daarvoor is onder de ePrivacy-richtlijn geen
toestemmingsbanner nodig, en het is eerlijker om er dan ook geen te tonen.

Dat verandert op het moment dat er analytics of iets van een derde partij bij
komt. Wordt dat gebouwd, dan hoort er een echte banner bij met een weigerknop
die even prominent is als de accepteerknop. De keuze om nu geen analytics te
gebruiken is bewust en hoort bij dit ontwerp.

Minimumleeftijd is 16 jaar, conform de Belgische invulling van de AVG.

### Wat er nog los van de code moet gebeuren

Dit is geen ontwikkelwerk maar het hoort bij de oplevering, en het loopt
parallel:

- Privacyverklaring in alle drie de talen
- Gebruiksvoorwaarden, met daarin expliciet dat bijdragen aan de catalogus
  openbaar zijn en blijven
- Verwerkersovereenkomsten met Anthropic en Supabase
- Een register van verwerkingsactiviteiten
- Een gegevensbeschermingseffectbeoordeling (DPIA) overwegen. Verplicht is ze
  waarschijnlijk niet, maar aankoopgeschiedenis op schaal verzamelen zit dicht
  genoeg tegen "systematische monitoring" aan om de afweging op te schrijven in
  plaats van ze over te slaan.

---

## 9. Techniek

### Stack

| Laag | Keuze |
|---|---|
| Frontend | Nuxt 4 (Vue 3), SSR, PWA |
| Componenten | Nuxt UI (Tailwind CSS, Reka UI) |
| Meertaligheid | `@nuxtjs/i18n`, locales `en`, `nl` en `fr` |
| Server | Nitro `server/api` routes |
| Database, auth, opslag | Supabase (Postgres, Auth, Storage, RLS) |
| Supabase-integratie | `@nuxtjs/supabase` |
| Fuzzy matching | `pg_trgm` in Postgres |
| Bon uitlezen | Claude met vision |
| Productdata | Gebruikers, met Open Food Facts gecachet in `product` als voorzet |

Er zijn **geen Supabase Edge Functions**. De Nitro-routes vervullen die rol, in
dezelfde taal en hetzelfde deployment.

Nuxt UI levert de hele interfacelaag kant-en-klaar: tabellen, formulieren,
modals, toasts, commandopalet en een donkere modus. Dat scheelt precies het
werk dat deze app veel nodig heeft — lange lijsten, veel formuliervelden en een
reviewscherm met inline correcties — en geeft meteen een consistent geheel op
telefoonformaat. De PWA-laag komt van `@vite-pwa/nuxt`.

### Server-routes

```
server/api/
  receipts/[id]/parse.post.ts     vision-call, quotabewaking, vult receipt_lines
  receipts/[id]/confirm.post.ts   voorraad + prijzen + aliassen, in één transactie
  products/search.get.ts          eigen catalogus, met Open Food Facts als aanvulling
  products/by-gtin/[gtin].get.ts  barcode-opzoeking, gecachet
  products.post.ts                zelf een product aanmaken
  products/[id].patch.ts          naam of merk corrigeren, met revisie
  products/[id]/image.post.ts     eigen productfoto uploaden
  aliases/[id].patch.ts           een alias corrigeren of losmaken, met revisie
  receipt-lines/[id]/resolve.post.ts   onherkende regel koppelen aan een product
  aliases.post.ts                 handmatig een alias instellen
  recipes/suggest.post.ts         voorraad -> Claude -> voorstellen
  reports.post.ts                 rapporteren
  account/export.get.ts           al je eigen gegevens als JSON
  account.delete.ts               account verwijderen, bijdragen anonimiseren
```

Sleutels (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) staan uitsluitend in
de Nitro runtime config en bereiken de client nooit.

De client leest en schrijft privédata rechtstreeks via `supabase-js` met de
anon-sleutel onder RLS. Dat scheelt een REST-laag en geeft realtime gratis.

### Contract van de vision-parser

```json
{
  "store": { "chain_guess": "Colruyt", "name": "...", "address": "...", "vat": "BE0..." },
  "purchased_at": "2026-09-21T17:42:00+02:00",
  "locale": "nl",
  "currency": "EUR",
  "total_cents": 8734,
  "lines": [
    {
      "line_no": 1,
      "kind": "product",
      "raw_text": "COLR BIO MELK HALFV 1L",
      "quantity": 2,
      "unit": "stuk",
      "unit_price_cents": 149,
      "total_cents": 298,
      "is_promo": false,
      "product_guess": { "name": "Bio halfvolle melk", "brand": "Colruyt Bio",
                         "net_content": 1000, "unit": "ml" }
    },
    {
      "line_no": 2,
      "kind": "discount",
      "raw_text": "KORTING 2E GRATIS",
      "total_cents": -149,
      "applies_to_line_no": 1
    }
  ]
}
```

De parser moet overweg kunnen met bonnen in **meerdere talen**. In België is dat
geen randgeval maar de regel: een Carrefour in Namen print Frans, dezelfde
keten in Antwerpen Nederlands, en in de Oostkantons Duits. De prompt gaat
daarom niet uit van één taal, en het veld `product_guess.name` komt terug in de
taal van de bon. Welke taal dat was wordt vastgelegd, zodat de voorgestelde
naam als `product_translation` in de juiste locale landt.

Aliassen hebben hier geen last van: die bewaren ruwe bontekst per keten, en
dezelfde keten in een ander taalgebied krijgt gewoon zijn eigen aliassen.

### Barcodes scannen in de browser

De barcodescanner is de belangrijkste manier om een onherkende regel op te
lossen, dus die moet op elke telefoon werken. Dat is precies waar een PWA het
lastig heeft:

- **`BarcodeDetector`** is ingebouwd in Chrome op Android en kost niets. Snel,
  accuraat, geen extra code.
- **Safari op iOS ondersteunt het niet.** Daar is een WebAssembly-lezer
  (`zxing-wasm`) nodig die de camerabeelden zelf decodeert. Dat is geen
  randgeval maar ongeveer de helft van de gebruikers, dus de fallback is de
  hoofdweg en niet een vangnet.
- **Handmatig intikken** blijft altijd mogelijk. Beschadigde en gekreukte
  verpakkingen bestaan, en dertien cijfers overtypen is sneller dan drie keer
  opnieuw richten.

De gedecodeerde GTIN wordt server-side opgezocht, nooit rechtstreeks vanuit de
client — anders loopt de Open Food Facts-cache en het quotum eromheen.

### Offline

De voorraadlijst moet werken zonder netwerk — je staat in de kelder of bij de
vriezer in de garage. Service worker met een lokale kopie van de eigen
voorraad. Scannen mag internet vereisen.

### Migraties

Alle schema-wijzigingen als bestanden in `supabase/migrations`, in git. Niet
klikken in het dashboard.

---

## 10. Testen

De riskantste code zit niet in de UI maar in de database en de parser.

| Wat | Hoe |
|---|---|
| Matchladder, consensusdrempels, outlierdetectie | Tests tegen een testdatabase |
| RLS-scheiding tussen huishoudens | Expliciete tests met twee gebruikers |
| Schapprijs versus betaalde prijs bij kortingen | Tests met echte kortingsregels: 2e gratis, -30%, kassakorting |
| Account verwijderen | Test dat privédata weg is én dat de catalogus intact blijft |
| Maandplafond | Test dat scannen stopt en de rest van de app blijft werken |
| Vision-parser | Fixtureset van echte bonnen met verwachte JSON |
| Scanflow van begin tot eind | Playwright |

**Begin vanaf vandaag kassabonnen te fotograferen.** Vijftien tot twintig echte
bonnen van Colruyt, Delhaize, Lidl, Aldi, Carrefour en Albert Heijn, elk met de
JSON die eruit hoort te komen, zijn het waardevolste testbezit van dit project.
Zonder die set weet je nooit of een aanpassing aan de vision-prompt het beter
of stiekem slechter maakt.

Zorg dat er **Franstalige bonnen** in die set zitten, niet één als bijvangst.
Frans is geen extra taal maar de helft van het land, en een Carrefour-bon uit
Namen hoort net zo goed getest te zijn als een Colruyt-bon uit Aalst.

---

## 11. Bekende risico's en open punten

**Duur van de vision-call versus de timeout van je host.** Een bon uitlezen
duurt tien tot dertig seconden. Sommige serverless-hosts kappen af op tien. Op
te lossen bij de keuze van de host (een limiet van 60 s volstaat), of door het
parsen asynchroon te maken met `receipt.status` en Supabase Realtime. Te
beslissen bij de implementatie.

**Push-notificaties op iOS.** Een PWA kan pas pushen als hij op het beginscherm
staat, en dat is op iOS historisch wankel. "Je yoghurt vervalt morgen" krijgt
daarom e-mail als terugvaloptie. Als push essentieel blijkt, is dat het
sterkste argument om later alsnog naar Expo te gaan.

**Barcodescannen op iOS.** `BarcodeDetector` ontbreekt in Safari, dus daar
draait alles op een WebAssembly-lezer. Die is trager en gevoeliger voor slecht
licht, terwijl het scannen juist de vlotste weg naar een opgeloste regel hoort
te zijn. Vroeg testen op een echte iPhone, niet pas bij de oplevering.

**Koude start van de catalogus.** Op dag één is de databank leeg en doen de
eerste gebruikers al het werk. Te verzachten door de catalogus vooraf te vullen
met veelvoorkomende Belgische producten uit Open Food Facts.

**Dekking van Open Food Facts.** Sterk voor voeding, dunner voor
schoonmaakmiddelen, non-food en huismerken — en juist huismerken zijn een groot
deel van een gemiddelde kar. Reken er dus op dat zelf aanmaken een veelgebruikte
route is en geen uitzondering. Dat maakt de kwaliteit van dat formulier en van
de correctieflow belangrijker dan de OFF-koppeling zelf: als zelf aanmaken
vervelend is, stopt de catalogus met groeien precies daar waar hij het hardst
moet groeien.

**Het juridische spoor loopt niet vanzelf mee.** Verwerkersovereenkomsten,
privacyverklaring in drie talen en gebruiksvoorwaarden zijn geen code en gaan
daarom makkelijk vergeten worden tot vlak voor de lancering. Ze zijn wel
blokkerend om open te gaan. Zet ze als een apart spoor in de planning, niet als
laatste taak.

**Eén valuta.** Alle bedragen zijn in euro en er is geen omrekening. Voor
België en Nederland is dat prima; een gebruiker die in Zwitserland of het
Verenigd Koninkrijk winkelt krijgt onzin. `receipt.currency` bestaat al, dus
het model blokkeert niets, maar de prijsvergelijking gaat uit van euro.
Bonnen in een andere valuta worden bij het uitlezen geweigerd met een
duidelijke melding.
