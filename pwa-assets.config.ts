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
  // minimal2023Preset zet voor de groepen maskable en apple geen eigen
  // resizeOptions.background — sharp vult dan wit in zodra fit: 'contain'
  // ruimte overlaat rond het icoon (zie de typedocs bij ResizeOptions in
  // node_modules/@vite-pwa/assets-generator/dist/shared/assets-generator.Cjk4AKv_.d.ts,
  // regel 361: "by default, sharp will use white background color"). Dat wit
  // was in de gegenereerde bestanden ook echt terug te vinden (met de hand
  // pixels bemonsterd, niet enkel bekeken): een witte rand rond het teken.
  // Precies verkeerd voor een icoon dat zijn eigen achtergrond meebrengt —
  // Android snijdt een maskable icon tot een cirkel/squircle en iOS rondt
  // apple-touch-icon zelf af, dus die witte rand wordt een witte ring rond
  // een zwarte tegel. De bron-SVG houdt het teken al binnen de middelste 80%
  // tegen een volle #18181b-achtergrond (zie public/icon.svg); deze override
  // zorgt dat sharp's eigen opvulling die achtergrond overneemt in plaats van
  // hem met wit te overschrijven.
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { ...minimal2023Preset.maskable.resizeOptions, background: '#18181b' },
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { ...minimal2023Preset.apple.resizeOptions, background: '#18181b' },
    },
  },
  images: ['public/icon.svg'],
})
