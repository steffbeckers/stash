<script setup lang="ts">
// Dit is bewust een component en geen Nuxt-layout. Een layout is netter,
// maar vereist dat app.vue zijn <NuxtPage /> in <NuxtLayout> wikkelt, en dat
// verandert de renderboom van élke pagina — inclusief de geprerenderde
// offline-pagina die met de hand in de precache is nageteld. Drie pagina's
// zijn die app-brede ingreep niet waard. Komt er een vierde bij, dan is de
// promotie naar een layout mechanisch werk.
const { t } = useI18n()
const localePath = useLocalePath()

// De labels hergebruiken de bestaande sleutels van de pagina's zelf, zodat
// een hernoemde pagina niet op twee plekken hoeft te veranderen.
const items = computed(() => [
  { label: t('profile.title'), to: localePath('settings-profile') },
  { label: t('householdSettings.title'), to: localePath('settings-household') },
  { label: t('places.title'), to: localePath('settings-places') },
])
</script>

<template>
  <!-- overflow-x-auto op de wikkel, w-max op het menu: "Profiel /
       Huishouden / Bewaarplaatsen" is in het Nederlands al krap op 360px, en
       de volgende taal die erbij komt valt niet vooraf te meten. Een
       tabstrip die horizontaal schuift is op mobiel normaal.

       Let op wat dit betekent voor e2e/mobile.spec.ts: schuift de strip
       bínnen deze wikkel, dan is er geen page-overflow en blijft de veegtest
       groen. Dat is de bedoelde uitkomst en geen ontsnapping — maar het is
       precies de vorm waarin "groen bewijst niets" zich in dit project al
       veertien keer heeft voorgedaan, dus het staat hier genoteerd. -->
  <div class="mb-6 overflow-x-auto">
    <UNavigationMenu :items="items" class="w-max" />
  </div>
</template>
