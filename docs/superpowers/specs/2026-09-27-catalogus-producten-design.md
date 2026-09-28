# Catalogus: producten — ontwerp

Dit is de eerste steen van de gedeelde catalogus: producten met namen per taal,
doorzoekbaar over alle drie de talen tegelijk, door gebruikers aan te maken en
te bewerken.

Het hoofdontwerp (`2026-09-21-stash-design.md`) beschrijft de catalogus al in
detail, maar als één geheel van zeven stukken: producten, categorieën,
aliassen, winkels, moderatie, de Open Food Facts-import en geleerde
houdbaarheid. Dat is meer dan één implementatieplan. Deze spec snijdt het
eerste stuk eruit en zegt expliciet welke stukken blijven liggen.

## 1. Wat dit oplevert, en wat niet

**Wel:** een ingelogde gebruiker kan producten zoeken over drie talen heen,
een product aanmaken met een naam in zijn eigen taal, namen in de andere talen
toevoegen, en zijn eigen producten bewerken. Een moderator kan aan alles komen.

**Niet:** aliassen. En dat is een bewuste volgorde, geen vergetelheid.

Een alias vertaalt bontekst naar een product. Er is geen bontekst — geen
bonnen, geen scanner, geen `receipt_line`. Het hoofdontwerp zegt zelf dat je
aliassen zaait door twintig tot dertig echte bonnen te scannen en op te lossen;
zonder die scanner zou je ze met de hand intikken in een catalogus die verder
niemand raadpleegt. Aliassen krijgen hun eigen ronde zodra er iets is om van te
vertalen.

**Ook niet:** de Open Food Facts-import. Die brengt tienduizenden producten
mee, maar ook een importpijplijn, een Cron-trigger en een licentiebeslissing.
De ODbL is share-alike: een afgeleide databank moet onder dezelfde voorwaarden
beschikbaar zijn. Dat botst niet met dit project — een open catalogus is
precies het idee — maar het hoort een bewuste keuze in de gebruiksvoorwaarden
te zijn en geen ontdekking achteraf. Zie §9 van het hoofdontwerp.

**Eerlijke grens:** er is vandaag nog niets dat de catalogus gebruikt. Geen
voorraad, geen prijzen. Wat dit oplevert is een register dat je kan vullen en
doorzoeken — de voorwaarde voor al het andere, maar op zichzelf nog geen
functie waar je iets aan hebt.

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Producten eerst, aliassen in een eigen ronde | Een alias zonder bontekst om van te vertalen is stille infrastructuur. | Als de scanner lang uitblijft, staat er een catalogus zonder de laag die hem bruikbaar maakt. |
| Geen OFF-import | Houdt deze ronde klein en stelt de ODbL-beslissing uit tot ze bewust genomen kan worden. | De catalogus begint leeg; elk product is handwerk tot de import er is. |
| Statuskolom met één regel, geen consensusmotor | `trust_level = 0` maakt `proposed`, hoger maakt `confirmed`. Consensus tellen met één gebruiker is theater. | De statuskolom staat er al, dus uitbouwen kost geen migratie — alleen de motor erachter. |
| Schrijven alleen via RPC's | De invariant "elk product heeft minstens één vertaling" is een eigenschap van een *paar* rijen; geen RLS-policy kan dat afdwingen. | Meer `SECURITY DEFINER`-functies op een lijst die de beveiligingsadviseur al meldt. |
| Bewerken: alleen de maker en moderators | `product_revision` en het terugdraaien zijn uitgesteld. Zonder ongedaan maken is "iedereen mag alles" schade die niemand herstelt. | Wijkt af van "de catalogus is van de gebruikers" uit het hoofdontwerp. Het slot gaat eraf zodra revisies bestaan. |
| Lezen: alleen `authenticated` | Het hoofdontwerp zegt "open voor iedereen vanaf dag één", maar er is geen pagina die een uitgelogde bezoeker kan bereiken. Leesrecht voor `anon` is aanvalsoppervlak zonder gebruiker — en zo'n policy lekte eerder de hele gebruikersregistratie. | Openzetten is later één policy. |
| `trust_level` en `role` krijgen elk één as | Het hoofdontwerp voert ze allebei op en legt het onderscheid nooit uit: `trust_level` heeft "3 = moderator" én er is `role = 'moderator'`. | Als de scheiding verkeerd gekozen is, moet één van beide later herzien — maar geen van beide wordt vandaag ergens gelezen, dus er zit nog geen data aan vast. |
| `word_similarity`, niet `similarity` | Gemeten, zie §5. | Zoeken vindt de helft niet, zonder dat er ooit iets crasht. |

