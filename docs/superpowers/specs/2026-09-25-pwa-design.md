# Stash — PWA

Vervolg op [het hoofdontwerp](2026-09-21-stash-design.md), dat PWA al als
platform koos (§3) en `@vite-pwa/nuxt` aanwees (§9). Dit document vult in hóe,
en legt vast waar de belofte uit §9 vandaag ophoudt.

---

## 1. Doel, en een eerlijke grens

§9 belooft: *"De voorraadlijst moet werken zonder netwerk — je staat in de
kelder of bij de vriezer in de garage."*

**Die belofte kan deze ronde niet waargemaakt worden.** Er is geen voorraad.
`app/pages/inventory.vue` toont de naam van je huishouden en verder niets, en
een `stock_item`-tabel bestaat niet. Er is letterlijk niets om te cachen.

Dat hier opschrijven is goedkoper dan het later ontdekken in een plan dat
ervan uitgaat dat het er wel staat.

Wat deze ronde wél doet: de app installeerbaar maken, de schil zonder netwerk
laten openen, en de update-flow goed zetten *voordat* er gebruikers zijn die
aan een verkeerde versie vast kunnen komen te zitten. De offline voorraad
volgt wanneer de voorraad bestaat — dan pas is bekend welke vorm ze heeft, en
cachen op een vorm die nog gaat veranderen is werk dat je twee keer doet.

---

## 2. Scope

### In deze ronde

- Installeerbaar op Android, iOS en desktop: manifest, icons, een service
  worker die aan de installatievoorwaarden voldoet
- De schil opent zonder netwerk: build-assets geprecacht, een offline-pagina
  per taal als vangnet
- Een update-flow die de gebruiker ziet en bevestigt
- Het icoon, want een geïnstalleerde app met het Nuxt-logo erop is geen app
- De taalprefix die verloren gaat bij de auth-bounce (zie §5)

### Uitdrukkelijk niet in deze ronde

- Data offline beschikbaar maken — er is nog geen data die dat verdient
- Een eigen installatieknop (zie §3)
- Push-notificaties, background sync, periodic sync
- Een donkere modus; die staat los van dit werk

---

## 3. Genomen beslissingen

| Beslissing | Keuze | Waarom |
|---|---|---|
| Strategie | `injectManifest`, met een eigen `app/sw.ts` | Navigatielogica die je kan lezen, becommentariëren en testen. `generateSW` verstopt ze in configuratie |
| Navigatie | Netwerk-eerst, antwoord nooit cachen | Pagina's verschillen per gebruiker én per taal. Gecachte HTML is hier geen optimalisatie maar een lek |
| Offline-vangnet | Een geprerenderde pagina per taal | Statisch bestand, geen auth, geen data. Het enige wat offline met zekerheid te tonen valt |
| Manifest | Drie, één per taal, met dezelfde `id` | `start_url` is het enige veld dat er echt toe doet en het enige dat per taal verschilt |
| Updates | `registerType: 'prompt'` | Zichtbaar, en het herlaadt niet onder een half ingevuld formulier vandaan |
| Installatieknop | Geen | `beforeinstallprompt` bestaat niet op iOS. Een knop die op de helft van de toestellen niets doet is slechter dan geen knop |
| Icoon | Eén bron-SVG, de rest afgeleid | Later vervangen is één bestand omwisselen, geen negen PNG's opnieuw exporteren |
| E2E | Tegen een gebouwde preview, niet tegen `nuxt dev` | In dev is de precache leeg; dan test je een andere service worker dan de gebruiker krijgt |

---

## 4. De service worker

### `navigateFallback` is hier een valstrik

De voor de hand liggende weg — `generateSW` met `workbox.navigateFallback` —
doet iets anders dan de naam suggereert. Workbox bouwt daarmee een
navigatieroute die de fallback-HTML **uit de precache** serveert, niet als
vangnet bij netwerkfalen maar altijd. Voor een statische site is dat precies
goed. Voor Stash betekent het dat server-rendering uitstaat: elke navigatie
krijgt de fallback in plaats van de pagina die de server voor díe gebruiker in
díe taal rendert.

