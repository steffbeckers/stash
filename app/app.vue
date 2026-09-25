<script setup lang="ts">
// Bevinding 6 van de eindreview van plan 1: er was geen enkele manier om als
// ingelogde gebruiker bij /settings/household, /settings/places te komen of
// uit te loggen — de e2e-tests bereikten ze rechtstreeks met page.goto(). Dit
// is de root-layout (elke route gaat hier doorheen), dus de navigatie hoort
// hier thuis en wordt met v-if="user" verborgen op publieke pagina's.
const { t, locale } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const supabase = useSupabaseClient()

const navItems = computed(() => [
  { label: t('nav.inventory'), to: localePath('inventory') },
  { label: t('nav.settings'), to: localePath('settings-household') },
])

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo(localePath('index'))
}

// Eén <link rel="manifest">, maar wel naar het manifest van de taal die je nu
// ziet. Installeer je vanuit het Nederlands, dan opent het icoon straks
// /nl/voorraad en niet de Engelse pagina.
useHead({
  link: [{ rel: 'manifest', href: () => `/manifest/${locale.value}` }],
})
</script>

<template>
  <UApp>
    <!-- De header rendert altijd, ook uitgelogd: de taalschakelaar hoort
         bereikbaar te zijn op de landingspagina, de inlogpagina en vooral op
         /invite/<token>, waar een genodigde binnenkomt in de taal van de
         afzender. De navigatie en de uitlogknop blijven wel achter `user`. -->
    <header class="border-b border-muted">
      <UContainer class="flex h-14 items-center gap-4">
        <!-- De merknaam staat er altijd en wijst naar de landingspagina, ook
             ingelogd: die pagina is sinds kort weer bereikbaar en dit is de
             enige weg erheen zonder de URL te typen. -->
        <NuxtLink :to="localePath('index')" class="shrink-0 font-bold">
          {{ t('app.name') }}
        </NuxtLink>
        <UNavigationMenu v-if="user" :items="navItems" class="flex-1" />
        <LanguageSwitcher class="ml-auto" />
        <UButton
          v-if="user"
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-lucide-log-out"
          @click="signOut"
        >
          {{ t('auth.signOut') }}
        </UButton>
      </UContainer>
    </header>
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <PwaUpdatePrompt />
  </UApp>
</template>
