import { defaultLocale, routePaths, routePath, supabaseExclude } from './routes.config'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-21',
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/i18n', '@nuxtjs/supabase', 'nitro-cloudflare-dev', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  i18n: {
    defaultLocale,
    strategy: 'prefix_except_default',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'stash_locale',
      redirectOn: 'root',
    },
    locales: [
      { code: 'en', language: 'en-GB', file: 'en.json', name: 'English' },
      { code: 'nl', language: 'nl-BE', file: 'nl.json', name: 'Nederlands' },
      { code: 'fr', language: 'fr-BE', file: 'fr.json', name: 'Français' },
    ],
    // De routes zelf zijn ook vertaald: /inventory, /nl/voorraad, /fr/stock.
    // Zie routes.config.ts — daar staat ook waarom localePath() vanaf nu een
    // routenaam wil in plaats van een pad.
    customRoutes: 'config',
    pages: routePaths,
  },
  supabase: {
    redirect: true,
    redirectOptions: {
      login: routePath('login', defaultLocale),
      callback: routePath('confirm', defaultLocale),
      exclude: supabaseExclude,
    },
  },
  pwa: {
    strategies: 'injectManifest',
    // Niet 'app': deze module zoekt `${srcDir}/${filename}` op t.o.v. Vite's
    // eigen root, en Nuxt 4 stelt die root al in op nuxt.options.srcDir
    // ('app' — zie de nieuwe mapstructuur, app/pages, app/components, enz.).
    // 'app' hier nog eens toevoegen liet de build zoeken naar
    // app/app/sw.ts en de foutmelding zei dat vrijwel letterlijk
    // ("Cannot resolve entry module app/app/sw.ts"). sw.ts staat direct in
    // die root, dus '.'.
    srcDir: '.',
    filename: 'sw.ts',
    // 'prompt' en niet 'autoUpdate': de gebruiker bevestigt zelf. Elke merge
    // naar main deployt, dus updates komen vaak; automatisch herladen zou
    // dat onder een half ingevuld formulier vandaan doen.
    registerType: 'prompt',
    // Het manifest komt uit een eigen Nitro-route, één per taal (Taak 5).
    // De module mag er zelf geen genereren, anders staan er twee
    // <link rel="manifest"> in de head en wint de verkeerde.
    manifest: false,
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
    },
    devOptions: {
      // De standaard navigateFallbackAllowlist van deze module is /\//, wat
      // elk pad met een schuine streep matcht (vite-pwa/nuxt#139). Voor een
      // SSR-app onderschept dat alles. De PWA-tests draaien sowieso tegen de
      // gebouwde app, dus in dev hoeft de worker helemaal niet mee te doen.
      enabled: false,
    },
  },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  routeRules: {
    // sw.js is niet gehasht: elke build levert dezelfde bestandsnaam. Zonder
    // korte cache-header blijft een oude worker uren in omloop, en dan
    // draait de gebruiker een oude schil terwijl /api/health keurig de
    // nieuwe SHA meldt.
    '/sw.js': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
  },
  runtimeConfig: {
    public: {
      appVersion: process.env.NUXT_PUBLIC_APP_VERSION || 'dev',
    },
  },
})
