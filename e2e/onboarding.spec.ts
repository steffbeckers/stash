import { test, expect } from '@playwright/test'

// Mailpit is de lokale e-mailtestserver die bij `supabase start` meedraait
// (poort 54324, zie `supabase status`). Een uitnodiging naar een extern
// systeem is hier niet nodig: dit is dezelfde infrastructuur als de rest van
// de lokale Supabase-stack, geen extern CDN of testcode in de applicatie.
const mailpitUrl = 'http://127.0.0.1:54324'

// Waarom niet admin.auth.admin.generateLink() (zoals eerder geprobeerd):
// deze client draait via @supabase/ssr's createBrowserClient, die flowType
// altijd op 'pkce' zet, ongeacht configuratie. Een link van generateLink()
// is een impliciete-grant-link (tokens in de URL-hash) omdat er geen
// browser met een code_verifier bij betrokken was — GoTrueClient verwerpt
// zo'n link bij een PKCE-client met "Not a valid PKCE flow url." (bevestigd
// door de sessie handmatig te inspecteren: geen sessie, wel die foutmelding).
// Echt inloggen via het formulier laat de browser zelf een code_verifier
// zetten, waardoor de mail een pkce_-link bevat die wél werkt — dat is ook
// precies de flow die een gebruiker doorloopt.
async function waitForMagicLink(email: string): Promise<string> {
  const query = encodeURIComponent(`to:${email}`)
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(`${mailpitUrl}/api/v1/search?query=${query}`).then((r) => r.json())
    if (search.messages?.length > 0) {
      const message = await fetch(`${mailpitUrl}/api/v1/message/${search.messages[0].ID}`).then((r) => r.json())
      const match = (message.Text as string).match(/https?:\/\/\S+\/verify\?\S+/)
      if (match) return match[0]
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Geen magic link gevonden voor ${email} in Mailpit`)
}

// Nuxt dev serveert ongebundeld: 'load' vuurt ruim voordat Vue hydrateert en
// @submit.prevent aansluit. Zonder deze wacht raakt een klik op een
// submit-knop een kale, niet-JS formulier-submit (paginareload met de
// velden als querystring) in plaats van de Vue-handler. Zelfde signaal als
// e2e/login.spec.ts gebruikt.
async function waitForHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('button[type="submit"]')
    return !!button && '__vueParentComponent' in button
  })
}

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await waitForHydration(page)
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()

  const link = await waitForMagicLink(email)
  await page.goto(link)
  // confirm.vue stuurt pas door zodra de Supabase-client de sessie herkent
  // en useSupabaseUser() waarheid wordt (dat gebeurt pas na hydratie). Enkel
  // wachten tot de URL '/confirm' bevat volstaat niet: die staat er al
  // meteen na de redirect, ruim voordat de sessie is opgeslagen. Wachten tot
  // we van '/confirm' weg zijn bewijst dat de sessie er echt is.
  await page.waitForURL((current) => !current.pathname.startsWith('/confirm'))
}

test('een nieuwe gebruiker belandt op onboarding en kan een huishouden starten', async ({ page }) => {
  await signIn(page, `e2e-${Date.now()}@example.com`)

  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('Testhuis')
  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByText('Testhuis')).toBeVisible()
})

test('een gebruiker zonder huishouden wordt vanaf de app-startpagina doorgestuurd', async ({ page }) => {
  await signIn(page, `e2e-redirect-${Date.now()}@example.com`)

  await page.goto('/app')
  await expect(page).toHaveURL(/\/onboarding/)
})

test('een ingelogde gebruiker op de landingspagina belandt in de app', async ({ page }) => {
  await signIn(page, `e2e-landing-${Date.now()}@example.com`)

  await page.goto('/')
  await expect(page).toHaveURL(/\/(app|onboarding)/)
})
