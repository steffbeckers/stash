# Mobiel en gebruikersmenu — ontwerp

Stash is sinds vorige week installeerbaar. Het icoon staat op een startscherm,
dus de app wordt vanaf nu vooral op een telefoon geopend. Dit ontwerp gaat over
wat je daar aantreft.

De aanleiding was een verzoek om "de mobiele responsiveness te fixen", met een
reeks ideeën eromheen: een kleinere taalschakelaar, een avatar met een menu,
een profielpagina, en de voornaam vragen tijdens onboarding. Bij het nameten
bleek dat die ideeën niet naast het responsiviteitsprobleem staan maar het
grotendeels *oplossen* — en dat er onderweg een bestaande functie half af
bleek te zijn.

## 1. Wat dit oplost

Alles hieronder is gemeten in de draaiende app, niet afgeleid uit de code.

**De header loopt over op elke ingelogde pagina.**

| Taal | Viewport | `scrollWidth` | Overflow |
|---|---|---|---|
| Engels | 375 | 425 | 50px |
| Frans | 375 | 467 | 92px |
| Frans | 360 | 467 | **107px** |

In het Frans loopt de uitlogknop van x=401 tot x=467. Een Franstalige
gebruiker kan op zijn telefoon niet uitloggen zonder de pagina zijwaarts te
slepen. Dat is geen schoonheidsfout maar een onbereikbare functie.

**Het bewaarplaatsen-formulier knijpt zijn eigen invoerveld dood.** Op 360px
in het Frans: naamveld **49px**, keuzelijst 149px, knop 114px. Het veld waar
je een naam in typt is minder dan de helft van de knop ernaast. De oorzaak is
een `flex gap-2` waarin alleen het invoerveld `flex-1` heeft en dus als enige
inlevert.

**Iedereen heet "Unnamed".** `user_profile.display_name` wordt door
`useHousehold.loadMembers()` uitgelezen en in `HouseholdMembers.vue` getoond,
maar nergens in de app geschreven. De kolom is altijd `null`. De ledenlijst —
de enige plek waar een huishouden zichtbaar uit meer dan één persoon bestaat —
toont voor iedereen dezelfde vervangtekst.

**Voorspeld maar niet gemeten:** de ledenrij (naam + badge + twee knoppen) en
de uitnodigingskaart (volle-breedte URL-invoer naast twee `shrink-0`-knoppen).
Dat onderscheid tussen gemeten en voorspeld blijft staan tot §7 het beslecht.

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Taalschakelaar alleen uitgelogd, op **alle** publieke pagina's | Een genodigde komt via `/invite/<token>` binnen in de taal van de afzender en heeft geen andere weg terug. Staat zo in `LanguageSwitcher.vue` en er ligt een test op. | Alleen op de landingspagina zou de uitnodigingsflow breken — de reden dat deze regel er staat. |
| Instellingen verhuist naar het avatarmenu, blijft niet óók in de nav | Gangbaar patroon, en het is de ruimte die dit toekomstbestendig maakt. | Eén klik extra naar huishoudinstellingen. |
| Avatar toont initialen, geen geüploade foto | Nul infrastructuur. Een foto betekent een Storage-bucket, RLS op objecten, verkleinen vóór upload — een eigen subsysteem. | Later alsnog een uploadpad toevoegen; de initialen blijven dan de fallback. |
| Voornaam in het bestaande `display_name`, geen nieuwe kolom | De kolom, de RLS-policy en de trigger bestaan al; de ledenlijst leest hem al. Een tweede kolom dwingt elke leesplek tot een voorrangsregel. | Als "voornaam" en "weergavenaam" ooit uit elkaar moeten, kost dat een migratie en een keuzeregel. |
| Instellingen-tabs als component, niet als Nuxt-layout | Een layout vereist `<NuxtLayout>` in `app.vue` en verandert daarmee de renderboom van élke pagina, inclusief de geprerenderde offline-pagina die met de hand in de precache is nageteld. | Bij een vierde instellingenpagina alsnog promoveren; dat is mechanisch werk. |
| Profiel ophalen tijdens SSR, niet in `onMounted` | De sessie is server-side bekend (nagemeten: de server-HTML bevat de nav en de uitlogknop). Scheelt een zichtbare flits van icoon naar initialen bij elke volledige paginalading. | Eén extra query per SSR-verzoek. |
| Testviewport 360px, niet 375px | 375 is de ontwerpmaat, 360 de eerlijke ondergrens van wat er rondloopt. | Geen; 360 dekt 375 mee. |
| Lengtegrens van 60 tekens op `display_name` | §7 belooft hard dat niets overloopt. Die belofte mag niet afhangen van de goede wil van de gebruiker: de kolom is nu `text` zonder bovengrens en loopt rechtstreeks de ledenlijst in. | Eén migratie om de grens te verruimen. |

