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
