/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { offlinePathFor } from '../routes.config'

declare const self: ServiceWorkerGlobalScope

// Bewust geen clients.claim() en geen skipWaiting(): registerType 'prompt'
// (zie nuxt.config.ts) laat de gebruiker zelf een update bevestigen. Grijpt
// de nieuwe worker meteen de macht over al open pagina's, dan verandert het
// navigatiegedrag onder iemands handen vandaan vóórdat diegene daarmee heeft
// ingestemd. Gevolg: de pagina die de worker zojuist registreerde blijft tot
// de eerstvolgende navigatie ongecontroleerd — de e2e-tests in
// e2e/pwa/offline.spec.ts wachten daar expliciet op (wachtOpServiceWorker),
// anders meten ze de fetch-handler hieronder helemaal niet.

// Dit verbiedt geen skipWaiting() in het algemeen — alleen ongevraagd, tijdens
// install/activate. Wat hieronder staat is het tegenovergestelde: skipWaiting()
// uitsluitend als reactie op een klik in PwaUpdatePrompt.vue (Taak 6), die via
// workbox-window's messageSkipWaiting() een { type: 'SKIP_WAITING' }-bericht
// stuurt.
//
// Die toestemming geldt registratiebreed, niet alleen voor het tabblad waarin
// geklikt is: skipWaiting() promoot de wachtende worker voor de hele
// registratie. vite-plugin-pwa herlaadt daardoor niet slechts "elk tabblad
// dat de melding toonde" — de herlaad-listener hangt aan het
// controlling-event (workbox-window's wrapper om het native
// controllerchange-event van elk tabblads eigen navigator.serviceWorker),
// en dat vuurt voor elke client die de browser op dat moment als
// gecontroleerd beschouwt, niet specifiek voor de tabbladen die zelf de
// melding lieten zien. Geaccepteerd, want het alternatief is erger — een
// tabblad dat op de oude versie blijft hangen, draait tegen een precache
// waar PrecacheController.activate() (automatisch gekoppeld door
// precacheAndRoute() hieronder — zie de toelichting bij
// cleanupOutdatedCaches()) de entries van de vorige build net uit heeft
// verwijderd.
//
// Zonder deze listener komt het SKIP_WAITING-bericht nergens aan: de
// wachtende worker blijft wachten en de knop doet zichtbaar niets (gevonden
// in code review na Taak 6; ontbrak hier sinds Taak 4). generateSW zou deze
// listener zelf meeleveren; bij injectManifest is dit bestand van jou, dus
// hoort hij hier.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// Niet cleanupOutdatedCaches() hieronder, maar PrecacheController.activate()
// is wat de precache van de vorige build daadwerkelijk opruimt.
// precacheAndRoute() hieronder koppelt activate() automatisch aan het
// activate-event; die methode vergelijkt de huidige cache-inhoud met het
// nieuwe manifest en verwijdert wat er niet meer in staat
// (node_modules/workbox-precaching/PrecacheController.js). cleanupOutdatedCaches()
// doet iets anders: hij verwijdert alleen caches waarvan de náám verschilt
// van de huidige precachenaam (utils/deleteOutdatedCaches.js), en die naam is
// gelijk over builds van dezelfde Workbox-versie heen — bij een gewone
// redeploy vindt hij dus niets om op te ruimen. Wat hij wél afvangt: een
// wisseling van Workbox-versie (of cacheId), waarbij de precachenaam zelf
// verandert en een oude cache anders voorgoed onder zijn oude naam was blijven
// staan. Zonder deze twee samen stapelen oude versies zich op in de opslag
// van het toestel, en op iOS — waar de quota krap zijn — is dat de manier om
// de hele cache te laten wegvallen.
cleanupOutdatedCaches()

precacheAndRoute(self.__WB_MANIFEST, {
  // Nuxt vraagt de payload op als _payload.json?_b=<buildhash>, terwijl hij in
  // de precache staat onder een sleutel zónder querystring. Workbox vergelijkt
  // standaard inclusief queryparameters en mist hem daardoor — met een
  // NUXT_E7002 in de console tot gevolg. De parameter identificeert de build,
  // en de precache komt per definitie uit dezelfde build als deze worker.
  //
  // Deze array vervangt Workbox' eigen default voor
  // ignoreURLParametersMatching, dus /^utm_/ en /^fbclid$/ staan er met opzet
  // nog naast _b — anders verliest een precache-lookup voor elke URL met zo'n
  // parameter stilzwijgend zijn match.
  ignoreURLParametersMatching: [/^_b$/, /^utm_/, /^fbclid$/],
})

// Netwerk-eerst, en het antwoord wordt niet bewaard.
//
// Dat laatste is geen vergetelheid maar de kern. Een gecachte /nl/voorraad
// bevat de naam van een huishouden en straks de inhoud ervan; op een gedeeld
// toestel, of na uitloggen, is dat precies het verkeerde bestand om nog te
// hebben.
//
// Dit is ook de reden dat hier geen workbox.navigateFallback staat. Die bouwt
// een route die de fallback áltijd uit de precache serveert, niet alleen bij
// netwerkfalen — wat voor een SSR-app neerkomt op server-rendering uitzetten.
registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        return await fetch(request)
      } catch {
        // Waargenomen (Taak 3 Step 8, bevestigd door de e2e-test hieronder):
        // de precachesleutels in sw.js zijn relatief en zonder index.html-staart
        // ("offline", "nl/offline", "fr/hors-ligne"), terwijl offlinePathFor()
        // een pad mét beginslash teruggeeft ("/offline"). matchPrecache werkt
        // hier toch mee: hij resolvet zowel de sleutel uit het manifest als dit
        // argument tegen self.location.href vóór de vergelijking, en sw.js
        // staat in de wortel — dus "/offline" en "offline" komen op dezelfde
        // absolute URL uit.
        const pad = offlinePathFor(new URL(request.url).pathname)
        return (await matchPrecache(pad)) ?? Response.error()
      }
    },
    {
      // /api/* hoort ongemoeid naar het netwerk, ook als iemand zo'n pad
      // rechtstreeks opent: een navigatie naar een API-pad moet falen, niet
      // de offline-pagina worden. Zonder denylist matcht NavigationRoute élke
      // navigatie (elk verzoek met mode 'navigate'), dus ook deze — gemeten
      // zonder denylist: een offline navigatie naar /api/health leverde
      // status 200 met de Engelse offline-pagina als body op, in plaats van
      // een mislukte aanvraag. fetch()-verkeer (mode 'cors', zoals de
      // client gebruikt om de API aan te roepen) matcht toch al nooit met
      // NavigationRoute; dit dekt specifiek het geval van een rechtstreekse
      // navigatie naar zo'n pad.
      denylist: [/^\/api\//],
    },
  ),
)
