import { test, expect } from '@playwright/test'

test('de homepage blijft publiek', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible()
})

test('een afgeschermde pagina stuurt je naar inloggen', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login/)
})

test('het inlogformulier toont een bevestiging na versturen', async ({ page }) => {
  await page.goto('/login')
  // Nuxt dev serveert ongebundeld (~1150 losse module-requests): 'load'
  // vuurt ruim voordat Vue hydrateert. 'networkidle' is hier geen optie -
  // Playwright's eigen docs raden het af, en de vervaltijd is een
  // dev-mode-toeval dat een productiebuild niet zou nodig hebben. Enkel op
  // zichtbaarheid wachten lost het ook niet op: SSR rendert de knop al
  // vóórdat @submit.prevent is aangesloten (bevestigd met een trace), dus
  // die is al zichtbaar terwijl een klik nog een kale, niet-JS submit
  // (paginareload) veroorzaakt. Vue zet __vueParentComponent op een element
  // in dezelfde hydratiestap waarin het de event listeners aansluit - dat
  // is het echte signaal, niet een aanname over timing.
  await page.waitForFunction(() => {
    const button = document.querySelector('button[type="submit"]')
    return !!button && '__vueParentComponent' in button
  })
  await page.getByLabel(/email/i).fill('test@example.com')
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()
})
