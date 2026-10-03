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
import { isNetwerkfout } from '~/utils/offlineVoorraad'

const { t } = useI18n()
const localePath = useLocalePath()
const { households, activeId, refresh } = useHousehold()
const toast = useToast()
const { load, loadPlaces, close, reopen } = useInventory()
const offline = useOfflineVoorraad()

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
  // Een afstreping die nog in de wachtrij staat, is voor de server nog niet
  // gebeurd: zonder dit filter zet elke verversing tijdens het versturen het
  // item terug, in de lijst én in de lokale kopie.
  const wachtend = new Set(offline.wachtrij().map((w) => w.itemId))
  const zichtbaar = i.filter((item) => !wachtend.has(item.id))
  items.value = zichtbaar
  plaatsen.value = p
  offline.bewaar({ id: activeId.value, naam: active.value?.name ?? '' }, p, zichtbaar)
  vandaag.value = lokaleDatum(new Date())
}

// Alleen de eerste lading mag de pagina in foutstand zetten. Faalt een
// verversing ná een actie, dan blijft de laatst bekende lijst staan: die is
// misschien verouderd, maar een foutpagina tot je zelf herlaadt is erger.
async function herlaad(): Promise<void> {
  try {
    await laad()
  } catch {
    toast.add({ title: t('inventory.refreshFailed'), color: 'warning' })
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
  } catch (oorzaak) {
    const item = items.value.find((i) => i.id === itemId)
    // zetInWachtrij() staat in de voorwaarde: lukt het bewaren niet (opslag vol),
    // dan valt dit terug op de gewone foutmelding en blijft het item in de lijst.
    if (item && isNetwerkfout(oorzaak, navigator.onLine) && offline.zetInWachtrij(item, reden)) {
      // Geen netwerk: de afstreping wacht op het toestel (spec §5, punt 2).
      // Niet herladen — dat faalt nu ook, en de lijst klopt al.
      items.value = items.value.filter((i) => i.id !== itemId)
      toast.add({
        title: t('offlineVoorraad.queued'),
        actions: [{ label: t('inventory.undo'), onClick: () => { void ongedaanMakenOffline(item) } }],
      })
      return
    }
    toast.add({ title: t('householdSettings.error'), color: 'error' })
  }
  await herlaad()
}

// Wachtte de afstreping nog, dan volstaat haar uit de wachtrij halen. Was ze
// intussen al verstuurd (het netwerk kwam terug), dan is het een gewone
// ongedaanmaking op de server.
async function ongedaanMakenOffline(item: VoorraadItem): Promise<void> {
  // Loopt er een verzending, wacht dan: pas daarna weten we of de afstreping
  // nog in de wachtrij staat of al op de server is.
  await offline.wachtOpVerzending()
  if (offline.haalUitWachtrij(item.id)) {
    items.value = [...items.value, item]
    return
  }
  await ongedaanMaken(item.id)
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
  // Eerst versturen, dan laden: anders zet de server een item terug dat in de
  // wachtrij al afgestreept is (spec §5).
  await offline.verstuur()
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

      <div v-if="items.length === 0 && plaatsen.length > 0" class="mt-8">
        <p class="text-muted">{{ t('inventory.empty') }}</p>
        <!-- Zonder ?plaats=: new.vue kiest dan de eerste plaats. -->
        <UButton class="mt-4" icon="i-lucide-plus" :to="localePath('inventory-new')">{{ t('inventory.add') }}</UButton>
      </div>

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
