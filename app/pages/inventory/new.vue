<script setup lang="ts">
import {
  GEWICHTSEENHEDEN,
  MAX_AANTAL,
  lokaleDatum,
  type Bewaarplaats,
  type GekozenProduct,
  type VoorraadEenheid,
} from '~/utils/voorraad'

const { t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()
const { activeId, refresh } = useHousehold()
const { loadPlaces, add } = useInventory()

const ready = ref(false)
const failed = ref(false)
const bezig = ref(false)
const error = ref('')

const product = ref<GekozenProduct | null>(null)
const plaatsen = ref<Bewaarplaats[]>([])
const plaats = ref<string | undefined>(undefined)
const aantal = ref<number>(1)
const vervaldatum = ref('')
const opGewicht = ref(false)
const hoeveelheid = ref<number | null>(null)
// Alleen de gewichtseenheden: 'stuk' is de standaard zonder dit blok, en
// USelect wil een model van precies het type van zijn items.
const eenheid = ref<(typeof GEWICHTSEENHEDEN)[number]>('kg')

const plaatsOpties = computed(() => plaatsen.value.map((p) => ({ value: p.id, label: p.name })))
const gewichtOpties = GEWICHTSEENHEDEN.map((e) => ({ value: e, label: e }))

onMounted(async () => {
  try {
    await refresh()
    if (!activeId.value) {
      await navigateTo(localePath('onboarding'))
      return
    }
    plaatsen.value = await loadPlaces(activeId.value)
  } catch {
    failed.value = true
    return
  }
  const gevraagd = typeof route.query.plaats === 'string' ? route.query.plaats : undefined
  plaats.value = plaatsen.value.find((p) => p.id === gevraagd)?.id ?? plaatsen.value[0]?.id
  ready.value = true
})

async function bewaar() {
  // Enter in een veld omzeilt de uitgeschakelde knop: zonder deze wacht zou
  // een tweede submit tijdens het lopende add() alles dubbel toevoegen.
  if (bezig.value) return
  if (!product.value || !plaats.value || !activeId.value) return

  // Number(): een geleegd getalveld geeft '' terug, niet null (zie
  // valideerInhoudEenheid in app/utils/eenheden.ts).
  const n = Number(aantal.value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_AANTAL) {
    error.value = t('inventory.countRange', { max: MAX_AANTAL })
    return
  }

  let amount = 1
  let unit: VoorraadEenheid = 'stuk'
  if (opGewicht.value) {
    const h = Number(hoeveelheid.value)
    if (!(h > 0)) {
      error.value = t('inventory.amountPositive')
      return
    }
    amount = h
    unit = eenheid.value
  }

  bezig.value = true
  error.value = ''
  try {
    await add({
      householdId: activeId.value,
      productId: product.value.productId,
      storagePlaceId: plaats.value,
      aantal: n,
      amount,
      unit,
      acquiredAt: lokaleDatum(new Date()),
      expiresAt: vervaldatum.value || null,
    })
    toast.add({ title: t('inventory.added', { count: n, name: product.value.naam }), color: 'success' })
    await navigateTo(localePath('inventory'))
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <h1 class="text-2xl font-bold">{{ t('inventory.addTitle') }}</h1>

    <UAlert v-if="failed" class="mt-6" color="error" :description="t('householdSettings.error')" />
    <UProgress v-else-if="!ready" class="mt-6" animation="carousel" />
    <div v-else-if="plaatsen.length === 0" class="mt-6">
      <p class="text-muted">{{ t('inventory.noPlaces') }}</p>
      <UButton class="mt-4" :to="localePath('settings-places')">{{ t('places.add') }}</UButton>
    </div>
    <template v-else>
      <div class="mt-6">
        <InventoryProductPicker v-model="product" />
      </div>

      <form v-if="product" class="mt-6 space-y-4" @submit.prevent="bewaar">
        <UFormField :label="t('inventory.place')" name="plaats">
          <USelect
            v-model="plaats"
            :items="plaatsOpties"
            value-key="value"
            :aria-label="t('inventory.place')"
            class="w-full"
          />
        </UFormField>

        <!-- Naast elkaar op desktop, gestapeld onder sm. De stapeltest in
             e2e/mobile.spec.ts toetst dat. -->
        <div class="flex flex-col gap-4 sm:flex-row">
          <UFormField :label="t('inventory.count')" :help="t('inventory.countHelp')" name="aantal" class="sm:flex-1">
            <UInput v-model.number="aantal" type="number" min="1" :max="MAX_AANTAL" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('inventory.expiresAt')"
            :help="t('inventory.expiresAtHelp')"
            name="vervaldatum"
            class="sm:flex-1"
          >
            <UInput v-model="vervaldatum" type="date" class="w-full" />
          </UFormField>
        </div>

        <UCheckbox v-model="opGewicht" :label="t('inventory.byWeight')" />
        <div v-if="opGewicht" class="flex flex-col gap-4 sm:flex-row">
          <UFormField :label="t('inventory.amount')" name="hoeveelheid" class="sm:flex-1">
            <UInput v-model.number="hoeveelheid" type="number" min="0" step="any" class="w-full" />
          </UFormField>
          <UFormField :label="t('inventory.amountUnit')" name="eenheid">
            <USelect
              v-model="eenheid"
              :items="gewichtOpties"
              value-key="value"
              :aria-label="t('inventory.amountUnit')"
              class="w-full sm:w-auto"
            />
          </UFormField>
        </div>

        <UAlert v-if="error" color="error" :description="error" />

        <UButton type="submit" :loading="bezig" block>{{ t('inventory.save') }}</UButton>
      </form>
    </template>
  </UContainer>
</template>
