import { test, expect } from '@playwright/test'
import { signIn, readLatestMagicLink, waitForHydration, prefix, bundles, type Locale } from './helpers'

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

// Bevinding uit de review van task 3: removeMember() ververste na een
// succesvolle zelfverwijdering alleen de ledenlijst (loadMembers), nooit
// households/activeId (refresh) — de module-brede useState die app.vue,
// settings/places.vue en settings/household.vue allemaal lezen om te weten
// welk huishouden "actief" is. Verlaat een eigenaar zijn huishouden terwijl
// er nog een andere eigenaar overblijft (dus geen laatste-eigenaarblokkade),
// dan bleef activeId stilzwijgend het zojuist verlaten huishouden aanwijzen.
//
// Om dat aan te tonen zonder dat een toevallige refresh() van een andere
// pagina (/app en /settings/household roepen die zelf ook al aan in hun
// eigen onMounted) het gat overschildert, geeft deze test de kijker een
// TWEEDE huishouden en controleert — zonder enige navigatie ná de klik op
// "Remove" — dat de ledenlijst meteen omschakelt naar dat tweede huishouden.
// Zonder de fix blijft de lijst leeg (RLS filtert Huis1 stil weg zodra je er
// geen lid meer van bent); mét de fix verschijnt de kijker daar opnieuw, als
// enig lid en eigenaar van Huis2.
test('een eigenaar die zichzelf verwijdert, ziet meteen zijn andere huishouden', async ({ page, browser }) => {
  const ownerEmail = `e2e-leave-owner-${Date.now()}@example.com`
  await signIn(page, ownerEmail)

  // Eerst Huis2, dan Huis1: create() zet het nieuw aangemaakte huishouden
  // actief (useHousehold.ts), dus na deze twee stappen is Huis1 actief.
  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('Huis2')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Huis2')).toBeVisible()

  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('Huis1')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Huis1')).toBeVisible()

  await page.goto('/settings/household')
  await waitForButtonHydration(page)
  await page.getByRole('button', { name: 'Create invitation link' }).click()
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue()

  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  const guestEmail = `e2e-leave-member-${Date.now()}@example.com`

  await guest.goto(link)
  await expect(guest).toHaveURL(/\/login/)
  await waitForHydration(guest)
  await guest.getByLabel(/email/i).fill(guestEmail)
  await guest.getByRole('button', { name: /link/i }).click()
  await expect(guest.getByText(/inbox/i)).toBeVisible()

  const magicLink = await readLatestMagicLink(guestEmail)
  await guest.goto(magicLink)
  await expect(guest.getByText('Huis1')).toBeVisible()
  await guestContext.close()

  // Het lid meldde zich aan in een aparte browsercontext; deze verse
  // paginalading is setup (vóór de eigenlijke controle hieronder) — hier
  // krijgt de eigenaar het nieuwe lid voor het eerst te zien.
  await page.goto('/settings/household')
  await waitForButtonHydration(page)

  const membersSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Members', exact: true }) })

  await membersSection.getByRole('button', { name: 'Make owner' }).click()
  await expect(membersSection.getByRole('button', { name: 'Make owner' })).toHaveCount(0)

  // De eigenlijke controle: de eigenaar verwijdert zichzelf, en daarna wordt
  // er niets meer genavigeerd of herladen.
  await membersSection
    .locator('li')
    .filter({ hasText: '(you)' })
    .getByRole('button', { name: 'Remove' })
    .click()

  // Volgorde is hier van belang: "(you)" stond al vóór de klik in de DOM
  // (Huis1 had de kijker zelf als eigenaar), dus getByText('(you)') zou
  // toBeVisible() ook zien tijdens het korte gat vóórdat de DELETE en de
  // herlaad zijn afgerond — dat bewijst niets. Het aantal `<li>` is de
  // controle die echt onderscheidt: die blijft op 0 staan zolang activeId
  // niet is bijgewerkt (Huis1 is leeggefilterd door RLS), en telt pas 1
  // zodra de ledenlijst daadwerkelijk is omgeschakeld naar Huis2.
  await expect(membersSection.locator('li')).toHaveCount(1)
  await expect(membersSection.getByText('(you)')).toBeVisible()
  await expect(membersSection.getByText('Owner', { exact: true })).toBeVisible()
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

// Bevinding uit de review van taak 5, ronde 1: invite/[token].vue
// lokaliseerde wel '/login' zelf, maar niet de redirect-wáárde
// ('/invite/<token>' bleef onvertaald). confirm.vue navigeert na het
// inloggen letterlijk naar die waarde — safeInternalPath() keurt hem goed
// (het is een geldig intern pad), dus de enige taalbewuste tak
// (`?? localePath('/app')`) komt nooit aan bod. Een Franse of Nederlandse
// gast belandde zo zonder foutmelding op de Engelse uitnodigingspagina.
test('een uitgenodigde zonder account behoudt zijn taal door de hele inlogflow', async ({ page, browser }) => {
  const locale: Locale = 'fr'
  const fr = bundles[locale]

  // Eigenaar maakt een huishouden en een uitnodigingslink; de taal van de
  // eigenaar zelf doet voor deze bevinding niet ter zake.
  await signIn(page, `e2e-lang-owner-${Date.now()}@example.com`)
  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('Taalhuis')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Taalhuis')).toBeVisible()

  await page.goto('/settings/household')
  await waitForButtonHydration(page)
  await page.getByRole('button', { name: 'Create invitation link' }).click()
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue()
  const token = new URL(link).pathname.replace('/invite/', '')

  // Een gast zonder account op de Franse variant van de uitnodiging — een
  // geldige, bereikbare route: nuxt.config.ts sluit /fr/invite/* expliciet
  // uit van de auth-guard, dus de route bestaat en werkt voor wie er via
  // welke weg dan ook op belandt.
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  const guestEmail = `e2e-lang-guest-${Date.now()}@example.com`

  await guest.goto(`${prefix(locale)}/invite/${encodeURIComponent(token)}`)
  // Stap 1 van de bevinding werkte al vóór de fix: '/login' zelf kreeg al
  // een prefix. Ter controle, niet de kern van de test.
  await expect(guest).toHaveURL(new RegExp(`${prefix(locale)}/login`))

  await waitForHydration(guest)
  await guest.getByLabel(fr.auth.email).fill(guestEmail)
  await guest.getByRole('button', { name: fr.auth.sendLink }).click()
  await expect(guest.getByText(fr.auth.linkSent)).toBeVisible()

  const magicLink = await readLatestMagicLink(guestEmail)
  await guest.goto(magicLink)

  // De kern van de bevinding: na het inloggen hoort de gast terug te komen
  // op de Franse uitnodigingspagina, niet de Engelse. Vóór de fix in
  // invite/[token].vue landde dit op het onvertaalde /invite/<token>
  // (de Engelse route onder prefix_except_default); deze regex matcht dat
  // niet.
  await expect(guest).toHaveURL(new RegExp(`${prefix(locale)}/invite/${token}`))
  await expect(guest.getByText('Taalhuis')).toBeVisible()
  await guestContext.close()
})
