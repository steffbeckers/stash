import { localeCodes, routePath, type LocaleCode } from '../../../routes.config'
import en from '../../../i18n/locales/en.json'
import nl from '../../../i18n/locales/nl.json'
import fr from '../../../i18n/locales/fr.json'

// De naam en de tagline komen uit dezelfde vertaalbestanden als de rest van
// de app. Ze hier overtypen zou betekenen dat een aangepaste tagline op twee
// plekken bijgewerkt moet worden, en de tweede wordt vergeten.
const vertalingen = { en, nl, fr }

// Dezelfde waarden als de `language`-velden in de i18n-config van
// nuxt.config.ts. Een manifest verwacht een BCP 47-tag, geen taalcode.
const talen: Record<LocaleCode, string> = {
  en: 'en-GB',
  nl: 'nl-BE',
  fr: 'fr-BE',
}

export default defineEventHandler((event) => {
  const locale = getRouterParam(event, 'locale') as LocaleCode

  if (!localeCodes.includes(locale)) {
    // Bewust setResponseStatus en niet throw createError. Een geworpen fout gaat
    // door Nitro's foutpijplijn, die voor een client die HTML prefereert de
    // SSR-foutpagina rendert — en daar draait de auth-guard van @nuxtjs/supabase
    // opnieuw, die een niet-uitgezonderde route naar /login stuurt. De 404
    // overleeft die reis niet. Normaal terugkeren met een expliciete status komt
    // nooit in die pijplijn terecht.
    setResponseStatus(event, 404)
    return { error: 'Onbekende taal' }
  }

  const bundel = vertalingen[locale]

  setResponseHeader(event, 'content-type', 'application/manifest+json')

  return {
    // Gelijk voor alle drie: zo ziet de browser dit als één app in plaats van
    // als drie aparte installaties.
    id: '/',
    name: bundel.app.name,
    short_name: bundel.app.name,
    description: bundel.app.tagline,
    lang: talen[locale],
    // Mét taalprefix. `prefix_except_default` geeft alleen het Engels een
    // kaal pad; /voorraad zonder /nl ervoor bestaat niet en zou het icoon op
    // een 404 laten openen.
    start_url: routePath('inventory', locale),
    // De app loopt over /, /nl/* en /fr/*, dus de scope is de wortel.
    scope: '/',
    display: 'standalone',
    theme_color: '#18181b',
    // Dit is de kleur van het opstartscherm. De app opent licht, dus wit —
    // anders zie je bij elke start een zwarte flits.
    background_color: '#ffffff',
    icons: [
      { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
})