### De twee assen van vertrouwen

Het hoofdontwerp laat `trust_level` en `role` overlappen. Deze spec scheidt ze:

- **`trust_level`** is *verdiend* en mechanisch. Het bepaalt of wat jij aanmaakt
  op `proposed` of `confirmed` start — hoeveel het systeem je gegevens
  vertrouwt.
- **`role`** is *toegekend* en bestuurlijk. Het bepaalt of je aan andermans
  gegevens mag komen — je bevoegdheid.

Daarmee vervalt "3 = moderator" uit de vertrouwenstabel; dat dupliceerde
`role`. De constraint `between 0 and 3` blijft staan, 3 wordt niet gebruikt.

## 3. Datamodel

```sql
product (
  id          uuid pk,
  gtin        text unique,      -- EAN, mag leeg
  brand       text,             -- niet vertaald: Boni is Boni
  net_content numeric,          -- 1000
  unit        text,             -- ml | g | stuk
  status      text not null default 'proposed',
  created_by  uuid references auth.users,
  created_at  timestamptz not null default now()
)

product_translation (
  product_id uuid not null references product on delete cascade,
  locale     text not null,     -- en | nl | fr
  name       text not null,
  source     text not null,     -- user | off | machine
  primary key (product_id, locale)
)
```

**Drie kolommen uit het hoofdontwerp blijven weg**, telkens omdat hun betekenis
aan een subsysteem hangt dat niet bestaat: `category_id` wijst naar een tabel
die er niet is, `image_url` veronderstelt een uploadpad, `off_synced_at`
veronderstelt de import.

`net_content` en `unit` blijven wél. Dat zijn eigenschappen van het ding zelf,
en het hoofdontwerp is expliciet dat zonder die twee elke prijsvergelijking een
illusie is. Ze nu niet vragen betekent ze later opnieuw moeten vragen, aan
mensen die het product allang hebben ingevoerd.

### Constraints

| Constraint | Waarom |
|---|---|
| `gtin` acht, twaalf, dertien of veertien cijfers | Vorm, niet controlecijfer — zie §4. |
| `(net_content is null) = (unit is null)` | Een inhoud van 1000 zonder eenheid is ruis, geen gegeven. |
| `net_content > 0` indien gevuld | |
| `unit in ('ml','g','stuk')` indien gevuld | |
| `status in ('proposed','confirmed','established','rejected')` | |
| `source in ('user','off','machine')` | |
| `locale in ('en','nl','fr')` | Zonder grens fragmenteert `'EN'` of `'nl-BE'` de catalogus stilzwijgend. Een taal toevoegen wordt een bewuste migratie — wat het toch al is, want er komt een vertaalbestand en een routepad bij. |
| `length(btrim(name)) between 1 and 200` | |

### De invariant die geen constraint kan zijn

"Elk product heeft minstens één vertaling" gaat over een *paar* rijen. Een
check-constraint ziet er één. De invariant wordt daarom op twee manieren
geborgd:

1. **Er is geen deur.** Beide tabellen hebben RLS aan en krijgen **alleen** een
   select-policy, `to authenticated using (true)`. Geen insert-, update- of
   delete-policy, dus de `SECURITY DEFINER`-functies zijn de enige weg naar
   binnen, en die maken het paar in één transactie.
2. **De laatste vertaling kan niet weg.** Een trigger weigert het verwijderen
   van de laatste rij, precies zoals `prevent_last_owner_removal` dat doet voor
   de laatste eigenaar van een huishouden. Dat patroon staat er al, inclusief
   tests.

### Indexen

- `gin (name extensions.gin_trgm_ops)` op `product_translation` — schema
  expliciet, want `pg_trgm` staat in `extensions` en niet in `public`.
- `product(status)` en `product(created_by)`.

## 4. Schrijfpad

Vijf functies, alle `SECURITY DEFINER`, alle alleen aanroepbaar door
`authenticated`:

| Functie | Wie mag het |
|---|---|
| `create_product(gtin, brand, net_content, unit, locale, name)` | iedereen die ingelogd is |
| `update_product(target_product, gtin, brand, net_content, unit)` | de maker, of een moderator |
| `set_product_translation(target_product, locale, name)` | de maker, of een moderator |
| `remove_product_translation(target_product, locale)` | idem, nooit de laatste |
| `set_product_status(target_product, new_status)` | alleen een moderator |

`create_product` doet beide inserts in één transactie en kent de status toe:
`trust_level = 0` levert `proposed`, hoger levert `confirmed`. De eerste
vertaling krijgt `source = 'user'`.

