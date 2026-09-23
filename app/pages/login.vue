<script setup lang="ts">
const route = useRoute()

// Alleen interne paden. Zonder deze controle kan iemand
// ?redirect=https://kwaadaardig.example in een link zetten en jouw inlogpagina
// gebruiken om mensen naar een phishingsite te sturen.
const redirectTo = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null
})

const { t } = useI18n()
const supabase = useSupabaseClient()

const email = ref('')
const sent = ref(false)
const error = ref('')
const pending = ref(false)

async function submit() {
  pending.value = true
  error.value = ''
  const target = new URL('/confirm', window.location.origin)
  if (redirectTo.value) target.searchParams.set('redirect', redirectTo.value)

  const { error: authError } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: { emailRedirectTo: target.toString() },
  })
  pending.value = false
  if (authError) {
    error.value = t('auth.error')
    return
  }
  sent.value = true
}
</script>

<template>
  <UContainer class="max-w-md py-12">
    <h1 class="text-2xl font-bold">{{ t('auth.signIn') }}</h1>

    <UAlert v-if="sent" class="mt-6" color="success" :description="t('auth.linkSent')" />

    <form v-else class="mt-6 space-y-4" @submit.prevent="submit">
      <UFormField :label="t('auth.email')" name="email">
        <UInput v-model="email" type="email" required autocomplete="email" class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="error" :description="error" />

      <UButton type="submit" :loading="pending" block>
        {{ t('auth.sendLink') }}
      </UButton>
    </form>
  </UContainer>
</template>
