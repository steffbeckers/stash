<script setup lang="ts">
import { groepeerPerPlaats, lokaleDatum, vervaltBinnenkort, type Reden } from '~/utils/voorraad'
import { wachtrijVoor, type Kopie } from '~/utils/offlineVoorraad'

const props = defineProps<{ kopie: Kopie }>()
const emit = defineEmits<{ gewijzigd: [] }>()
const { t, locale } = useI18n()
const toast = useToast()
const offline = useOfflineVoorraad()

const vandaag = lokaleDatum(new Date())

// De wachtrij van deze eigenaar. Een afstreping die in de wachtrij staat is
// voor de server nog niet gebeurd, maar voor deze lijst wél: het schrijven van
// de wachtrij kan slagen terwijl het bijwerken van de kopie mislukt, en dan
// staat het item in allebei. Daarom filteren we de kopie hier ook op.
// Een ref en geen computed: de wachtrij leeft in localStorage, niet in Vue.
const wachtend = ref<Set<string>>(new Set())
function telWachtend() {
  wachtend.value = new Set(wachtrijVoor(offline.wachtrij(), props.kopie.eigenaar).map((w) => w.itemId))
}
telWachtend()

const items = computed(() => props.kopie.items.filter((i) => !wachtend.value.has(i.id)))
const perPlaats = computed(() => groepeerPerPlaats(items.value))
const binnenkort = computed(() => vervaltBinnenkort(items.value, vandaag))
const bijgewerkt = computed(() =>
  new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(props.kopie.bewaardOp)),
)

function afstrepen(itemId: string, _naam: string, reden: Reden) {
  const item = props.kopie.items.find((i) => i.id === itemId)
  if (!item) return
  // Lukt het bewaren niet, dan een fout: een afstreping mag niet stil verdwijnen.
  if (!offline.zetInWachtrij(item, reden)) {
    toast.add({ title: t('householdSettings.error'), color: 'error' })
    return
  }
  emit('gewijzigd')
  telWachtend()
  toast.add({
    title: t('offlineVoorraad.queued'),
    actions: [{ label: t('inventory.undo'), onClick: () => { void maakOngedaan(itemId) } }],
  })
}

async function maakOngedaan(itemId: string) {
  // Loopt er een verzending, wacht dan: pas daarna weten we of de afstreping
  // nog in de wachtrij staat.
  await offline.wachtOpVerzending()
  // Niet meer in de wachtrij: de afstreping is intussen verstuurd, en
  // heropenen vraagt de server, die hier niet bereikbaar is.
  if (!offline.haalUitWachtrij(itemId)) {
    toast.add({ title: t('offlineVoorraad.alreadySent'), color: 'error' })
  }
  emit('gewijzigd')
  telWachtend()
}
</script>

<template>
  <div class="text-left">
    <p class="text-sm text-muted">
      {{ kopie.huishouden.naam }} · {{ t('offlineVoorraad.lastUpdated', { date: bijgewerkt }) }}
    </p>
    <p v-if="wachtend.size > 0" class="mt-1 text-sm">{{ t('offlineVoorraad.pending', { count: wachtend.size }) }}</p>

    <InventoryExpiring v-if="binnenkort.length" class="mt-6" :items="binnenkort" :vandaag="vandaag" />

    <div class="mt-6 space-y-8">
      <InventoryPlace
        v-for="plaats in kopie.plaatsen"
        :key="plaats.id"
        :plaats="plaats"
        :plaatsen="kopie.plaatsen"
        :groepen="perPlaats.get(plaats.id) ?? []"
        :vandaag="vandaag"
        alleen-afstrepen
        @afstrepen="afstrepen"
      />
    </div>
  </div>
</template>