De module maakt het makkelijker om daarin te lopen dan eruit te blijven: de
standaard `navigateFallbackAllowlist` in `devOptions` is `/\//`, wat elk pad
met een schuine streep matcht ([vite-pwa/nuxt#139](https://github.com/vite-pwa/nuxt/issues/139)).

Vandaar `injectManifest` en veertig regels eigen code.

### Wat er geprecacht wordt

De gehashte build-assets (`_nuxt/*`), de icons, de drie offline-pagina's, en
de vertaalbestanden. Alles wat geprecacht wordt, wordt daarmee een bestand dat
je belooft te kunnen serveren zonder netwerk — en die belofte is alleen te
doen over bestanden die voor iedereen hetzelfde zijn.

Die vertaalbestanden stonden hier eerst niet bij. Ze bleken tijdens de bouw
nodig: `@nuxtjs/i18n` haalt de berichten per taal apart op
(`_i18n/<hash>/<taal>/messages.json`), en zonder netwerk mislukt dat. De
server-gerenderde offline-pagina komt dan wél correct vertaald binnen, maar
Nuxt' hydratie overschrijft de tekst daarna met de rauwe sleutels —
`offline.title` in plaats van "Je bent offline". Een offline-pagina die
offline onleesbaar wordt is precies wat deze sectie moet voorkomen.

Dat defect was er al, maar bleef verborgen achter een test die op een
ongecontroleerde client draaide en de race won. Het principe hierboven
verandert niet: vertalingen zijn voor iedereen hetzelfde en horen er dus in
thuis.

### Navigatie: netwerk-eerst, nooit cachen

```
navigatieverzoek
  → fetch(request)
      → gelukt?  antwoord doorgeven, niets bewaren
      → gefaald? de offline-pagina die bij de taalprefix hoort
```

Het antwoord niet bewaren is de kern. Een gecachte `/nl/voorraad` bevat de naam
van een huishouden en straks de inhoud ervan. Op een gedeeld toestel, of na
uitloggen, is dat precies het verkeerde bestand om nog te hebben.

### Van pad naar offline-pagina

`offlinePathFor('/nl/voorraad')` geeft de Nederlandse offline-pagina. Die
afleiding komt in `routes.config.ts` te staan, naast `routePath()` en
`routeGlob()` — hetzelfde bestand dat al de i18n-config, de `exclude`-lijst
van `@nuxtjs/supabase` en de e2e-tests voedt. De service worker importeert hem
daaruit, zodat de offline-pagina's en de routevertalingen niet uit elkaar
kunnen lopen.

Het is bovendien een pure functie: gegeven een pad, een pad terug. Dat is het
stuk dat een echte unittest kan krijgen in plaats van een browsertest die
hoopt.

De route komt erbij als `offline`, met dezelfde prefixregel als de rest:
`/offline` in het Engels, `/nl/offline` in het Nederlands en
`/fr/hors-ligne` in het Frans. Hij gaat in `publicRoutes` — anders probeert de
auth-guard hem tijdens het prerenderen naar de inlogpagina te sturen.

### Wat hij niet aanraakt

`/api/*`, alles richting Supabase, en elk verzoek dat geen navigatie is en
niet in de precache staat. Die gaan ongemoeid naar het netwerk. De
auth-cookies lopen daar gewoon doorheen, omdat het verzoek ongewijzigd wordt
doorgegeven.

---

## 5. Het manifest, per taal

### Drie manifesten, één app

Een manifest is één bestand met één `start_url`. Staat daar `/inventory` in,
dan opent het startscherm-icoon van een Nederlandse gebruiker voorgoed een
Engelse pagina.

Daarom drie: `/manifest/en`, `/manifest/nl` en `/manifest/fr`, geserveerd door
één Nitro-route `server/routes/manifest/[locale].get.ts` met
`Content-Type: application/manifest+json`. Geen bestandsextensie in de URL —
de content-type doet het werk, en dat scheelt gedoe met Nitro's
bestandsnaamparsing. `app.vue` zet de `<link rel="manifest">` die bij de
huidige taal hoort; de module genereert er zelf geen (`manifest: false`).

Ze delen dezelfde `id`, zodat de browser het als één app ziet en niet als
drie. Ze delen ook `scope: '/'`, want de app loopt over `/`, `/nl/*` en
`/fr/*`.

De manifest-route is een server-route en gaat dus niet door de
route-middleware van Nuxt; hij hoeft niet in `supabaseExclude`.

### `start_url` en de taalprefix bij uitloggen

Hier raakt dit werk een openstaande bevinding. Met `start_url: '/nl/voorraad'`
komt iemand die uitgelogd op het icoon tikt bij de voorraad, die auth vereist,
en de guard van `@nuxtjs/supabase` stuurt hem naar het kale `/login` — zonder
taalprefix. Dat staat in `open-bevindingen.md` als het vierde en enige nog
openstaande geval van taalverlies.

Tot nu toe was dat een schoonheidsfout op een pad dat je zelden raakt. Met een
geïnstalleerde app wordt het het eerste scherm dat een nieuwe gebruiker ziet,
in een taal die hij niet koos. Daarom gaat hij mee in deze ronde.

**De oplossing:** de loginroute stuurt zelf door. Komt iemand op `/login`
terwijl zijn taalkeuze Nederlands of Frans is, dan gaat hij naar
`/nl/inloggen` of `/fr/connexion`. Die taalkeuze is er al —
`detectBrowserLanguage` bewaart hem in de cookie `stash_locale`.

**Uitdrukkelijk niet gekozen:** de redirect van `@nuxtjs/supabase` helemaal
vervangen door eigen auth-middleware. Dat lost hetzelfde op maar raakt elke
afgeschermde route in de app, en dat is te groot voor deze ronde.

### De velden

| Veld | Waarde |
|---|---|
| `id` | `/` — gelijk voor alle drie |
| `start_url` | De voorraad in die taal: `/inventory`, `/nl/voorraad`, `/fr/stock` — mét prefix, want `prefix_except_default` geeft alleen het Engels een kaal pad |
| `scope` | `/` |
| `name` / `short_name` | `Stash` — in alle drie de talen hetzelfde |
| `description` | De vertaalde tagline |
| `lang` | `en-GB`, `nl-BE`, `fr-BE` — dezelfde waarden als in de i18n-config |
| `display` | `standalone` |
| `theme_color` | `#18181b` |
| `background_color` | `#ffffff` — dit is het splash-scherm, en de app opent licht |

`orientation` blijft weg. Portret afdwingen is op een tablet onbeleefd.

---

## 6. Het icoon

Een voorraadpot met inhoud, crèmekleurig op bijna zwart. Eén vorm, omdat een
icoon meestal op 36 pixels te zien is en niet op 512 — een tekening met zes
losse elementen wordt daar een vlek.

Eén bron-SVG in `public/`, waaruit `@vite-pwa/assets-generator` alle formaten
afleidt: 192 en 512 voor het manifest, een maskable variant met
veiligheidsmarge voor Android, een apple-touch-icon voor iOS, en de favicon —
die daarmee ook eindelijk niet meer het logo van Nuxt is.

---

## 7. Updates, en de hardnekkigheid van een service worker

Dit is het deel met het afwijkende risicoprofiel. Een slechte migratie draai
je terug. Een slechte service worker zit op het toestel van je gebruiker,
overleeft een deploy, en verversen helpt niet.

Elke merge naar main deployt. Een service worker die blijft hangen betekent
dus: CI groen, `/api/health` meldt keurig de nieuwe SHA vanaf de server, en de
gebruiker draait ondertussen een oude schil. Dat is precies het soort stille
divergentie dat dit project al vaker is tegengekomen.

Drie dingen daartegen:

- **`registerType: 'prompt'`** — een melding "nieuwe versie beschikbaar" die
  de gebruiker bevestigt. Zichtbaar, en er gebeurt geen update waar niemand om
  gevraagd heeft.

  Dat isoleert geen tabbladen, en die nuance hoort hier te staan omdat ze bij
  het bouwen pas bleek. `skipWaiting()` promoveert de wachtende worker voor de
  hele registratie; er bestaat geen variant die alleen de afzender raakt. Klik
  je in het ene tabblad op Herladen, dan herlaadt elk ander tabblad dat de
  melding toont mee.

  Dat is bewust aanvaard, want het alternatief is slechter. Een tabblad dat
  blijft staan draait oude code terwijl `cleanupOutdatedCaches()` bij activatie
  de bijbehorende precache net heeft gewist; de eerstvolgende lazy geladen
  chunk vraagt dan een URL op die de deploy van de server verwijderd heeft. Een
  herlading is van die twee de zachtste afloop.
- **`cleanupOutdatedCaches()`** — oude builds blijven niet liggen.
- **`sw.js` mag niet lang gecachet worden.** Cloudflare serveert
  `.output/public` met lange caching voor gehashte bestanden; `sw.js` is niet
  gehasht. Zonder korte cache-header duurt het uren voor een nieuwe worker
  überhaupt opgemerkt wordt.

En in dev krijgt `devOptions` die te brede `navigateFallbackAllowlist` niet.

---

## 8. Wat dit raakt aan wat er al staat

| Bestand | Wijziging |
|---|---|
| `routes.config.ts` | Route `offline` erbij, in `publicRoutes`, plus `offlinePathFor()` |
| `nuxt.config.ts` | Het `pwa`-blok, prerender van de offline-routes, cache-header voor `sw.js` |
| `app/app.vue` | De manifest-link per taal en de update-melding |
| `i18n/locales/*.json` | Teksten voor de offline-pagina en de update-melding |
| `playwright.config.ts` | Een tweede project dat tegen een gebouwde preview draait |
| `.github/workflows/ci.yml` | Een build vóór dat tweede e2e-project |
| `public/favicon.ico` | Vervangen door het eigen icoon |
| `README.md` | Een sectie over de PWA |
| `open-bevindingen.md` | De taalprefix-bevinding eruit, de installatieknop erin |

Nieuw: `app/sw.ts`, `app/pages/offline.vue`,
`app/components/PwaUpdatePrompt.vue`, `server/routes/manifest/[locale].get.ts`,
`pwa-assets.config.ts`, de bron-SVG, `e2e/pwa.spec.ts` en een unittest voor
`offlinePathFor()`.

---

## 9. Testen

### Unit

`offlinePathFor()` voor elk van de drie talen en voor een pad zonder prefix.

### End-to-end

Tegen een **gebouwde** preview, niet tegen `nuxt dev`. In dev is de precache
leeg; een offline-test die daar groen staat bewijst niets over wat een
gebruiker krijgt. Dat is dezelfde soort val als de negen groene tests die dit
project eerder heeft opgeruimd, en het is beter hem nu te vermijden dan hem
later te vinden.

Playwright kan een context offline zetten. Daarmee:

- offline een pagina openen geeft de offline-pagina, in de taal van het pad
- een tweede taal geeft een ándere offline-pagina — anders zou een functie die
  altijd `/offline` teruggeeft de test halen
- een HTML-antwoord komt niet uit de cache
- de drie manifesten geven elk de juiste `start_url` en content-type

### Falsificatie

Elke test moet aantoonbaar kunnen falen. Concreet: haal de
navigatie-afhandeling uit `sw.ts` en de offline-tests horen om te vallen; laat
`offlinePathFor()` altijd de Engelse pagina teruggeven en de taaltest hoort om
te vallen. Dat wordt uitgevoerd, niet aangenomen.

---

## 10. Risico's en open punten

- **`nuxt preview` onder de `cloudflare_module`-preset.** Het tweede
  Playwright-project heeft een gebouwde server nodig. `nuxt preview` zou dat
  via `nitro-cloudflare-dev` moeten doen; blijkt dat niet te werken, dan is
  `wrangler dev` rechtstreeks de uitwijk. Te verifiëren, niet aan te nemen.
- **`manifest: false` en de service worker.** Dat de module nog een bruikbare
  service worker genereert als je zijn manifest uitzet, is aannemelijk maar
  niet nagekeken. Eerste ding om te controleren.
- **iOS is karig.** Geen `beforeinstallprompt`, beperkte cachegroottes, en een
  service worker die agressiever wordt opgeruimd. De offline-schil hoort te
  werken; de zekerheid is er kleiner dan op Android.
- **CI wordt trager.** Een build erbij voor het tweede e2e-project.
- **De installatieknop** blijft open, met de iOS-uitleg die erbij hoort.
