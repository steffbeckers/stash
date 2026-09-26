<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { create } = useHousehold()
const { profile, refresh, save } = useProfile()

const name = ref('')
const voornaam = ref('')
const pending = ref(false)
const error = ref('')

try {
  await refresh()
  voornaam.value = profile.value?.displayName ?? ''
} catch {
  // Geen naam kunnen ophalen is geen reden om het formulier te blokkeren;
  // het veld begint dan gewoon leeg.
}

async function start() {
  pending.value = true
  error.value = ''
  try {
    // De volgorde is hier een correctheidskwestie, geen smaak. Slaagt het
    // huishouden terwijl de naam faalt, dan zit de gebruiker naamloos in een
    // huishouden en maakt een tweede poging een TWEEDE huishouden aan.
    // Andersom is een mislukking veilig: het profiel opslaan is idempotent.
    await save(voornaam.value)
    await create(name.value)
    await navigateTo(localePath('inventory'))
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
        <UFormField :label="t('onboarding.firstName')" name="firstName">
          <UInput v-model="voornaam" required :maxlength="60" class="w-full" />
        </UFormField>

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
