<script setup lang="ts">
import { groepeerPerPlaats, lokaleDatum, vervaltBinnenkort, type Bewaarplaats, type VoorraadItem } from '~/utils/voorraad'

const { t } = useI18n()
const localePath = useLocalePath()
const { households, activeId, refresh } = useHousehold()
const { load, loadPlaces } = useInventory()

const ready = ref(false)
const failed = ref(false)
const items = ref<VoorraadItem[]>([])
const plaatsen = ref<Bewaarplaats[]>([])
// De lokale datum van dit toestel, niet current_date van de database: die
// rekent in UTC, en dan springt 's avonds laat alles een dag op (spec §2).
const vandaag = ref(lokaleDatum(new Date()))

async function laad(): Promise<void> {
  if (!activeId.value) return
  const [i, p] = await Promise.all([load(activeId.value), loadPlaces(activeId.value)])
  items.value = i
  plaatsen.value = p
  vandaag.value = lokaleDatum(new Date())
}

// In onMounted, niet op top-level await: activeId komt uit localStorage en is
// tijdens SSR altijd null (zie settings/places.vue).
onMounted(async () => {
  try {
    await refresh()
  } catch {
    failed.value = true
    return
  }
  if (households.value.length === 0) {
    await navigateTo(localePath('onboarding'))
    return
  }
  try {
    await laad()
  } catch {
    failed.value = true
    return
  }
  ready.value = true
})

const active = computed(() => households.value.find((h) => h.id === activeId.value))
const perPlaats = computed(() => groepeerPerPlaats(items.value))
const binnenkort = computed(() => vervaltBinnenkort(items.value, vandaag.value))
</script>

<template>
  <UContainer class="max-w-2xl py-12">
    <UAlert v-if="failed" color="error" :description="t('householdSettings.error')" />
    <UProgress v-else-if="!ready" animation="carousel" />
    <template v-else>
      <h1 class="text-3xl font-bold">{{ t('appHome.title') }}</h1>
      <!-- Niet weghalen: createHousehold() in e2e/helpers.ts wacht op deze naam. -->
      <p class="mt-2 text-lg text-muted">{{ active?.name }}</p>

      <InventoryExpiring v-if="binnenkort.length" class="mt-8" :items="binnenkort" :vandaag="vandaag" />

      <p v-if="items.length === 0 && plaatsen.length > 0" class="mt-8 text-muted">{{ t('inventory.empty') }}</p>

      <div v-if="plaatsen.length === 0" class="mt-8">
        <p class="text-muted">{{ t('inventory.noPlaces') }}</p>
        <UButton class="mt-4" :to="localePath('settings-places')">{{ t('places.add') }}</UButton>
      </div>

      <div class="mt-8 space-y-8">
        <InventoryPlace
          v-for="plaats in plaatsen"
          :key="plaats.id"
          :plaats="plaats"
          :groepen="perPlaats.get(plaats.id) ?? []"
          :vandaag="vandaag"
        />
      </div>
    </template>
  </UContainer>
</template>
