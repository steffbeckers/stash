<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { profile } = useProfile()

const letters = computed(() => initials(profile.value?.displayName))

// Valt terug op het e-mailadres zolang er geen naam is. useSupabaseUser()
// geeft het JWT-payload, en `email` is daar een standaardclaim.
const naam = computed(() => profile.value?.displayName || user.value?.email || '')

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo(localePath('index'))
}

// `type: 'label'` en `onSelect` zijn geverifieerd tegen DropdownMenuItem in
// node_modules/@nuxt/ui/dist/runtime/components/DropdownMenu.d.vue.ts.
const items = computed<DropdownMenuItem[][]>(() => [
  [{ label: naam.value, type: 'label' }],
  [
    {
      label: t('nav.settings'),
      icon: 'i-lucide-settings',
      to: localePath('settings-profile'),
    },
    {
      label: t('auth.signOut'),
      icon: 'i-lucide-log-out',
      onSelect: () => { void signOut() },
    },
  ],
])
</script>

<template>
  <UDropdownMenu :items="items" :ui="{ content: 'w-52' }">
    <UButton :aria-label="t('nav.account')" variant="ghost" color="neutral" class="p-0">
      <!-- Geen naam betekent geen letters: dan een icoon in plaats van een
           lege cirkel. Zie initials() in app/utils/initials.ts. -->
      <UAvatar
        size="sm"
        :text="letters ?? undefined"
        :icon="letters ? undefined : 'i-lucide-user'"
        :alt="naam"
      />
    </UButton>
  </UDropdownMenu>
</template>
