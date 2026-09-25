<script setup lang="ts">
// Geen data, geen auth, geen netwerk. Deze pagina moet te tonen zijn als er
// niets meer werkt, dus alles wat ze nodig heeft zit in de geprerenderde
// HTML en in de geprecachte assets.
const { t } = useI18n()

function opnieuw() {
  window.location.reload()
}
</script>

<template>
  <UContainer class="py-16 text-center">
    <h1 class="text-3xl font-bold">{{ t('offline.title') }}</h1>
    <p class="mt-3 text-lg text-muted">{{ t('offline.body') }}</p>
    <UButton class="mt-8" size="lg" @click="opnieuw">
      {{ t('offline.retry') }}
    </UButton>
  </UContainer>
</template>