`set_product_translation` is een upsert: bestaat er al een naam in die taal,
dan wordt hij vervangen; anders komt er een rij bij. Beide gevallen zetten
`source = 'user'`, want in beide gevallen heeft een mens het ingetikt.

**Alleen wat definer-rechten nódig heeft krijgt ze.** De vijf schrijffuncties
zijn `SECURITY DEFINER` omdat ze langs de ontbrekende insert-policies moeten.
De zoekfunctie uit §5 is dat **niet**: lezen is al toegestaan door de
select-policy, dus definer-rechten zouden daar puur extra aanvalsoppervlak
zijn. Dezelfde afweging is eerder gemaakt bij `protect_profile_privileges`, dat
om precies die reden van definer naar invoker is teruggezet. De trigger die de
laatste vertaling bewaakt volgt dezelfde regel: invoker, tenzij blijkt dat hij
rijen moet zien die RLS voor de aanroeper wegfiltert — en dan met die reden in
de migratie.

**Status staat los van `update_product`** omdat het een andere bevoegdheid is.
Samenvoegen zou twee rechtencontroles in één functie persen die dan allebei
moeten kloppen.

**Er is geen `delete_product`.** Een rij weghalen uit een gedeelde catalogus is
onomkeerbaar en er is geen revisiehistorie om op terug te vallen. Een verkeerd
product krijgt `status = 'rejected'` en verdwijnt uit het zoekresultaat. Daar is
die kolom voor.

**De barcode wordt op vorm gecontroleerd, niet op controlecijfer.** Een
verkeerd getypte maar vormgeldige barcode wijst voorgoed naar het verkeerde
product en ziet er plausibel uit — dat pleit vóór validatie. Maar een
mod-10-berekening in SQL die één keer fout staat, weigert geldige producten, en
dat merk je pas als iemand klaagt. Het formulier waarschuwt daarom zonder te
blokkeren.

**Grants volgen het bestaande patroon.** Triggerfuncties krijgen al hun rechten
ingetrokken (`revoke all ... from public, anon, authenticated`), de RPC's
krijgen `execute` voor `authenticated` en niets voor `anon`.

### Wat hier bewust niet wordt opgelost

Twee mensen kunnen hetzelfde product twee keer aanmaken. Zonder consensusmotor
houdt niets dat tegen, en `gtin` is meestal leeg. De tegenmaatregel zit in de
UI (§6): zoeken gaat altijd vooraf aan aanmaken. Dat is een verzachting, geen
oplossing, en het staat als bekende grens in de bevindingen.

## 5. Zoekpad

Eén functie: `search_products(zoekterm, voorkeurstaal, maximum)`.

### Woordgelijkenis, niet gewone gelijkenis — gemeten

| Zoekterm | Naam | `similarity` | `word_similarity` |
|---|---|---|---|
| `melk` | Bio halfvolle melk 1 L | **0,217** | **1,000** |
| `melk` | Halfvolle melk | 0,333 | 1,000 |
| `halfv` | Bio halfvolle melk 1 L | 0,208 | 0,833 |
| `mlek` | Bio halfvolle melk 1 L | 0,037 | 0,200 |
| `melk` | Sojadrink natuur | 0,000 | 0,000 |

De standaarddrempel van `similarity` is 0,3. Zoeken op "melk" zou "Bio
halfvolle melk 1 L" dus **niet vinden** — precies het geval waar deze app om
draait. Hoe langer en beschrijvender de productnaam, hoe lager `similarity`
scoort; dat is averechts voor een catalogus.

`word_similarity` meet of de zoekterm ergens *binnen* de naam past, en is
daarom het juiste instrument.

### De drempel

De standaard voor `word_similarity` is 0,6. Bij die drempel vindt de typefout
"mlek" niets (gemeten: 0,200). De drempel gaat daarom naar **0,2** — laag
genoeg voor typefouten, hoog genoeg om "Sojadrink natuur" buiten te houden
(0,000). Dat komt als functie-lokale `set` op `search_products`, niet globaal.

### De geïndexeerde kolom staat links — conventie, geen vereiste

`gin_trgm_ops` ondersteunt `%`, `%>` en `%>>` — de commutatoren van `<%` en
`<<%`. De **geïndexeerde kolom links** schrijven (`name %> zoekterm`, niet
`zoekterm <% name`) laat de expressie rechtstreeks op de operatorklasse
aansluiten en is de gangbare vorm.

