<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { create } = useHousehold()

const name = ref('')
const pending = ref(false)
const error = ref('')

async function start() {
  pending.value = true
  error.value = ''
  try {
    await create(name.value)
    await navigateTo(localePath('/app'))
  } catch {
    error.value = t('auth.error')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-md py-12">
    <h1 class="text-2xl font-bold">{{ t('onboarding.title') }}</h1>

    <UCard class="mt-6">
      <template #header>
        <h2 class="font-semibold">{{ t('onboarding.startTitle') }}</h2>
      </template>

      <p class="text-sm text-muted">{{ t('onboarding.startHelp') }}</p>

      <form class="mt-4 space-y-4" @submit.prevent="start">
        <UFormField :label="t('onboarding.name')" name="name">
          <UInput v-model="name" required class="w-full" />
        </UFormField>

        <UAlert v-if="error" color="error" :description="error" />

        <UButton type="submit" :loading="pending" block>
          {{ t('onboarding.start') }}
        </UButton>
      </form>
    </UCard>

    <UCard class="mt-4">
      <template #header>
        <h2 class="font-semibold">{{ t('onboarding.joinTitle') }}</h2>
      </template>
      <p class="text-sm text-muted">{{ t('onboarding.joinHelp') }}</p>
    </UCard>
  </UContainer>
</template>
