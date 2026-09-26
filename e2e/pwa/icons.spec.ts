import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// De icons zijn statische bestanden, maar ze horen ook werkelijk in de
// gebouwde output te belanden. Een manifest dat naar een 404 wijst geeft
// geen foutmelding — de installatie toont dan gewoon een leeg vierkant.
const icons = [
  '/pwa-64x64.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/maskable-icon-512x512.png',
  '/apple-touch-icon-180x180.png',
]

test('elk icoon wordt geserveerd als afbeelding', async ({ request }) => {
  for (const pad of icons) {
    const antwoord = await request.get(pad)
    // Op zichzelf bewijst deze status-check hier weinig: elk pad buiten
    // supabaseExclude redirect naar /login, en Playwright volgt die redirect
    // en houdt over: status 200. Een ontbrekend icoon 404't dus niet, het
    // landt op de inlogpagina. De content-type-check hieronder doet het
    // echte werk — die faalt wél, want /login is text/html, geen image/*.
    expect(antwoord.status(), `status voor ${pad}`).toBe(200)
    expect(antwoord.headers()['content-type'], `content-type voor ${pad}`).toContain('image/')
  }
})

test('de favicon is niet meer die van Nuxt', async ({ request }) => {
  const antwoord = await request.get('/favicon.ico')
  expect(antwoord.status()).toBe(200)
  // Bevinding 9 van de eindreview: "niet 4286 bytes" (de grootte van het oude
  // Nuxt-logo) slaagt ook voor een afgekapt of anderszins corrupt bestand —
  // elke lengte behalve toevallig 4286 haalt die controle. Vergelijk in
  // plaats daarvan byte voor byte met public/favicon.ico zelf: dat pint het
  // werkelijk gegenereerde bestand vast, niet enkel "een andere lengte dan
  // ooit".
  const bron = readFileSync(new URL('../../public/favicon.ico', import.meta.url))
  const body = await antwoord.body()
  expect(body.equals(bron)).toBe(true)
})
