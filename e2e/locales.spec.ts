import { test, expect } from '@playwright/test'
import { signIn, prefix, type Locale } from './helpers'

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