## 3. De schil: header en avatarmenu

`app/app.vue` beheert nu PWA-head-tags, rendert de navigatie én handelt
uitloggen af. Met een avatarmenu erbij groeit dat naar ongeveer 150 regels.
De header wordt `app/components/AppHeader.vue`; `app.vue` houdt `UApp`,
`useHead`, `<NuxtPage />` en `<PwaUpdatePrompt />` over.

| Onderdeel | Uitgelogd | Ingelogd |
|---|---|---|
| Merknaam → landingspagina | ja | ja |
| Navigatie (Voorraad) | nee | ja |
| Taalschakelaar | ja | nee |
| Avatarmenu | nee | ja |

De taalschakelaar wordt compact: icoon plus taalcode (`NL`, `EN`, `FR`), met
de volledige namen in de dropdown. Het `aria-label` blijft `nav.language`, dus
de toegankelijke naam van de knop verandert niet.

Het avatarmenu is een `UDropdownMenu` om een `UAvatar`. De avatar toont
initialen uit `display_name` — de eerste letter van elk woord, maximaal twee —
en valt terug op `i-lucide-user` zolang er geen naam is. De dropdown bevat de
naam of het e-mailadres als kopje, dan Instellingen (naar de profieltab), dan
Uitloggen.

Nagemeten in de DOM op de Franse pagina: met de taalschakelaar uit de header
en de uitlogknop vervangen door een avatar van 32px gaat `scrollWidth` van
467 naar 375 — nul overflow, met 16px over terwijl "Paramètres" nog in de nav
stond. Dat woord is ongeveer 90px; zonder blijft er ruim 100px over. Dat is de
ruimte waar het catalogus-item straks in past.

## 4. Profiel en data

`app/composables/useProfile.ts`, naast het bestaande `useHousehold`:

```ts
const { profile, refresh, save } = useProfile()
// profile: Ref<{ userId: string, displayName: string | null } | null>
```

Gelezen door de header en de profielpagina; geschreven door de profielpagina,
onboarding en de uitnodigingsflow. `save()` trimt de invoer, schrijft een lege
waarde weg als `null`, en gooit fouten door in plaats van ze te slikken.

Het schrijfpad bestaat al en is al getest. De policy "je mag je eigen profiel
bijwerken" staat er, `protect_profile_privileges` laat `display_name` met rust
en blokkeert alleen `trust_level` en `role`, en `test/db/permissions.test.ts`
bewijst de update. Er is dus geen migratie nodig om te kúnnen schrijven.

Eén migratie komt er wel, om de reden in §2: een check-constraint van 60
tekens, met een db-test die hem afdwingt. Het invoerveld krijgt dezelfde
`maxlength`, zodat de constraint in normaal gebruik nooit afgaat — maar de
constraint is de echte grens, niet het formulier.

## 5. Instellingen met tabs

Drie pagina's: Profiel (nieuw), Huishouden, Bewaarplaatsen. Het losse
"Storage places"-linkje naast de kop "Household" verdwijnt; de tabs nemen dat
over. Daarmee verdwijnt meteen een van de flexrijen uit de risicolijst.

`<SettingsTabs />` staat bovenaan elk van de drie pagina's. De tabstrip krijgt
vanaf het begin `overflow-x-auto`, niet als noodgreep maar als ontwerpkeuze:
"Profiel / Huishouden / Bewaarplaatsen" is in het Nederlands al krap op 360px,
en de volgende taal die erbij komt valt niet vooraf te meten.

