<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { households, activeId, refresh } = useHousehold()

const ready = ref(false)
const failed = ref(false)

onMounted(async () => {
  try {
    await refresh()
  } catch {
    failed.value = true
    return
  }
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
    <UAlert v-if="failed" color="error" :description="t('householdSettings.error')" />
    <UProgress v-else-if="!ready" animation="carousel" />
    <template v-else>
      <h1 class="text-3xl font-bold">{{ t('appHome.title') }}</h1>
      <p class="mt-2 text-lg text-muted">{{ active?.name }}</p>
    </template>
  </UContainer>
</template>
