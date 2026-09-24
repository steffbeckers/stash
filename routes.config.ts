/**
 * De routevertalingen, op één plek.
 *
 * Zowel `nuxt.config.ts` als de end-to-endtests lezen hieruit. Dat is geen
 * netheid maar noodzaak: uit deze kaart volgt ook de `exclude`-lijst van
 * @nuxtjs/supabase, die bepaalt welke pagina's zonder inloggen bereikbaar
 * zijn. Staat een publieke route daar niet in, dan eist een openbare pagina
 * plots een login — en breekt bijvoorbeeld de uitnodigingsflow. Staat er per
 * ongeluk een afgeschermde route in, dan ligt die open.
 *
 * Voordat dit bestand bestond stonden die paden met de hand in drie lijsten:
 * de i18n-config, de exclude-lijst en de tests. Bij drie talen en zeven routes
 * is dat een kwestie van tijd.
 */

export const defaultLocale = 'en'
export const localeCodes = ['en', 'nl', 'fr'] as const

export type LocaleCode = (typeof localeCodes)[number]

/**
 * De sleutel is het paginabestand onder `app/pages` zonder extensie — dat is
 * wat de `pages`-optie van @nuxtjs/i18n verwacht.
 *
 * Let op bij het gebruik in componenten: met `customRoutes: 'config'` bestaat
 * het oorspronkelijke pad niet meer als route. `localePath('/inventory')`
 * levert een dood pad op; gebruik de routenaam, dus `localePath('inventory')`
 * of `localePath('settings-household')`.
 */
export const routePaths = {
  'inventory': { en: '/inventory', nl: '/voorraad', fr: '/stock' },
  'onboarding': { en: '/get-started', nl: '/aan-de-slag', fr: '/bienvenue' },
  'settings/household': {
    en: '/settings/household',
    nl: '/instellingen/huishouden',
    fr: '/parametres/menage',
  },
  'settings/places': {
    en: '/settings/places',
    nl: '/instellingen/bewaarplaatsen',
    fr: '/parametres/rangements',
  },
  'login': { en: '/login', nl: '/inloggen', fr: '/connexion' },
  'confirm': { en: '/confirm', nl: '/bevestigen', fr: '/confirmation' },
  'invite/[token]': {
    en: '/invite/[token]',
    nl: '/uitnodiging/[token]',
    fr: '/invitation/[token]',
  },
  // De paden houden hun letterlijke type: @nuxtjs/i18n's `pages`-optie eist
  // `/${string}`, en een verbreding naar `string` is daar niet aan toe te
  // wijzen.
} satisfies Record<string, Record<LocaleCode, `/${string}`>>

export type RouteKey = keyof typeof routePaths

/** Routes die zonder inloggen bereikbaar moeten zijn. De rest is afgeschermd. */
export const publicRoutes = ['login', 'confirm', 'invite/[token]'] as const

/** Het URL-pad van een route in één taal, zoals de browser het ziet. */
export function routePath(
  route: RouteKey,
  locale: LocaleCode,
  params: Record<string, string> = {},
): string {
  const prefix = locale === defaultLocale ? '' : `/${locale}`
  let path: string = routePaths[route][locale]
  for (const [naam, waarde] of Object.entries(params)) {
    path = path.replace(`[${naam}]`, waarde)
  }
  return prefix + path
}

/** Dezelfde route, maar met `*` waar een parameter staat: @nuxtjs/supabase matcht met globs. */
export function routeGlob(route: RouteKey, locale: LocaleCode): string {
  return routePath(route, locale).replace(/\[\w+\]/g, '*')
}

/** De exclude-lijst wordt afgeleid, niet met de hand bijgehouden. */
export const supabaseExclude: string[] = [
  '/',
  ...localeCodes.filter((code) => code !== defaultLocale).map((code) => `/${code}`),
  ...publicRoutes.flatMap((route) => localeCodes.map((code) => routeGlob(route, code))),
]
