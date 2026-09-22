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
  // Nuxt dev serveert ongebundeld (honderden losse module-requests), dus
  // 'load' vuurt ruim voordat Vue gehydrateerd is. Zonder deze wachtstap
  // klikt Playwright soms vóór @submit.prevent is aangesloten, wat een
  // kale, niet-JS formulier-submit (paginareload) veroorzaakt in plaats
  // van de echte handler.
  await page.waitForLoadState('networkidle')
  await page.getByLabel(/email/i).fill('test@example.com')
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()
})