Let op wat dat betekent voor §7: een strip die binnen zichzelf schuift
veroorzaakt geen page-overflow, dus Test 1 blijft daar groen op. Dat is de
bedoelde uitkomst en geen ontsnapping — maar het staat hier expliciet, omdat
het dezelfde vorm heeft als de faalmodus die dit project veertien keer eerder
heeft opgeleverd.

Nieuwe route in `routes.config.ts`: `settings/profile` →
`/settings/profile`, `/instellingen/profiel`, `/parametres/profil`. Niet in
`publicRoutes`. Een kaal `/settings` dat doorstuurt komt er bewust niet;
niets linkt daarheen.

## 6. Onboarding en uitnodiging

Er zijn twee manieren waarop iemand voor het eerst binnenkomt, en allebei
moeten ze om een naam vragen. Wie via een uitnodiging joint ziet onboarding
namelijk nooit, en blijft anders voorgoed "Unnamed" in de ledenlijst van
precies het huishouden dat hem uitnodigde.

**In onboarding** komt één veld bij, boven de huishoudnaam: je voornaam.
Verplicht, en voorgevuld als je al een naam hebt.

De volgorde is hier een correctheidskwestie. Eerst het profiel opslaan, dán
het huishouden aanmaken. Andersom kan het huishouden slagen terwijl de naam
faalt; de gebruiker zit dan naamloos in een huishouden en een tweede poging
maakt een tweede huishouden aan. In de voorgestelde volgorde is een mislukking
veilig, want het profiel opslaan is idempotent.

**Op de uitnodigingspagina** verschijnt het naamveld alleen als er nog geen
naam is. Het is daar niet verplicht: `accept_invite` draait al in `onMounted`,
dus je bent op dat moment al lid, en je achteraf achter een formulier
opsluiten beschermt niets meer. De knop naar je voorraad blijft altijd
beschikbaar.

## 7. Responsiviteit en de twee tests

De test komt eerst en mag dit ontwerp tegenspreken. §1 scheidt gemeten van
voorspeld; die scheiding wordt hier opgeheven door te meten, niet door te
redeneren. We schrijven de tests, draaien ze tegen de huidige `main`, en
leggen de rode lijst vast. Een test die op ongerepareerde code groen staat,
heeft geen tanden.

**Test 1 — de veegtest.** Viewport 360×740, met de assertie
`document.documentElement.scrollWidth <= clientWidth`.

De routelijst wordt afgeleid uit `routePaths`, niet met de hand getypt, zodat
een nieuwe route automatisch meedoet. Daar komt de landingspagina bij, die
geen vertaald pad heeft (`/`, `/nl`, `/fr`) en dus niet in `routePaths` staat.
Wie een route uitzondert schrijft in dezelfde regel op waarom.

| | Aantal |
|---|---|
| Sleutels in `routePaths` (inclusief de nieuwe `settings/profile`) | 9 |
| Af: `confirm` — stuurt meteen door, geen stabiele pagina om te meten | −1 |
| Af: `invite/[token]` — eigen geval, met een echt token | −1 |
| **De veegtest, ingelogd: 7 routes × 3 talen** | **21** |
| De landingspagina, uitgelogd, 3 talen | +3 |
| **Totaal gemeten** | **24** |

De landingspagina krijgt een eigen geval in plaats van mee te lopen in de
veegtest, om twee redenen. Ze staat niet in `routePaths` — er is geen
routenaam voor de wortel, dezelfde constatering die
`test/routes/offline-path.test.ts` al maakt. En ze is de enige plek waar de
header van een *uitgelogde* bezoeker te zien is, met de compacte
taalschakelaar die in dit ontwerp verandert; de veegtest draait ingelogd en
zou die variant dus nooit meten.

Dat de ingelogde header de zwaarste is, is geen aanname: uitgelogd staat er
merknaam plus taalschakelaar, ingelogd merknaam plus navigatie plus avatar.
Toch wordt de lichtere variant apart gemeten, want hij verandert hier.

