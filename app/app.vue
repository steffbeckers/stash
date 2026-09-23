<script setup lang="ts">
// Bevinding 6 van de eindreview van plan 1: er was geen enkele manier om als
// ingelogde gebruiker bij /settings/household, /settings/places te komen of
// uit te loggen — de e2e-tests bereikten ze rechtstreeks met page.goto(). Dit
// is de root-layout (elke route gaat hier doorheen), dus de navigatie hoort
// hier thuis en wordt met v-if="user" verborgen op publieke pagina's.
const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const supabase = useSupabaseClient()

const navItems = computed(() => [
  { label: t('nav.inventory'), to: localePath('/app') },
  { label: t('nav.settings'), to: localePath('/settings/household') },
])

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo(localePath('/'))
}
</script>

<template>
  <UApp>
    <header v-if="user" class="border-b border-muted">
      <UContainer class="flex h-14 items-center justify-between gap-4">
        <NuxtLink :to="localePath('/app')" class="shrink-0 font-bold">
          {{ t('app.name') }}
        </NuxtLink>
        <UNavigationMenu :items="navItems" class="flex-1" />
        <UButton
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
  </UApp>
</template>
