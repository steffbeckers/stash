<script setup lang="ts">
import { manifestPath, type LocaleCode } from '~~/routes.config'

const { locale } = useI18n()

// Eén <link rel="manifest">, maar wel naar het manifest van de taal die je nu
// ziet. Installeer je vanuit het Nederlands, dan opent het icoon straks
// /nl/voorraad en niet de Engelse pagina.
//
// locale.value komt van useI18n() en is daar niet sterker getypeerd dan
// Locales (in de praktijk string); dezelfde cast als app/pages/login.vue.
// nuxt.config.ts's i18n.locales garandeert dat de waarde altijd een van de
// drie geconfigureerde talen is.
//
// apple-touch-icon en theme-color staan hier met opzet met de hand, niet via
// pwa.pwaAssets (nuxt.config.ts): die module-optie staat uit, en dit is de
// enige plek die al head-tags voor de PWA beheert (de manifest-link
// hierboven). Eén plek verantwoordelijk houden voor head-tags weegt hier
// zwaarder dan de module een tweede, overlappende set laten genereren die
// vervolgens met manifest: false verzoend zou moeten worden. Zie spec §6 voor
// de apple-touch-icon-belofte en §5 voor theme_color (#18181b, gelijk aan wat
// de manifesten al voeren).
useHead({
  link: [
    { rel: 'manifest', href: () => manifestPath(locale.value as LocaleCode) },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' },
  ],
  meta: [{ name: 'theme-color', content: '#18181b' }],
})
</script>

<template>
  <UApp>
    <AppHeader />
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <PwaUpdatePrompt />
  </UApp>
</template>
