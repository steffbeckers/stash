import { expect } from '@playwright/test'
import { routePath } from '../routes.config'
// `with { type: 'json' }`: package.json heeft "type": "module", en Node's
// eigen ESM-loader (die Playwright hier gebruikt, niet enkel een
// TS-stripper) weigert een JSON-bestand zonder deze importattribuut te laden
// ("needs an import attribute of type: json"), ongeacht tsconfig-instellingen.
import en from '../i18n/locales/en.json' with { type: 'json' }
import nl from '../i18n/locales/nl.json' with { type: 'json' }
import fr from '../i18n/locales/fr.json' with { type: 'json' }

// De tests gebruiken dezelfde routekaart als nuxt.config.ts, zodat een
// hernoemd pad hier omvalt in plaats van stilletjes langs de tests te glippen.
export { routePath } from '../routes.config'

// Geëxporteerd zodat andere specs (zoals invite.spec.ts) ook de echte
// vertaling kunnen gebruiken in plaats van een regex, zonder i18n/locales/*
// een tweede keer te importeren.
export const bundles = { en, nl, fr }

export type Locale = keyof typeof bundles

// De namen zoals ze in de taalschakelaar staan. Ze komen uit de `locales`-
// array in nuxt.config.ts, die een e2e-test niet kan importeren; verandert
// daar een naam, dan valt dat hier om en niet stilletjes in de UI.
export const localeNames: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  fr: 'Français',
}

// nuxt.config.ts gebruikt strategy 'prefix_except_default' met defaultLocale
// 'en': /login voor Engels, /nl/login en /fr/login voor de rest.
export function prefix(locale: Locale): string {
  return locale === 'en' ? '' : `/${locale}`
}

// Gedeelde e2e-hulpfuncties voor onboarding.spec.ts, invite.spec.ts,
// locales.spec.ts en login.spec.ts.
//
// Dit staat in een los bestand (niet in onboarding.spec.ts zelf) omdat
// Playwright weigert een testbestand te draaien dat een ander testbestand
// importeert ("test file ... should not import test file ..."), een
// onvoorwaardelijke controle in de runner zonder configuratie-optie om hem
// uit te zetten. Zodra beide *.spec.ts-bestanden in dezelfde run meedoen
// (zoals `npm run test:e2e` zonder filter), faalt de hele run meteen bij het
// laden. Beide spec-bestanden importeren daarom hiervandaan in plaats van
// van elkaar.

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
export async function readLatestMagicLink(email: string): Promise<string> {
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

// Nuxt dev serveert ongebundeld, dus Vue hydrateert merkbaar later dan
// 'load'. Klik je daarvóór op een submit-knop, dan is @submit.prevent nog
// niet aangesloten en doet de browser een kale HTML-submit: de pagina laadt
// opnieuw met de velden in de querystring, en de test loopt vast op een
// scherm dat er bijna goed uitziet.
//
// De selector is instelbaar omdat niet elke pagina een formulier heeft: de
// landingspagina heeft alleen de taalschakelaar, en die reageert net zo goed
// pas na hydratie. De standaardwaarde dekt de formulierpagina's.
//
// Er is geen publieke API die zegt "deze knop is gehydrateerd".
// __vueParentComponent is een ongedocumenteerde Vue-interne: runtime-dom
// hangt hem aan een element zodra de component eraan gekoppeld is. Dat is
// bewust een koppeling aan een implementatiedetail, omdat het alternatief
// (een vaste pauze) traag én onbetrouwbaar is.
//
// Verdwijnt de eigenschap bij een Vue-majorupgrade, dan valt deze functie om
// in een timeout. De melding hieronder zorgt dat de volgende lezer niet gaat
// zoeken in de applicatie maar hier uitkomt.
//
// Een tweede, ander gat: deze functie werkt niet tegen een gebouwde app.
// Beide toekenningen van __vueParentComponent
// (node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js) zitten
// achter `process.env.NODE_ENV !== 'production' || __VUE_PROD_DEVTOOLS__`,
// en in de gecompileerde productiebuild (runtime-core.cjs.prod.js) komt de
// eigenschap nul keer voor — zelf gegrepped, niet aangenomen. Deze functie
// heeft tot nu toe alleen tegen `nuxt dev` gedraaid (via login.spec.ts,
// locales.spec.ts, onboarding.spec.ts, invite.spec.ts), waar die voorwaarde
// altijd waar is. Gebruik hem in een e2e/pwa/*-spec — die draait tegen de
// gebouwde app, zie playwright.pwa.config.ts — en je krijgt een schone
// timeout van 30s op een app die prima werkt, geen hydratatieprobleem.
// Playwright's eigen actionability-wachten op .click() is daar het werkende
// alternatief; zie e2e/pwa/manifest.spec.ts voor een voorbeeld dat deze
// functie bewust niet gebruikt.
export async function waitForHydration(
  page: import('@playwright/test').Page,
  selector = 'button[type="submit"]',
) {
  try {
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel)
      return !!el && '__vueParentComponent' in el
    }, selector)
  } catch (cause) {
    throw new Error(
      'Hydratie niet waargenomen binnen de timeout. Deze wacht steunt op de ' +
        'Vue-interne __vueParentComponent; is Vue geüpgraded, controleer dan ' +
        'of die eigenschap nog bestaat (zie e2e/helpers.ts).',
      { cause },
    )
  }
}

export async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  locale: Locale = 'en',
) {
  const t = bundles[locale]

  await page.goto(routePath('login', locale))
  await waitForHydration(page)
  // De echte vertaling in plaats van een regex: zo breekt deze helper niet
  // stil op een taal waarin het woord "email" er anders uitziet, en toont
  // hij meteen aan dat de vertaling ook werkelijk gerenderd wordt.
  await page.getByLabel(t.auth.email).fill(email)
  await page.getByRole('button', { name: t.auth.sendLink }).click()
  await expect(page.getByText(t.auth.linkSent)).toBeVisible()

  const link = await readLatestMagicLink(email)
  await page.goto(link)
  // confirm.vue stuurt pas door zodra de Supabase-client de sessie herkent.
  // `includes` en niet `startsWith`: onder /nl en /fr staat de taalprefix
  // vóór /confirm.
  await page.waitForURL((current) => !current.pathname.includes('/confirm'))
}

/**
 * Maakt een huishouden aan via het onboardingformulier.
 *
 * Bestaat omdat vijf bestaande testgevallen dit met de hand doen en het
 * formulier in Taak 5 een veld erbij krijgt. Die call sites worden daar
 * omgezet; tot dan staat deze helper er alleen voor mobile.spec.ts.
 */
export async function createHousehold(
  page: import('@playwright/test').Page,
  opties: { huishouden: string },
): Promise<void> {
  await page.goto(routePath('onboarding', 'en'))
  await waitForHydration(page)
  await page.getByLabel(bundles.en.onboarding.name).fill(opties.huishouden)
  await page.getByRole('button', { name: bundles.en.onboarding.start }).click()
  await expect(page.getByText(opties.huishouden)).toBeVisible()
}

/** Opent het avatarmenu in de header. Instellingen en uitloggen zitten daarin. */
export async function openUserMenu(
  page: import('@playwright/test').Page,
  locale: Locale = 'en',
): Promise<void> {
  await page.getByRole('button', { name: bundles[locale].nav.account }).click()
}
