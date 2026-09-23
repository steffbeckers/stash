<script setup lang="ts">
const { t } = useI18n()
const { activeId, refresh } = useHousehold()

const ready = ref(false)

onMounted(async () => {
  await refresh()
  ready.value = true
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <h1 class="text-2xl font-bold">{{ t('householdSettings.title') }}</h1>

    <section class="mt-8">
      <h2 class="mb-3 font-semibold">{{ t('householdSettings.invitations') }}</h2>
      <UProgress v-if="!ready" animation="carousel" />
      <HouseholdInvites v-else-if="activeId" :household-id="activeId" />
    </section>
  </UContainer>
</template>
