<script setup lang="ts">
const route = useRoute()
const localePath = useLocalePath()

// Alleen interne paden. Zie app/utils/safe-redirect.ts voor waarom een
// handgeschreven prefixcontrole hier niet volstaat.
const redirectTo = computed(() => safeInternalPath(route.query.redirect))

const { t } = useI18n()
const supabase = useSupabaseClient()

const email = ref('')
const sent = ref(false)
const error = ref('')
const pending = ref(false)

async function submit() {
  pending.value = true
  error.value = ''
  // localePath('confirm'), niet de kale string: zonder taalprefix wijst de
  // magic link altijd naar het Engelse /confirm, en verliest de gebruiker
  // zijn taalkeuze zodra hij op de link in de e-mail klikt. confirm.vue kan
  // die taal daarna niet meer terugvinden — localePath('inventory') resolveert
  // daar tegen de (dan al taalloze) route waarop de e-mail is beland.
  const target = new URL(localePath('confirm'), window.location.origin)
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
