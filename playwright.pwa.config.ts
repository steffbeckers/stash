import { defineConfig } from '@playwright/test'
import { loadEnv } from './load-env'

loadEnv()

export default defineConfig({
  testDir: './e2e/pwa',
  use: { baseURL: 'http://localhost:3001' },
  webServer: {
    // De build hoort bij het starten: een preview tegen een oude .output is
    // precies de val waar dit project eerder in liep (zie "Valkuilen bij
    // lokaal ontwikkelen" in open-bevindingen.md). Daarom ook
    // reuseExistingServer: false — een hergebruikte server serveert stilletjes
    // de vorige build.
    //
    // `npx wrangler --cwd .output dev` en niet `nuxt preview`: Nitro drukt
    // deze opdracht zelf af aan het einde van de build, en dit is dezelfde
    // runtime als productie.
    command: 'npm run build && npx wrangler --cwd .output dev --port 3001',
    url: 'http://localhost:3001/api/health',
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
