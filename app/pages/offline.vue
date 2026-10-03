<script setup lang="ts">
import { leesKopie, type Kopie } from '~/utils/offlineVoorraad'

// Geen auth en geen netwerk: deze pagina moet te tonen zijn als er niets meer
// werkt. Wél de lokale kopie van de voorraad, als die er is (spec §7). Die
// komt pas na het mounten uit localStorage — de pagina is geprerenderd en
// heeft tijdens het renderen geen toestel.
const { t } = useI18n()

const kopie = ref<Kopie | null>(null)

function leesOpnieuw() {
  try {
    kopie.value = leesKopie(window.localStorage)
  } catch {
    kopie.value = null
  }
}

onMounted(leesOpnieuw)

function opnieuw() {
  window.location.reload()
}
</script>

<template>
  <UContainer class="py-16">
    <div class="text-center">
      <h1 class="text-3xl font-bold">{{ t('offline.title') }}</h1>
      <p v-if="!kopie" class="mt-3 text-lg text-muted">{{ t('offline.body') }}</p>
      <UButton class="mt-8" size="lg" @click="opnieuw">
        {{ t('offline.retry') }}
      </UButton>
    </div>

    <!-- ClientOnly: de weergave gebruikt de supabase- en toast-composables,
         en die horen niet in de prerender van een pagina zonder sessie. -->
    <ClientOnly>
      <OfflineVoorraad v-if="kopie" class="mt-10" :kopie="kopie" @gewijzigd="leesOpnieuw" />
    </ClientOnly>
  </UContainer>
</template>
