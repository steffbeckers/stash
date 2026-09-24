<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { activeId, refresh } = useHousehold()

const ready = ref(false)
const failed = ref(false)

onMounted(async () => {
  try {
    await refresh()
  } catch {
    failed.value = true
    return
  }
  ready.value = true
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ t('householdSettings.title') }}</h1>
      <UButton variant="link" :to="localePath('/settings/places')">
        {{ t('places.title') }}
      </UButton>
    </div>

    <section class="mt-8">
      <h2 class="mb-3 font-semibold">{{ t('householdSettings.members') }}</h2>
      <UAlert v-if="failed" color="error" :description="t('householdSettings.error')" />
      <UProgress v-else-if="!ready" animation="carousel" />
      <HouseholdMembers v-else-if="activeId" :household-id="activeId" />
    </section>

    <section class="mt-8">
      <h2 class="mb-3 font-semibold">{{ t('householdSettings.invitations') }}</h2>
      <UAlert v-if="failed" color="error" :description="t('householdSettings.error')" />
      <UProgress v-else-if="!ready" animation="carousel" />
      <HouseholdInvites v-else-if="activeId" :household-id="activeId" />
    </section>
  </UContainer>
</template>
