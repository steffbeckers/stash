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

// cleanupOutdatedCaches ruimt de precache van vorige builds op. Zonder dit
// stapelen oude versies zich op in de opslag van het toestel, en op iOS —
// waar de quota krap zijn — is dat de manier om de hele cache te laten
// wegvallen.
cleanupOutdatedCaches()

precacheAndRoute(self.__WB_MANIFEST, {
  // Nuxt vraagt de payload op als _payload.json?_b=<buildhash>, terwijl hij in
  // de precache staat onder een sleutel zónder querystring. Workbox vergelijkt
  // standaard inclusief queryparameters en mist hem daardoor — met een
  // NUXT_E7002 in de console tot gevolg. De parameter identificeert de build,
  // en de precache komt per definitie uit dezelfde build als deze worker.
  ignoreURLParametersMatching: [/^_b$/],
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
