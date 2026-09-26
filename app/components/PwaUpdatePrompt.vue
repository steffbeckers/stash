<script setup lang="ts">
// registerType: 'prompt' in nuxt.config.ts zorgt dat een nieuwe service
// worker blijft wachten tot iemand hem binnenlaat. needRefresh wordt waar
// zodra die nieuwe versie klaarstaat.
//
// Waarom niet 'autoUpdate': elke merge naar main deployt, dus updates komen
// vaak, en automatisch herladen zou dat kunnen doen terwijl iemand een
// huishoudnaam of een uitnodiging staat in te vullen. 'prompt' voorkomt dat
// — maar alleen totdat er ergens geklikt wordt. Het isoleert geen tabbladen:
// skipWaiting() geldt registratiebreed, en de herlaad-listener die
// vite-plugin-pwa daarna opzet hangt aan het controlling-event — dat vuurt
// voor elke client die de browser op dat moment als gecontroleerd beschouwt,
// niet specifiek voor de tabbladen die deze melding toonden (volledige
// toelichting in app/sw.ts, bij de SKIP_WAITING-listener). Geaccepteerd,
// want een tabblad dat op de oude versie blijft hangen draait tegen een
// precache waar PrecacheController.activate() de entries van de vorige
// build net uit heeft verwijderd — niet cleanupOutdatedCaches(), zie
// app/sw.ts voor het onderscheid.
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
  <!-- Een losse, altijd aanwezige live region — niet de zichtbare banner
       hieronder. role="status" + aria-live="polite" moeten al in de DOM
       staan vóórdat de inhoud verschijnt, anders is er nooit een "voor"
       waarin een schermlezer dit element als live region heeft leren kennen.
       Zet je in plaats daarvan de hele banner achter v-if (zoals hieronder,
       maar dan mét deze twee attributen erbij), dan ontstaan het element én
       zijn inhoud in dezelfde slag — precies de situatie waarin de melding
       niet wordt aangekondigd. Vandaar dit element apart: het bestaat vanaf
       de eerste render, en alleen zijn tekstinhoud wisselt. sr-only, want
       hij is uitsluitend voor schermlezers — de zichtbare tekst staat al in
       de banner hieronder, die zelf geen aria-live meer draagt (dat zou de
       melding dubbel laten voorlezen). role="status" impliceert
       aria-live="polite" al; toch allebei, vriendelijker voor oudere
       hulptechnologie. -->
  <div role="status" aria-live="polite" class="sr-only">
    {{ pwa?.needRefresh ? t('pwa.updateAvailable') : '' }}
  </div>

  <div
    v-if="pwa?.needRefresh"
    class="fixed inset-x-0 bottom-0 z-50 border-t border-muted bg-default p-4"
  >
    <UContainer class="flex items-center justify-between gap-4">
      <p>{{ t('pwa.updateAvailable') }}</p>
      <div class="flex items-center gap-2">
        <UButton size="sm" @click="pwa?.updateServiceWorker(true)">
          {{ t('pwa.reload') }}
        </UButton>
        <!-- cancelPrompt() (usePWA(), @vite-pwa/nuxt) zet needRefresh terug
             op false zonder te herladen — de update blijft klaarstaan voor de
             eerstvolgende gelegenheid. Zonder deze knop blijft de banner de
             onderkant van elke pagina permanent afdekken, inclusief de
             submit-knoppen van precies de half ingevulde formulieren die
             registerType: 'prompt' moest beschermen. -->
        <UButton size="sm" variant="ghost" color="neutral" @click="pwa?.cancelPrompt()">
          {{ t('pwa.dismiss') }}
        </UButton>
      </div>
    </UContainer>
  </div>
</template>
