<script setup lang="ts">
// Uit app.vue gehaald: dat bestand beheerde de PWA-head-tags én de
// navigatie én het uitloggen. Met een avatarmenu erbij was dat richting de
// 150 regels gegaan.
const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const { refresh } = useProfile()

// Tijdens SSR, niet in onMounted: de avatar toont initialen uit dit profiel
// en zou anders bij elke volledige paginalading van icoon naar letters
// springen. De sessie is server-side bekend, dus dit werkt.
//
// Mislukt het, dan blijft profile null en valt de avatar terug op het icoon.
// Dat is de juiste afloop: een header die weigert te renderen omdat een naam
// niet op te halen was, zou de hele app onbruikbaar maken.
if (user.value) {
  try {
    await refresh()
  } catch {
    // Bewust stil: zie hierboven. De avatar heeft een werkende terugval.
  }
}

// Alleen inhoudelijke routes. Instellingen en uitloggen zitten in het
// avatarmenu — dat is het gangbare patroon, en het is de ruimte die de
// header op 360px in het Frans overeind houdt. Gemeten: mét "Paramètres"
// hier bleef er 16px over, zonder ruim 100px. De catalogus komt hier straks
// bij.
const navItems = computed(() => [
  { label: t('nav.inventory'), to: localePath('inventory') },
])
</script>

<template>
  <header class="border-b border-muted">
    <UContainer class="flex h-14 items-center gap-3">
      <NuxtLink :to="localePath('index')" class="shrink-0 font-bold">
        {{ t('app.name') }}
      </NuxtLink>

      <UNavigationMenu v-if="user" :items="navItems" class="flex-1" />

      <!-- De taalschakelaar blijft staan voor wie niet ingelogd is, op álle
           publieke pagina's en niet alleen de landingspagina: wie via
           /invite/<token> binnenkomt krijgt de taal van de afzender en heeft
           geen andere weg terug. Zie LanguageSwitcher.vue en
           e2e/locales.spec.ts. Ingelogd staat dezelfde component op de
           profielpagina. -->
      <LanguageSwitcher v-if="!user" class="ml-auto" />
      <UserMenu v-else class="ml-auto" />
    </UContainer>
  </header>
</template>