Bij de landingspagina wordt de taalcookie expliciet gezet. `redirectOn:
'root'` stuurt juist op `/` door naar de taal uit die cookie, en zonder dat
expliciet te maken hangt de uitkomst af van de volgorde waarin de talen
getest worden — een test die afhangt van zijn eigen volgorde meet niet wat
hij beweert.

**Test 1 alleen is niet genoeg, en dat is gemeten.** Het naamveld van 49px
staat in een formulier van 328px binnen een viewport van 360px. Dat formulier
loopt niet over; de 107px page-overflow kwam volledig van de header. Test 1
zou dus groen staan op een invoerveld dat onbruikbaar is.

**Test 2 — de stapeltest.** Op de drie rijen met bediening naast elkaar
(bewaarplaatsen-formulier, ledenrij, uitnodigingskaart) toetsen we dat de
onderdelen op 360px niet op dezelfde regel staan: verschillende
`getBoundingClientRect().top`. Dat is een directe uitspraak over de fix
(`flex-col sm:flex-row`) zonder verzonnen drempelgetal, en hij wordt rood
zodra iemand het stapelen terugdraait.

De fixes zelf zijn klein. De header lost zichzelf op via §3. De drie rijen
krijgen `flex-col sm:flex-row` met volle breedte eronder.

## 8. Gevolgen voor bestaande tests

| Test | Wat er gebeurt |
|---|---|
| `locales.spec.ts` | Overleeft ongewijzigd. Zoekt de knop op `aria-label="Language"` en de menu-items op hun volledige naam; allebei blijven staan. |
| `onboarding.spec.ts`, navigatietest | Breekt: klikt op een link "Settings" die er niet meer is. Moet voortaan het avatarmenu openen — precies wat de test hoort te bewijzen. |
| `onboarding.spec.ts`, ledentest | Toetst nu dat het label "Owner" zichtbaar is. Wordt strenger: toetst dat de ingevoerde naam in de ledenlijst staat, en bewijst daarmee het hele pad formulier → `display_name` → ledenlijst. |
| `invite.spec.ts` | Krijgt erbij dat een genodigde zónder naam het veld ziet, en iemand mét naam niet. Die tweede helft is de falsificatie; zonder haar zou "altijd tonen" ook slagen. |

## 9. Wat hier niet in zit

- **Geüploade profielfoto's.** Een eigen subsysteem; zie §2.
- **Minimale tikdoelen van 44×44.** Een eigen onderwerp dat elke knop in de
  app raakt. Gaat naar `open-bevindingen.md`.
- **Een hamburgermenu of bottom-bar.** Niet nodig: na §3 past de header met
  ruim 100px over. Bij een derde en vierde navigatie-item wordt dit weer een
  vraag.
- **Het e-mailadres wijzigen** op de profielpagina. Dat is een auth-flow met
  bevestiging via e-mail, geen profielveld.

## 10. Falsificatie

Waaraan we zien dat dit werkt, en niet alleen dat het groen is:

1. Test 1 en Test 2 draaien tegen `main` vóór enige fix. De rode lijst wordt
   vastgelegd in het plan. Zijn ze daar groen, dan deugt de test niet.
2. De header-fix wordt nagemeten op 360px in alle drie de talen, tegen de
   **gebouwde** app en niet alleen tegen de dev-server.
3. De profielnaam wordt end-to-end bewezen: invoeren in onboarding, terugzien
   in de ledenlijst. Niet door de database te bevragen.
4. De lengtegrens krijgt een db-test die een naam van 61 tekens afgewezen ziet
   worden — op databaseniveau, met de constraint als bewijs, niet via het
   formulier.
5. Het naamveld van 49px wordt opnieuw gemeten na de fix. Test 2 dekt dat af,
   maar het getal gaat in het plan zodat de volgende lezer ziet waar het
   vandaan kwam.

Eén aanname is niet met dezelfde hardheid nagemeten als de rest: deze tests
draaien tegen de dev-server, en de Tailwind-uitvoer wordt daar verondersteld
identiek te zijn aan die van de build voor de klassen die we gebruiken.
Punt 2 hierboven dekt het belangrijkste geval af.
