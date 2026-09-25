import { test, expect } from '@playwright/test'

// Service workers werken alleen in een secure context. localhost telt als
// secure, dus dit werkt zonder https.
test('de service worker registreert zich in de gebouwde app', async ({ page }) => {
  await page.goto('/')

  const scriptURL = await page.evaluate(async () => {
    const registratie = await navigator.serviceWorker.ready
    return registratie.active?.scriptURL ?? null
  })

  expect(scriptURL).toContain('/sw.js')
})
