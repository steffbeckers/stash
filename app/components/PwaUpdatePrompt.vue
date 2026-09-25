<script setup lang="ts">
// registerType: 'prompt' in nuxt.config.ts zorgt dat een nieuwe service
// worker blijft wachten tot iemand hem binnenlaat. needRefresh wordt waar
// zodra die nieuwe versie klaarstaat.
//
// Waarom niet 'autoUpdate': elke merge naar main deployt, dus updates komen
// vaak. Automatisch herladen zou dat kunnen doen terwijl iemand een
// huishoudnaam of een uitnodiging staat in te vullen.
//
// De planbrief noemt useRegisterSW(), maar die composable bestaat niet in de
// geïnstalleerde @vite-pwa/nuxt (1.1.1). De module importeert die zelf uit
// virtual:pwa-register/vue en injecteert het resultaat als $pwa; de enige
// composable die de module aan Nuxt's auto-import toevoegt is usePWA() (zie
// de addImports-aanroep in node_modules/@vite-pwa/nuxt/dist/shared/nuxt.*.mjs
// — usePWA staat erin, useRegisterSW niet).
//
// Bewust niet destructureren tot losse velden. usePWA() geeft geen losse refs
// terug maar één reactive()-object ($pwa uit de plugin). `const { needRefresh
// } = usePWA()` zou de waarde van dít moment — bij het opzetten van het
// component altijd false — in een gewone, niet-reactieve variabele vastzetten;
// de melding zou daarna nooit meer verschijnen, ook niet bij een echte update.
// pwa?.needRefresh in de template leest bij elke render opnieuw door de
// reactive-proxy heen en blijft dus wel volgen.
//
// usePWA() kan undefined zijn: de plugin die $pwa levert heet pwa.client.js
// en draait niet tijdens SSR. Zonder de ?. hieronder crasht elke
// server-render van app.vue op het uitpakken van een undefined waarde.
const pwa = usePWA()
const { t } = useI18n()
</script>

<template>
  <!-- role="status" + aria-live="polite": deze melding verschijnt zonder dat
       iemand er iets voor doet. Zonder deze twee blijft een schermlezer stil
       tot iemand toevallig met de tab-toets langs de knop komt. -->
  <div
    v-if="pwa?.needRefresh"
    role="status"
    aria-live="polite"
    class="fixed inset-x-0 bottom-0 z-50 border-t border-muted bg-default p-4"
  >
    <UContainer class="flex items-center justify-between gap-4">
      <p>{{ t('pwa.updateAvailable') }}</p>
      <UButton size="sm" @click="pwa?.updateServiceWorker(true)">
        {{ t('pwa.reload') }}
      </UButton>
    </UContainer>
  </div>
</template>
