<script setup lang="ts">
const { t, locale } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const { create } = useProducts()

const naam = ref(typeof route.query.naam === 'string' ? route.query.naam : '')
const merk = ref('')
const inhoud = ref<number | null>(null)
// string | undefined, niet | null: USelect leidt zijn v-model-type af uit
// `eenheden`s value-veld (string) en staat alleen `undefined` toe voor "niets
// gekozen" — geverifieerd via Select.vue.d.ts. create_product wil wél
// `string | null`, dus die vertaling gebeurt in bewaar() hieronder.
const eenheid = ref<string | undefined>(undefined)
const gtin = ref('')
const bezig = ref(false)
const error = ref('')

const eenheden = computed(() =>
  ['ml', 'g', 'stuk'].map((value) => ({ value, label: value })),
)

/**
 * Een GTIN heeft een controlecijfer: de som van de cijfers, afwisselend maal
 * 1 en maal 3 vanaf rechts, moet een veelvoud van tien zijn.
 *
 * Dit waarschuwt maar blokkeert niet, en dat is bewust (spec §4). Een
 * verkeerd getypte barcode wijst voorgoed naar het verkeerde product, dus
 * erop wijzen is waardevol — maar een validatie die één keer verkeerd staat,
 * weigert geldige producten en dat merk je pas als iemand klaagt.
 */
function controlecijferKlopt(code: string): boolean {
  const cijfers = [...code].map(Number)
  const controle = cijfers.pop()!
  const som = cijfers
    .reverse()
    .reduce((t, c, i) => t + c * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (som % 10)) % 10 === controle
}

const gtinWaarschuwing = computed(() => {
  const code = gtin.value.trim()
  if (!/^([0-9]{8}|[0-9]{12,14})$/.test(code)) return ''
  return controlecijferKlopt(code) ? '' : t('products.gtinCheckDigit')
})

async function bewaar() {
  bezig.value = true
  error.value = ''
  try {
    const id = await create({
      gtin: gtin.value.trim() || null,
      brand: merk.value.trim() || null,
      netContent: inhoud.value,
      unit: eenheid.value ?? null,
      locale: locale.value,
      name: naam.value.trim(),
    })
    await navigateTo(localePath({ name: 'products-id', params: { id } }))
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <h1 class="text-2xl font-bold">{{ t('products.create') }}</h1>

    <form class="mt-6 space-y-4" @submit.prevent="bewaar">
      <UFormField :label="t('products.name')" name="naam">
        <UInput v-model="naam" required :maxlength="200" class="w-full" />
      </UFormField>

      <UFormField :label="t('products.brand')" name="merk">
        <UInput v-model="merk" class="w-full" />
      </UFormField>

      <!-- Inhoud en eenheid staan naast elkaar op desktop en gestapeld onder
           sm. De stapeltest in e2e/mobile.spec.ts toetst dat. -->
      <UFormField :label="t('products.netContent')" :help="t('products.contentHelp')" name="inhoud">
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

      <UFormField :label="t('products.gtin')" :help="gtinWaarschuwing || t('products.gtinHelp')" name="gtin">
        <UInput v-model="gtin" :maxlength="14" class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="error" :description="error" />

      <UButton type="submit" :loading="bezig" block>{{ t('products.save') }}</UButton>
    </form>
  </UContainer>
</template>
