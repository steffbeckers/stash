<script setup lang="ts">
import {
  groepeerPerPlaats,
  isSamenhangFout,
  lokaleDatum,
  vervaltBinnenkort,
  type Bewaarplaats,
  type Reden,
  type VoorraadItem,
} from '~/utils/voorraad'

const { t } = useI18n()
const localePath = useLocalePath()
const { households, activeId, refresh } = useHousehold()
const toast = useToast()
const { load, loadPlaces, close, reopen } = useInventory()

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

async function herlaad(): Promise<void> {
  try {
    await laad()
  } catch {
    failed.value = true
  }
}

// Hier en niet in InventoryGroup: de toast leeft langer dan de groep. Wie het
// laatste item van een product afstreept, ziet de groep verdwijnen, en een
// onClick die daarnaar terugwijst zou na het ongedaan maken niets meer
// verversen.
async function afstrepen(itemId: string, naam: string, reden: Reden): Promise<void> {
  try {
    const gelukt = await close(itemId, reden)
    if (gelukt) {
      toast.add({
        title: t('inventory.closed', { name: naam }),
        actions: [{ label: t('inventory.undo'), onClick: () => { void ongedaanMaken(itemId) } }],
      })
    } else {
      toast.add({ title: t('inventory.alreadyClosed'), color: 'warning' })
    }
  } catch {
    toast.add({ title: t('householdSettings.error'), color: 'error' })
  }
  await herlaad()
}

async function ongedaanMaken(itemId: string): Promise<void> {
  try {
    // false: iemand anders zette het al terug. Herladen toont dan gewoon de
    // juiste stand; er is niets te melden.
    await reopen(itemId)
  } catch (oorzaak) {
    toast.add({
      title: isSamenhangFout(oorzaak) ? t('inventory.cannotUndo') : t('householdSettings.error'),
      color: 'error',
    })
  }
  await herlaad()
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
          :plaatsen="plaatsen"
          :groepen="perPlaats.get(plaats.id) ?? []"
          :vandaag="vandaag"
          @afstrepen="afstrepen"
          @changed="herlaad"
        />
      </div>
    </template>
  </UContainer>
</template>