Hier stond eerder dat de omgekeerde volgorde Postgres stilletjes op een
sequentiële scan laat vallen. Dat is tijdens taak 3 nagemeten en bleek niet te
kloppen: de planner herschrijft `<%` via zijn geregistreerde commutator naar
`%>`, dus de index is in beide richtingen bruikbaar. Bij het geteste
rijaantal (2000) koos de planner sowieso een sequentiële scan, ongeacht
richting — op kosten, want de tabel was er te klein voor om de index lonend
te maken. De geïndexeerde kolom links blijft dus de juiste keuze, maar als
conventie en als de vorm die rechtstreeks bij de operatorklasse aansluit, niet
omdat de omgekeerde vorm de index onbruikbaar maakt. Het commentaar in de
migratie (`supabase/migrations/20260927100200_search_products.sql`) is toen
al gecorrigeerd; deze paragraaf hier nog niet — dat is nu ingehaald.

De functie draait met `set search_path = public, extensions`, anders is
`word_similarity()` niet vindbaar.

### Gevonden worden en getoond worden

Matchen gebeurt over **alle** talen: typ je "milk", dan vind je het product ook
als de match op een andere taal zit. De naam die je **ziet** volgt de
terugvalketen — jouw taal, dan Engels, dan de eerste beschikbare — en de
functie geeft terug uit welke taal die naam kwam, zodat de UI kan markeren dat
je iets in een andere taal leest.

**Eén rij per product**, niet één per vertaling. Zonder ontdubbeling komt een
product dat in twee talen matcht er twee keer uit.

### Statusfiltering

`rejected` valt eruit. `proposed` blijft zichtbaar, met een markering. Dat wijkt
bewust af van de matchladder uit het hoofdontwerp, die alleen `confirmed` en
hoger meetelt — maar die ladder gaat over het automatisch herkennen van
bonregels. Een mens die zoekt moet zijn zojuist aangemaakte product
terugvinden, anders lijkt het verdwenen.

Een lege zoekterm geeft de recentst aangemaakte producten, zodat de pagina niet
leeg opent.

## 6. UI

| Routesleutel | en · nl · fr |
|---|---|
| `products` | `/products` · `/nl/producten` · `/fr/produits` |
| `products/new` | `/products/new` · `/nl/producten/nieuw` · `/fr/produits/nouveau` |
| `products/[id]` | `/products/[id]` · `/nl/producten/[id]` · `/fr/produits/[id]` |

**Zoeken en aanmaken zijn één beweging.** Op `/products` typ je, resultaten
verschijnen terwijl je typt, en daaronder staat permanent een affordance die je
zoekterm meeneemt naar het formulier. Aanmaken kan alleen nadat je hebt gezien
wat er al staat — de tegenmaatregel tegen duplicaten uit §4.

**De productpagina toont alle drie de taalvakjes**, ook de lege. Dat is hoe de
catalogus meertalig wordt en de natuurlijkste plek om bij te dragen. Elke
vertaling toont haar herkomst, zodat zichtbaar is wat je mag vertrouwen.
Bewerkknoppen verschijnen alleen voor de maker en voor moderators.

**Een nieuw navigatie-item.** Na de vorige ronde bleef er zo'n 100px speling in
de Franse header; "Produits" eet daar het grootste deel van op. Of het past, is
niet vooraf bekend — en hoeft dat ook niet te zijn, want de veegtest meet het.
Gaat die rood, dan verhuist het item of wordt het een icoon.

**Mobiel:** `net_content` en `unit` staan naast elkaar in het formulier en
moeten onder `sm` stapelen. De stapeltest krijgt daar een vierde geval bij.

## 7. Testen

### De meting uit §5 wordt een regressietest

Zoeken op "melk" moet "Bio halfvolle melk 1 L" vinden. Die test gaat rood zodra
iemand `word_similarity` terugvereenvoudigt naar `similarity` — een fout die
zich uit als "zoeken vindt de helft niet", zonder dat er ooit iets crasht. Een
tweede geval op de typefout "mlek" bewaakt de verlaagde drempel.

### Tests die in paren komen

Elk recht wordt van twee kanten getoetst, want de helft van een paar slaagt ook
bij een implementatie die simpelweg iedereen weigert:

- Iemand anders kan mijn product **niet** bewerken — een moderator **wel**.
- `trust_level = 0` levert `proposed` — `trust_level = 1` levert `confirmed`.
- `rejected` valt uit het zoekresultaat — `proposed` blijft erin.
- Een product met alleen een Engelse naam geeft voor een Nederlandse gebruiker
  die Engelse naam terug **én** de melding dat het Engels is.

### Patronen die dit project al heeft

