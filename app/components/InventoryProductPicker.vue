<script setup lang="ts">
import type { GekozenProduct } from '~/utils/voorraad'

const gekozen = defineModel<GekozenProduct | null>({ required: true })
const { t, locale } = useI18n()
const { search, create } = useProducts()

const zoekterm = ref('')
const resultaten = ref<Zoekresultaat[]>([])
const zoekt = ref(false)
const error = ref('')

const aanmaken = ref(false)
const naam = ref('')
const merk = ref('')
const inhoud = ref<number | null>(null)
// string | undefined: zie de uitleg in app/pages/products/new.vue.
const eenheid = ref<string | undefined>(undefined)
const maaktAan = ref(false)
const eenheden = computed(() => eenheidOpties(t('products.noUnit')))

let laatste = 0
async function zoek() {
  const beurt = ++laatste
  zoekt.value = true
  error.value = ''
  try {
    const rijen = await search(zoekterm.value)
    // Een trager antwoord op een oudere toetsaanslag mag een nieuwer niet
    // overschrijven (zelfde patroon als products/index.vue).
    if (beurt === laatste) resultaten.value = rijen
  } catch {
    if (beurt === laatste) error.value = t('householdSettings.error')
  } finally {
    if (beurt === laatste) zoekt.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(zoekterm, () => {
  clearTimeout(timer)
  timer = setTimeout(zoek, 250)
})
onMounted(zoek)

function kies(r: Zoekresultaat) {
  gekozen.value = { productId: r.productId, naam: r.naam }
}

// Zoeken gaat altijd vooraf aan aanmaken: de knop staat onder de resultaten
// en neemt de zoekterm mee. De duplicaatverzachting uit de catalogus blijft
// zo ook hier gelden (spec §6).
function openAanmaken() {
  naam.value = zoekterm.value.trim()
  aanmaken.value = true
}

async function maakAan() {
  if (!naam.value.trim()) return
  const paar = valideerInhoudEenheid(inhoud.value, eenheid.value)
  if (!paar) {
    error.value = t('products.contentUnitTogether')
    return
  }
  maaktAan.value = true
  error.value = ''
  try {
    const id = await create({
      gtin: null,
      brand: merk.value.trim() || null,
      netContent: paar.netContent,
      unit: paar.unit,
      locale: locale.value,
      name: naam.value.trim(),
    })
    gekozen.value = { productId: id, naam: naam.value.trim() }
    aanmaken.value = false
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    maaktAan.value = false
  }
}
</script>

<template>
  <div v-if="gekozen" class="flex items-center justify-between gap-2 rounded-md border border-default p-3">
    <p class="min-w-0 truncate font-medium">{{ gekozen.naam }}</p>
    <UButton size="sm" variant="ghost" class="shrink-0" @click="gekozen = null">
      {{ t('inventory.changeProduct') }}
    </UButton>
  </div>

  <div v-else>
    <UFormField :label="t('inventory.searchProduct')" name="zoek">
      <UInput v-model="zoekterm" icon="i-lucide-search" class="w-full" />
    </UFormField>

    <UAlert v-if="error" class="mt-4" color="error" :description="error" />
    <UProgress v-else-if="zoekt" class="mt-4" animation="carousel" />

    <ul v-if="resultaten.length" class="mt-2 divide-y divide-default">
      <li v-for="r in resultaten" :key="r.productId">
        <button type="button" class="block w-full py-2 text-left" @click="kies(r)">
          <span class="font-medium">{{ r.naam }}</span>
          <span v-if="r.merk" class="text-sm text-muted"> · {{ r.merk }}</span>
        </button>
      </li>
    </ul>

    <UButton v-if="!aanmaken" class="mt-4" variant="soft" icon="i-lucide-plus" block @click="openAanmaken">
      {{ zoekterm.trim() ? t('products.createNamed', { name: zoekterm.trim() }) : t('products.create') }}
    </UButton>

    <!-- Geen <form>: Enter in deze velden mag niets indienen. Aanmaken gaat
         alleen via de knop onderaan. -->
    <div v-else class="mt-4 space-y-4 rounded-md border border-default p-3">
      <UFormField :label="t('products.name')" name="naam">
        <UInput v-model="naam" :maxlength="200" class="w-full" />
      </UFormField>
      <UFormField :label="t('products.brand')" name="merk">
        <UInput v-model="merk" class="w-full" />
      </UFormField>
      <UFormField :label="t('products.netContent')" name="inhoud">
        <!-- Onder sm gestapeld; de stapeltest in e2e/mobile.spec.ts toetst dat. -->
        <div class="flex flex-col gap-2 sm:flex-row">
          <UInput v-model.number="inhoud" type="number" min="0" class="w-full sm:flex-1" />
          <USelect
            v-model="eenheid"
            :items="eenheden"
            value-key="value"
            :aria-label="t('products.unit')"
            class="w-full sm:w-auto"
          />
        </div>
      </UFormField>
      <UButton :loading="maaktAan" :disabled="!naam.trim()" block @click="maakAan">
        {{ t('inventory.createProduct') }}
      </UButton>
    </div>
  </div>
</template>
