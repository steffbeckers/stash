<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()

// Dagelijkse gebruikers horen de uitlegpagina niet elke keer te zien.
useRedirectWhenSignedIn(localePath('/app'))
</script>

<template>
  <UContainer class="py-16 text-center">
    <h1 class="text-4xl font-bold">{{ t('app.name') }}</h1>
    <p class="mt-3 text-lg text-muted">{{ t('app.tagline') }}</p>
    <UButton class="mt-8" size="lg" :to="localePath('/login')">
      {{ t('landing.getStarted') }}
    </UButton>
  </UContainer>
</template>
