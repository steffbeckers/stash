<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()

// Deze pagina stuurde een ingelogde bezoeker meteen door naar /app, zodat je
// je eigen uitlegpagina niet meer kon bekijken zodra je een account had.
// Nu blijf je gewoon staan en verandert alleen de knop.
</script>

<template>
  <UContainer class="py-16 text-center">
    <h1 class="text-4xl font-bold">{{ t('app.name') }}</h1>
    <p class="mt-3 text-lg text-muted">{{ t('app.tagline') }}</p>
    <UButton v-if="user" class="mt-8" size="lg" :to="localePath('inventory')">
      {{ t('landing.goToApp') }}
    </UButton>
    <UButton v-else class="mt-8" size="lg" :to="localePath('login')">
      {{ t('landing.getStarted') }}
    </UButton>
  </UContainer>
</template>
