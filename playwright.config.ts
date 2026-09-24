import { defineConfig } from '@playwright/test'

// Zelfde reden als in test/db/helpers.ts: de testrunner laadt .env niet
// vanzelf. Een ontbrekend bestand negeren we; de tests falen dan alsnog
// met een duidelijke melding over de ontbrekende variabele.
try {
  process.loadEnvFile()
} catch (cause) {
  // ENOENT betekent: er is geen .env. Dat is normaal in CI, waar de
  // variabelen rechtstreeks in de omgeving staan. Elke andere fout betekent
  // dat er wél een bestand is maar dat het niet te lezen valt — dat stil
  // inslikken kost later uren zoeken naar een variabele die er wel lijkt te
  // staan.
  if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error('.env bestaat maar is niet te lezen', { cause })
  }
}

export default defineConfig({
  testDir: './e2e',
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
