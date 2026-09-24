<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()

// Dagelijkse gebruikers horen de uitlegpagina niet elke keer te zien.
// Een getter, geen kale string: useRedirectWhenSignedIn() roept toValue() aan
// bij elke keer dat de watcher vuurt, dus dit moet localePath('/app') telkens
// opnieuw evalueren in plaats van hem één keer bij setup te bevriezen.
useRedirectWhenSignedIn(() => localePath('/app'))
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
