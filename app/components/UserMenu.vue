<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { profile } = useProfile()
const offline = useOfflineVoorraad()
const bevestigUitloggen = ref(false)
const wachtend = ref(0)

const letters = computed(() => initials(profile.value?.displayName))

// Valt terug op het e-mailadres zolang er geen naam is. useSupabaseUser()
// geeft het JWT-payload, en `email` is daar een standaardclaim.
const naam = computed(() => profile.value?.displayName || user.value?.email || '')

// Spec §8: wat nog in de wachtrij staat, gaat verloren bij uitloggen. Dat
// vraagt een bevestiging; zonder wachtrij gewoon uitloggen.
function vraagUitloggen() {
  wachtend.value = offline.wachtendVoorMij()
  if (wachtend.value > 0) {
    bevestigUitloggen.value = true
    return
  }
  void signOut()
}

async function signOut() {
  bevestigUitloggen.value = false
  // Eerst wissen: lukt het uitloggen offline niet volledig, dan is de
  // privédata toch al weg van het toestel.
  offline.wis()
  await supabase.auth.signOut()
  // Nogmaals: een laad() die nog liep kan tussen de eerste wisbeurt en het
  // uitloggen een kopie hebben bewaard.
  offline.wis()
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
      onSelect: () => { vraagUitloggen() },
    },
  ],
])
</script>

<template>
  <!-- Eén wortelelement: AppHeader geeft `class="ml-auto"` mee, en dat valt weg
       bij meerdere wortels. -->
  <div>
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

    <UModal
      v-model:open="bevestigUitloggen"
      :title="t('offlineVoorraad.signOutTitle')"
      :description="t('offlineVoorraad.signOutBody', { count: wachtend })"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" @click="bevestigUitloggen = false">{{ t('inventory.cancel') }}</UButton>
          <UButton color="error" @click="signOut">{{ t('auth.signOut') }}</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