- Een directe insert buiten de RPC om wordt geweigerd — zoals `weigert een
  rechtstreekse insert buiten create_household() om`.
- `anon` mag geen enkele productfunctie aanroepen — zoals `anon mag geen enkele
  huishoudfunctie aanroepen`.
- De laatste vertaling kan niet weg — zoals de laatste eigenaar van een
  huishouden niet weg kan.

### Ontdubbeling

Een product dat in twee talen matcht komt één keer terug. Zonder die test valt
de ontdubbeling er stilletjes uit en toont de UI hetzelfde product twee keer.

### De veegtest pakt de nieuwe routes vanzelf op

`e2e/mobile.spec.ts` leidt zijn routelijst af uit `routePaths` in plaats van
hem uit te typen. Dat was vorige ronde een ontwerpkeuze waarvan de waarde
alleen beweerd kon worden; dit is de eerste keer dat ze zich uitbetaalt.

### Wat niet beloofd wordt

Of de GIN-index werkelijk gebruikt wordt, wordt getoetst met een test die een
paar duizend vertalingen zaait en het queryplan naleest. Dat is de brosste test
van de set: de planner mag zelf kiezen, en bij een kleine tabel kiest hij
terecht een sequentiële scan. Blijkt hij onbetrouwbaar, dan gaat hij eruit met
een notitie in de bevindingen — **niet** met `enable_seqscan = off` eromheen,
want dan bewijst hij niets meer.

## 8. Wat hier niet in zit

- **Aliassen en winkels.** Eigen ronde, zodra er bontekst is. Zie §1.
- **De OFF-import.** Eigen ronde, met de ODbL-beslissing erbij. Zie §1.
- **Categorieën.** `product.category_id` wijst naar een tabel die er niet is.
  Categorieën dragen standaardhoudbaarheid en bewaarplaats, en die zijn pas
  nodig als er voorraad is.
- **Productfoto's.** Vragen een publieke bucket met eigen RLS-policies op
  objecten en verkleinen vóór upload.
- **`product_revision` en terugdraaien.** Zolang die er niet zijn, blijft
  bewerken beperkt tot de maker en moderators.
- **De consensusmotor.** Bevestigingen tellen, promotie naar `established`.
- **Geleerde houdbaarheid.** Hoort bij voorraad.

## 9. Gevolgen voor bestaand werk

| Wat | Gevolg |
|---|---|
| `routes.config.ts` | Drie routesleutels erbij. De afgeleide `supabaseExclude` blijft ongemoeid: geen van de drie is publiek. |
| `e2e/mobile.spec.ts` | Neemt de drie routes automatisch mee in de veegtest. Krijgt een vierde geval in de stapeltest. |
| `AppHeader.vue` | Eén navigatie-item erbij. Of de Franse header dat trekt, beslist de veegtest. |
| `i18n/locales/*.json` | Een `products`-blok in alle drie de bestanden; `test/i18n/locales.test.ts` dwingt dat af. |
| De beveiligingsadviseur van Supabase | Meldt straks elf `SECURITY DEFINER`-functies in plaats van zes. De bestaande bevinding daarover moet dat aantal noemen. |

## 10. Falsificatie

Waaraan we zien dat dit werkt, en niet alleen dat het groen is:

1. **De zoektest draait eerst tegen `similarity`** en moet dan rood staan op
   "melk" → "Bio halfvolle melk 1 L". Pas daarna gaat hij naar
   `word_similarity`. Staat hij bij `similarity` al groen, dan meet hij iets
   anders dan hij beweert.
2. **De indexrichting wordt omgedraaid** (`zoekterm <% name` in plaats van
   `name %> zoekterm`) en het queryplan nagelezen. Verandert het plan niet, dan
   toetst de indextest niets.
3. **Elk recht wordt van beide kanten gemeten**, zoals in §7 opgesomd. Eén
   kant alleen is geen bewijs.
4. **De vertaalinvariant wordt aangevallen**: een poging om de laatste
   vertaling te verwijderen moet falen, en een directe insert op `product`
   buiten de RPC om ook.
5. **De statusregel wordt gemeten op beide niveaus**, niet afgeleid uit de
   code.

Eén aanname blijft staan en wordt niet nagemeten: dat 0,2 de juiste drempel is
voor een gevulde catalogus. Hij is gekozen op vier productnamen. Bij tienduizend
producten kan hij te laag blijken en ruis binnenhalen. Dat is een afstelling,
geen ontwerpfout — maar het getal is niet heilig en hoort opnieuw bekeken te
worden zodra de OFF-import er is.
