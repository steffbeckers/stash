import { defineConfig } from '@playwright/test'
import { loadEnv } from './load-env'

loadEnv()

export default defineConfig({
  testDir: './e2e',
  // De PWA-specs hebben een gebouwde app nodig en draaien via
  // playwright.pwa.config.ts op poort 3001. Zonder deze uitsluiting zou
  // `npm run test:e2e` ze tegen de dev-server draaien, waar de precache leeg
  // is — en dan staan ze groen zonder iets te bewijzen.
  testIgnore: '**/pwa/**',
  // Playwright's eigen standaard is 30s per test, en drie tests passen niet
  // in dat gewicht. De veegtest in e2e/mobile.spec.ts doet eenentwintig
  // opeenvolgende navigeer-hydrateer-meet-cycli in één test en verbruikt
  // daarvan op een snelle machine al 21s aan kale navigatie, vóórdat er iets
  // gemeten is; de twee zware tests in e2e/invite.spec.ts doen elk één of
  // twee volledige magic-link-aanmeldingen. Onder vijf lokale workers faalt
  // `npm run test:e2e` daardoor zo'n 40% van de runs — altijd op deze
  // testtimeout, nooit op een layout- of gedragsassertie. Een CI-runner met
  // 2-4 vCPU die `nuxt dev` en de Supabase-stack moet delen kan de kosten per
  // navigatie makkelijk verdrievoudigen, dus 90s is geen ruime marge maar het
  // minimum dat deze drie tests een eerlijke kans geeft.
  //
  // Wat dit niet verbergt: geen enkele assertie in deze suite gaat over duur.
  // Het enige dat de oude grens van 30s ooit detecteerde was dus een
  // prestatieregressie — iets waar een testtimeout, als neveneffect van iets
  // anders, nooit een betrouwbare detector voor was. Om diezelfde reden staat
  // hier geen `retries`: in een project waarvan de gedocumenteerde faalmodus
  // groene tests is die niets bewijzen, maakt een retry van een echte,
  // incidentele mislukking alleen maar stille ruis.
  timeout: 90_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    // Niet baseURL zelf: Playwright volgt redirects bij het bepalen of de
    // server klaar is, en '/' verwijst standaard door naar '/login' (Step
    // 2). Zolang login.vue nog niet bestaat (voor Step 6) levert dat een
    // 404 op die nooit als "klaar" telt, en wacht Playwright de volle
    // timeout uit terwijl de server allang draait. /api/health zit niet
    // achter de afscherming en bestaat al sinds Task 1.
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
