/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { offlinePathFor } from '../routes.config'

declare const self: ServiceWorkerGlobalScope

// cleanupOutdatedCaches ruimt de precache van vorige builds op. Zonder dit
// stapelen oude versies zich op in de opslag van het toestel, en op iOS —
// waar de quota krap zijn — is dat de manier om de hele cache te laten
// wegvallen.
cleanupOutdatedCaches()

// self.__WB_MANIFEST wordt door de build gevuld met de gehashte assets.
precacheAndRoute(self.__WB_MANIFEST)

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
  new NavigationRoute(async ({ request }) => {
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
  }),
)
