<script setup lang="ts">
const { t } = useI18n()
const { profile, refresh, save } = useProfile()

const naam = ref('')
const pending = ref(false)
const saved = ref(false)
const error = ref('')

// Tijdens SSR is het profiel er al (zie useProfile). Deze await vult het
// invoerveld dus met een waarde die ook in de server-HTML staat.
try {
  await refresh()
  naam.value = profile.value?.displayName ?? ''
} catch {
  error.value = t('householdSettings.error')
}

async function opslaan() {
  pending.value = true
  error.value = ''
  saved.value = false
  try {
    await save(naam.value)
    saved.value = true
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <SettingsTabs />
    <h1 class="text-2xl font-bold">{{ t('profile.title') }}</h1>

    <form class="mt-6 space-y-4" @submit.prevent="opslaan">
      <UFormField :label="t('profile.name')" :help="t('profile.nameHelp')" name="name">
        <!-- maxlength 60, gelijk aan de check-constraint display_name_length.
             Het formulier is het gemak; de constraint is de echte grens. -->
        <UInput v-model="naam" :maxlength="60" class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="error" :description="error" />
      <UAlert v-else-if="saved" color="success" :description="t('profile.saved')" />

      <UButton type="submit" :loading="pending">{{ t('profile.save') }}</UButton>
    </form>

    <!-- De taalkeuze hoort hier: ze is een persoonlijke voorkeur, net als je
         naam, en ze is uit de header verdwenen zodra je ingelogd bent. Voor
         uitgelogde bezoekers staat dezelfde component nog wél in de header —
         zie AppHeader.vue en de reden in LanguageSwitcher.vue. -->
    <section class="mt-10">
      <h2 class="mb-3 font-semibold">{{ t('nav.language') }}</h2>
      <LanguageSwitcher />
    </section>
  </UContainer>
</template>
