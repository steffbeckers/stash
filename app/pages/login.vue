<script setup lang="ts">
import { localeCodes, type LocaleCode } from '~~/routes.config'

const route = useRoute()
const localePath = useLocalePath()

// Alleen interne paden. Zie app/utils/safe-redirect.ts voor waarom een
// handgeschreven prefixcontrole hier niet volstaat.
const redirectTo = computed(() => safeInternalPath(route.query.redirect))

const { t, locale, setLocale } = useI18n()
const supabase = useSupabaseClient()

// De auth-guard van @nuxtjs/supabase stuurt altijd naar het kale /login:
// redirectOptions.login is één vaste string en kan de taal niet weten. Wie de
// app in het Nederlands gebruikt en uitgelogd op zijn startscherm-icoon tikt,
// belandt dus op een Engelse inlogpagina.
//
// De taalkeuze staat al in de cookie die detectBrowserLanguage zet
// (cookieKey 'stash_locale' in nuxt.config.ts). Die volgen we hier alsnog.
//
// Niet gekozen: de redirect van @nuxtjs/supabase helemaal vervangen door
// eigen auth-middleware. Dat lost hetzelfde op maar raakt elke afgeschermde
// route in de app.
const gekozenTaal = useCookie<string | null>('stash_locale')

// setLocale() van @nuxtjs/i18n, niet handmatig navigateTo(localePath(...)):
// detectBrowserLanguage (useCookie: true) herschrijft bij elke serveraanvraag
// de cookie naar de taal van de huidige route, vóórdat deze pagina rendert.
// Een handmatige navigateTo() botst daarmee — de doelpagina's eigen aanvraag
// laat detectBrowserLanguage de cookie álweer terugzetten, en dat kaatst
// oneindig heen en weer (bevestigd met curl: /login en /nl/inloggen wijzen
// om beurten naar elkaar, ERR_TOO_MANY_REDIRECTS). setLocale() werkt wel: het
// schrijft dezelfde cookie die detectBrowserLanguage net zette opnieuw, naar
// dezelfde taal die we hier al kozen, dus er verandert niets meer op de
// volgende aanvraag.
if (
  gekozenTaal.value
  && gekozenTaal.value !== locale.value
  && localeCodes.includes(gekozenTaal.value as LocaleCode)
) {
  await setLocale(gekozenTaal.value as LocaleCode)
}

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
