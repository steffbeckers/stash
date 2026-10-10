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
import { heeftFoutcode, isNetwerkfout, wachtrijVoor } from '~/utils/offlineVoorraad'

const { t } = useI18n()
const localePath = useLocalePath()
const { households, activeId, refresh } = useHousehold()
const toast = useToast()
const { load, loadPlaces, close, reopen } = useInventory()
const offline = useOfflineVoorraad()
const gebruiker = useSupabaseUser()

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
  // Alleen de wachtrij van deze gebruiker telt; die van een ander verbergt niets.
  const wachtend = new Set(gebruiker.value ? wachtrijVoor(offline.wachtrij(), gebruiker.value.sub).map((w) => w.itemId) : [])
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
  // Nu vastgelegd: na de verversing staat het item niet meer in de lijst, en
  // ongedaan maken heeft het nodig om de kopie bij te werken.
  const item = items.value.find((i) => i.id === itemId)
  // Vóór de poging: valt de verbinding weg midden in het antwoord, dan is het
  // toestel in de catch al offline, terwijl de server de afstreping kan hebben.
  const vooraf = navigator.onLine
  try {
    const gelukt = await close(itemId, reden)
    if (gelukt) {
      // Meteen, niet pas bij de verversing hieronder: faalt die, dan toont de
      // offline-pagina het item anders nog als in voorraad.
      offline.streepAfInDeKopie(itemId)
      toast.add({
        title: t('inventory.closed', { name: naam }),
        actions: [{ label: t('inventory.undo'), onClick: () => { void ongedaanMaken(itemId, item) } }],
      })
    } else {
      toast.add({ title: t('inventory.alreadyClosed'), color: 'warning' })
    }
  } catch (oorzaak) {
    // zetInWachtrij() staat in de voorwaarde: lukt het bewaren niet (opslag vol),
    // dan valt dit terug op de gewone foutmelding en blijft het item in de lijst.
    // Was het toestel vóór de poging online en kwam er geen antwoord van de
    // server (de termijn, of een verbinding die wegviel), dan kreeg de server
    // de afstreping misschien toch: onzeker.
    if (item && isNetwerkfout(oorzaak, navigator.onLine) && offline.zetInWachtrij(item, reden, { onzeker: vooraf && !heeftFoutcode(oorzaak) })) {
      // Geen netwerk of geen antwoord binnen de termijn: de afstreping wacht op
      // het toestel (spec §5, punt 2; spec termijn §4). Niet herladen: dat
      // faalt nu waarschijnlijk ook, en de lijst klopt al.
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

// Wachtte de afstreping nog, dan volstaat haar uit de wachtrij halen, en was
// ze onzeker, dan heropent de composable haar ook op de server. Was ze
// intussen al verstuurd (het netwerk kwam terug), dan is het een gewone
// ongedaanmaking op de server.
async function ongedaanMakenOffline(item: VoorraadItem): Promise<void> {
  const uitkomst = await offline.ongedaanMakenInWachtrij(item)
  if (uitkomst === 'nietInWachtrij') {
    await ongedaanMaken(item.id, item)
    return
  }
  // Eerst filteren: een verversing tijdens het heropenen (tot de termijn) kan
  // het item al teruggezet hebben, en dan stond het er twee keer.
  items.value = [...items.value.filter((i) => i.id !== item.id), item]
  if (uitkomst === 'nietBevestigd') toast.add({ title: t('offlineVoorraad.undoUnconfirmed'), color: 'warning' })
}

async function ongedaanMaken(itemId: string, item: VoorraadItem | undefined): Promise<void> {
  try {
    const uitkomst = await reopen(itemId)
    // Zoals bij afstrepen: de kopie meteen, voor het geval de verversing faalt.
    if (uitkomst === 'heropend' && item) offline.zetTerugInDeKopie(item)
    // 'nietGesloten': het stond al in voorraad. Herladen toont de juiste stand.
    // 'vanEenAnder': iemand anders streepte het intussen af of verwijderde het
    // (spec eigen-afstreping §4).
    if (uitkomst === 'vanEenAnder') toast.add({ title: t('inventory.undoByOther'), color: 'warning' })
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
  // wachtrij al afgestreept is (spec §5). Een fout hier mag de pagina niet op
  // haar spinner laten staan: laad() filtert wat nog wacht, dus laden kan toch.
  try {
    await offline.verstuur()
  } catch (oorzaak) {
    console.warn('[offline] versturen bij het openen mislukt', oorzaak)
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
