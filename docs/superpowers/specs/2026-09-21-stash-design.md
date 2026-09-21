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
eigen foto; een globale catalogus met
correctie en revisiegeschiedenis; prijshistoriek en prijsvergelijking per
winkel; voorraad per huishouden met bewaarplaatsen en vervaldatums; afstrepen
met onderscheid tussen opgemaakt en weggegooid; huishoudens met
uitnodigingslinks; publieke registratie met consensus, moderatie, quota en
misbruikpreventie; receptvoorstellen op basis van de voorraad; een Engelse,
Nederlandse en Franse interface, met productnamen per taal.

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
  unique (chain_id, raw_text_norm, product_id)
)
```

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
  unit_price_cents       int not null,     -- prijs per verkochte eenheid
  normalized_price_cents int,              -- per liter / kg / stuk, afgeleid
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
  acquired_at       date not null,
  expires_at        date,
  receipt_line_id   uuid references receipt_line,
  status            text not null default 'in_stock',  -- in_stock | closed
  closed_at         timestamptz,
  closed_by         uuid,
  closed_reason     text              -- consumed | discarded
)
```

Eén rij per stuk. Drie potten passata met drie vervaldatums zijn drie rijen; in
de app zie je "Passata ×3" met het detail eronder. Zonder die opsplitsing is
"wat vervalt er binnenkort" niet te beantwoorden.

Een gebruiker mag in meerdere huishoudens zitten (kot, ouderlijk huis) met één
actief huishouden in de app. Dat kost niets extra en voorkomt tweede accounts.

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
```

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
| 1 | Exacte alias op `(chain_id, raw_text_norm)`, status >= `confirmed` | Automatisch |
| 2 | `pg_trgm` similarity > 0,8 binnen dezelfde keten | Voorstel, één tik |
| 3 | `pg_trgm` similarity over ketens heen | Voorstel, expliciete bevestiging |
| 4 | Gok van het vision-model, opgezocht in Open Food Facts | Voorstel met foto en merk |
| 5 | Niets | Gebruiker zoekt in de eigen catalogus, scant de barcode, of maakt het product zelf aan |

Trede 1 is het hele punt: bij een tweede bezoek aan dezelfde winkel is een
groot deel van de bon meteen opgelost, zonder API-kost en zonder handwerk. Elke
keer dat iemand op trede 5 uitkomt en het oplost, verhuist die regel voor
iedereen permanent naar trede 1. Het vision-model is dus geen vaste kost per
bon maar de ontdekkingskost voor onbekende regels, en die neemt af.

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

1. Voor elke productregel met een `product_id`: een `inventory_item` aanmaken,
   tenzij de categorie `tracks_inventory = false` heeft of de gebruiker het
   uitvinkte.
2. Bewaarplaats bepalen: voorstel uit `product_category.default_storage_kind`,
   overschreven door wat dit huishouden eerder voor dit product koos.
3. Vervaldatum bepalen: geleerde mediaan voor `(product, storage_kind)`, anders
   `default_shelf_life_days` van de categorie, anders leeg. De gebruiker past
   aan met snelknoppen (+3d / +1w / +1m / +6m) of een datumkiezer. Een
   aanpassing levert een `shelf_life_observation` op.
4. Een `price_observation` aanmaken, met `normalized_price_cents` berekend uit
   `net_content` en `unit`, en kortingsregels verrekend.
5. Nieuwe aliassen vastleggen of bestaande bevestigen.

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

### Vertrouwensniveaus

| Niveau | Wanneer |
|---|---|
| 0 | Nieuw account, of minder dan 3 bijdragen die bleven staan |
| 1 | Normale gebruiker |
| 2 | Veel bijdragen die bevestigd werden en bleven staan |
| 3 | Moderator, handmatig toegekend |

---

## 7. Misbruik en kosten

Het grootste risico is niet vandalisme maar **je API-rekening**. Iemand die een
script op je parse-endpoint zet, kost echt geld.

- Quotum per gebruiker per dag op scans en receptvoorstellen, afgedwongen in de
  server-route tegen `usage_quota`, vóór de API-call
- Verplichte e-mailverificatie voordat er één scan mag
- Maximale beeldgrootte en maximaal aantal foto's per bon
- Bij overschrijding een expliciete melding, geen stille fout

**Architectuurregel:** de client schrijft **nooit** rechtstreeks naar globale
data. Aliassen, producten en prijswaarnemingen gaan altijd via `server/api`.
Zonder die regel zijn quota, consensuslogica en outlierdetectie te omzeilen met
een gekopieerde anon-sleutel, en is de gedeelde databank binnen een week
onbruikbaar. Privédata (voorraad, bonnen, huishouden) mag wel rechtstreeks
vanuit de client, want RLS schermt die al af.

---

## 8. Privacy

Op een kassaticket staan de laatste vier cijfers van je betaalkaart, het exacte
tijdstip, de winkel en alles wat je die dag kocht. Dat mag nooit meeliften met
een publieke prijswaarneming.

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
  aliases.post.ts                 handmatig een alias instellen
  recipes/suggest.post.ts         voorraad -> Claude -> voorstellen
  reports.post.ts                 rapporteren
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
