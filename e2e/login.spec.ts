import { test, expect } from '@playwright/test'

test('een afgeschermde pagina stuurt je naar inloggen', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('het inlogformulier toont een bevestiging na versturen', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill('test@example.com')
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()
})
