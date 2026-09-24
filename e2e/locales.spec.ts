import { test, expect } from '@playwright/test'
import { signIn, prefix, bundles, type Locale } from './helpers'

// De drie talen zijn een kernbelofte van de app, maar tot nu toe liep alleen
// /en end-to-end. Deze twee tests lopen dezelfde flow onder de andere twee.
const locales: Locale[] = ['nl', 'fr']

for (const locale of locales) {
  test(`de inlogflow werkt onder /${locale}`, async ({ page }) => {
    const email = `${locale}-${Date.now()}@example.com`

    await signIn(page, email, locale)

    // Na het inloggen zonder huishouden komt de gebruiker op onboarding uit,
    // en de taalprefix hoort onderweg niet verloren te gaan. Bevinding 6 van
    // de eindreview: de vorige assertie hier (not.toHaveURL(/\/confirm/))
    // herhaalde alleen wat signIn() al garandeert via
    // waitForURL((current) => !current.pathname.includes('/confirm')) —
    // een tautologie die nooit kon falen. Deze regel toetst in plaats
    // daarvan wat de comment hierboven al beweerde: de precieze,
    // taalprefixte onboardingroute.
    await expect(page).toHaveURL(new RegExp(`${prefix(locale)}/onboarding`))
  })
}

// De taalschakelaar staat bewust buiten `v-if="user"` in app.vue. Dit is de
// reden: een bezoeker die nog geen account heeft moet zijn taal kunnen
// kiezen. Tot deze wijziging koos `detectBrowserLanguage` dat voor je, en
// alleen op `/` — wie via een uitnodigingslink binnenkwam zat vast in de taal
// van de afzender.
for (const locale of locales) {
  test(`een uitgelogde bezoeker kan overschakelen naar ${locale}`, async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: bundles.en.landing.getStarted })).toBeVisible()

    // De schakelaar toont de taalcodes; klikken hoort je op dezelfde pagina te
    // houden, alleen met prefix.
    await page.getByRole('navigation', { name: bundles.en.nav.language })
      .getByRole('link', { name: locale, exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${prefix(locale)}/?$`))
    // Niet alleen de URL: de pagina moet ook echt in die taal staan. Zonder
    // deze regel zou een schakelaar die enkel de prefix verzet ook slagen.
    await expect(
      page.getByRole('link', { name: bundles[locale].landing.getStarted }),
    ).toBeVisible()
  })
}
