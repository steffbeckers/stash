import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Eén bron, alle formaten afgeleid. Het icoon later vervangen is daarmee één
// bestand omwisselen en dit script opnieuw draaien, in plaats van zes
// bestanden met de hand opnieuw exporteren.
//
// `npm run icons` levert zes bestanden in public/ op, niet zeven: favicon.ico,
// pwa-64x64.png, pwa-192x192.png, pwa-512x512.png, maskable-icon-512x512.png
// en apple-touch-icon-180x180.png. Er komt geen favicon.svg — minimal2023Preset
// (zie node_modules/@vite-pwa/assets-generator/dist/presets/minimal-2023.mjs)
// kent alleen de groepen transparent/maskable/apple, geen svg-favicon-entry.
// De head-link die de generator voorstelt (`rel="icon" href="/icon.svg"`)
// wijst rechtstreeks naar dit bronbestand hierboven, dat toch al in public/
// staat en dus zelf al als statisch bestand serveerbaar is.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: minimal2023Preset,
  images: ['public/icon.svg'],
})
