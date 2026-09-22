export default defineNuxtConfig({
  compatibilityDate: '2026-09-21',
  modules: ['@nuxt/ui', '@nuxtjs/i18n', 'nitro-cloudflare-dev'],
  css: ['~/assets/css/main.css'],
  i18n: {
    defaultLocale: 'en',
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
