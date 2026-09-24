import { defaultLocale, routePaths, routePath, supabaseExclude } from './routes.config'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-21',
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/i18n', '@nuxtjs/supabase', 'nitro-cloudflare-dev'],
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
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  runtimeConfig: {
    public: {
      appVersion: process.env.NUXT_PUBLIC_APP_VERSION || 'dev',
    },
  },
})
