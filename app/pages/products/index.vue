<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { search } = useProducts()

const zoekterm = ref('')
const resultaten = ref<Zoekresultaat[]>([])
const bezig = ref(false)
const error = ref('')

// Zoeken en aanmaken zijn één beweging: de affordance om aan te maken staat
// altijd onder de resultaten en neemt je zoekterm mee. Aanmaken kan dus
// alleen nadat je hebt gezien wat er al staat — de tegenmaatregel tegen
// dubbele producten uit spec §4.
const aanmaakpad = computed(() => ({
  path: localePath('products-new'),
  query: zoekterm.value.trim() ? { naam: zoekterm.value.trim() } : undefined,
}))

let laatste = 0
async function zoek() {
  const beurt = ++laatste
  bezig.value = true
  error.value = ''
  try {
    const rijen = await search(zoekterm.value)
    // Een trager antwoord op een oudere toetsaanslag mag een nieuwer
    // antwoord niet overschrijven.
    if (beurt === laatste) resultaten.value = rijen
  } catch {
    if (beurt === laatste) error.value = t('householdSettings.error')
  } finally {
    if (beurt === laatste) bezig.value = false
  }
}

// Geen watchDebounced: VueUse is in dit project alleen een transitieve
// afhankelijkheid, niet auto-importeerbaar (er is geen @vueuse/nuxt-module
// geregistreerd). Eigen ontdubbelaar in plaats van een pakket toe te voegen.
let timer: ReturnType<typeof setTimeout> | undefined
watch(zoekterm, () => {
  clearTimeout(timer)
  timer = setTimeout(zoek, 250)
})
onMounted(zoek)
</script>

<template>
  <UContainer class="max-w-2xl py-12">
    <h1 class="text-2xl font-bold">{{ t('products.title') }}</h1>

    <UFormField class="mt-6" :label="t('products.search')" :help="t('products.searchHelp')" name="zoek">
      <UInput v-model="zoekterm" icon="i-lucide-search" class="w-full" />
    </UFormField>

    <UAlert v-if="error" class="mt-4" color="error" :description="error" />
    <UProgress v-else-if="bezig" class="mt-4" animation="carousel" />

    <ul v-else-if="resultaten.length" class="mt-6 divide-y divide-default">
      <li v-for="r in resultaten" :key="r.productId" class="py-3">
        <NuxtLink :to="localePath({ name: 'products-id', params: { id: r.productId } })" class="block">
          <p class="font-medium">{{ r.naam }}</p>
          <p class="text-sm text-muted">
            <span v-if="r.merk">{{ r.merk }}</span>
            <span v-if="r.netContent"> · {{ r.netContent }} {{ r.unit }}</span>
            <span v-if="r.getoondeTaal !== $i18n.locale"> · {{ t('products.shownIn', { language: r.getoondeTaal.toUpperCase() }) }}</span>
            <span v-if="r.status === 'proposed'"> · {{ t('products.statusProposed') }}</span>
          </p>
        </NuxtLink>
      </li>
    </ul>

    <p v-else class="mt-6 text-muted">{{ t('products.empty') }}</p>

    <UButton class="mt-6" :to="aanmaakpad" icon="i-lucide-plus" block>
      {{ zoekterm.trim() ? t('products.createNamed', { name: zoekterm.trim() }) : t('products.create') }}
    </UButton>
  </UContainer>
</template>
