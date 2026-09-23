import { test, expect } from '@playwright/test'
import { signIn, readLatestMagicLink, waitForHydration } from './helpers'

// Zelfde hydratieprobleem als bij de submit-knoppen in onboarding.spec.ts,
// maar de "Create invitation link"-knop hangt aan @click buiten een form, dus
// heeft geen type="submit". Kijkt daarom naar een willekeurige knop op de
// pagina in plaats van specifiek button[type="submit"].
async function waitForButtonHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('button')
    return !!button && '__vueParentComponent' in button
  })
}

test('een uitgenodigde zonder account wordt na inloggen lid', async ({ page, browser }) => {
  // Eigenaar maakt een huishouden en een uitnodigingslink.
  await signIn(page, `e2e-owner-${Date.now()}@example.com`)
  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('Uitnodigingshuis')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Uitnodigingshuis')).toBeVisible()

  await page.goto('/settings/household')
  await waitForButtonHydration(page)
  await page.getByRole('button', { name: 'Create invitation link' }).click()
  // Label komt uit invite.linkLabel (i18n), niet meer hardcoded — in het
  // Engels (de standaardlocale waarin deze test draait) is de tekst
  // ongewijzigd "Invitation link".
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue()
  expect(link).toContain('/invite/')

  // De vervaldatum moet een echt jaartal tonen, niet leeg renderen —
  // zonder datetimeFormats voor 'short' rendert d() niets.
  await expect(page.getByText(/Valid until .*\d{4}/)).toBeVisible()

  // Een verse browsercontext: iemand die nergens is ingelogd.
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  const guestEmail = `e2e-guest-${Date.now()}@example.com`

  await guest.goto(link)
  await expect(guest).toHaveURL(/\/login/)
  await waitForHydration(guest)

  await guest.getByLabel(/email/i).fill(guestEmail)
  await guest.getByRole('button', { name: /link/i }).click()
  await expect(guest.getByText(/inbox/i)).toBeVisible()

  // De echte magic link uit Mailpit hoort terug te leiden naar de uitnodiging,
  // niet naar /app.
  const magicLink = await readLatestMagicLink(guestEmail)
  await guest.goto(magicLink)

  await expect(guest.getByText('Uitnodigingshuis')).toBeVisible()
  await guestContext.close()
})

test('een externe redirect wordt genegeerd', async ({ page }) => {
  const email = `e2e-redirect-${Date.now()}@example.com`

  await page.goto('/login?redirect=https://example.com/phishing')
  await waitForHydration(page)
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()

  const magicLink = await readLatestMagicLink(email)
  expect(magicLink).not.toContain('example.com')

  // En protocol-relatief mag evenmin.
  const email2 = `e2e-redirect2-${Date.now()}@example.com`
  await page.goto('/login?redirect=//example.com/phishing')
  await waitForHydration(page)
  await page.getByLabel(/email/i).fill(email2)
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()

  const magicLink2 = await readLatestMagicLink(email2)
  expect(magicLink2).not.toContain('example.com')

  // Een backslash in plaats van de tweede slash: een handgeschreven
  // `!startsWith('//')` mist dit (de tweede byte is geen '/'), maar een
  // browser behandelt het toch als protocol-relatief. Dit is het gat dat de
  // review vond in de eerste versie van de guard.
  const email3 = `e2e-redirect3-${Date.now()}@example.com`
  await page.goto(`/login?redirect=${encodeURIComponent('/\\example.com/phishing')}`)
  await waitForHydration(page)
  await page.getByLabel(/email/i).fill(email3)
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()

  const magicLink3 = await readLatestMagicLink(email3)
  expect(magicLink3).not.toContain('example.com')

  // Zelfde gat, met een tab tussen de twee scheidingstekens.
  const email4 = `e2e-redirect4-${Date.now()}@example.com`
  await page.goto(`/login?redirect=${encodeURIComponent('/\t/example.com/phishing')}`)
  await waitForHydration(page)
  await page.getByLabel(/email/i).fill(email4)
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()

  const magicLink4 = await readLatestMagicLink(email4)
  expect(magicLink4).not.toContain('example.com')
})
