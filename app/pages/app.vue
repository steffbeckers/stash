<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { households, activeId, refresh } = useHousehold()

const ready = ref(false)

// In onMounted, niet op top-level await: activeId komt uit localStorage en is
// tijdens SSR altijd null. Doorsturen hoort ook een clientbeslissing te zijn,
// anders stuurt de server iemand weg op basis van halve informatie.
onMounted(async () => {
  await refresh()
  if (households.value.length === 0) {
    await navigateTo(localePath('/onboarding'))
    return
  }
  ready.value = true
})

const active = computed(() => households.value.find((h) => h.id === activeId.value))
</script>

<template>
  <UContainer class="py-12">
    <UProgress v-if="!ready" animation="carousel" />
    <template v-else>
      <h1 class="text-3xl font-bold">{{ t('app.name') }}</h1>
      <p class="mt-2 text-lg text-muted">{{ active?.name }}</p>
    </template>
  </UContainer>
</template>
