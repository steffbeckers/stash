/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// cleanupOutdatedCaches ruimt de precache van vorige builds op. Zonder dit
// stapelen oude versies zich op in de opslag van het toestel, en op iOS —
// waar de quota krap zijn — is dat de manier om de hele cache te laten
// wegvallen.
cleanupOutdatedCaches()

// self.__WB_MANIFEST wordt door de build gevuld met de gehashte assets.
// De navigatie-afhandeling komt in Taak 4; deze worker precacht voorlopig
// alleen.
precacheAndRoute(self.__WB_MANIFEST)
