<script setup lang="ts">
import { localeCodes } from '~~/routes.config'

const { t, locale } = useI18n()
const route = useRoute()
const user = useSupabaseUser()
const { profile } = useProfile()
const { load, update, setTranslation, removeTranslation } = useProducts()

const product = ref<ProductDetail | null>(null)
const bezig = ref(false)
const saved = ref(false)
const error = ref('')
const nietGevonden = ref(false)

const merk = ref('')
const inhoud = ref<number | null>(null)
// string | undefined, niet | null: zelfde beperking als in
// app/pages/products/new.vue — USelect's v-model-type staat alleen
// `undefined` toe voor "niets gekozen". update() wil wél `string | null`,
// dus die vertaling gebeurt in vul() (inladen) en bewaarGegevens() (opslaan).
const eenheid = ref<string | undefined>(undefined)
const gtin = ref('')
const namen = ref<Record<string, string>>({})

const eenheden = computed(() => ['ml', 'g', 'stuk'].map((value) => ({ value, label: value })))

// Bewerken mag de maker en een moderator. product_revision en het terugdraaien
// zijn uitgesteld, dus zonder ongedaan maken is "iedereen mag alles" schade
// die niemand herstelt (spec §2). De database bewaakt dit ook; dit is alleen
// de UI die geen knoppen toont die toch zouden weigeren.
// `profile.role` bestaat sinds Taak 4, Step 3. `profile` wordt gevuld door
// AppHeader.vue tijdens SSR, dus op een ingelogde pagina staat hij er al.
const magBewerken = computed(() =>
  product.value?.createdBy === user.value?.sub
  || ['moderator', 'admin'].includes(profile.value?.role ?? ''),
)

function vul(p: ProductDetail) {
  merk.value = p.brand ?? ''
  inhoud.value = p.netContent
  eenheid.value = p.unit ?? undefined
  gtin.value = p.gtin ?? ''
  namen.value = Object.fromEntries(p.vertalingen.map((v) => [v.locale, v.name]))
}

async function haal() {
  try {
    const p = await load(route.params.id as string)
    if (!p) {
      nietGevonden.value = true
      return
    }
    product.value = p
    vul(p)
  } catch {
    error.value = t('householdSettings.error')
  }
}

await haal()

function bronLabel(source: string): string {
  if (source === 'off') return t('products.sourceOff')
  if (source === 'machine') return t('products.sourceMachine')
  return t('products.sourceUser')
}

async function bewaarGegevens() {
  if (!product.value) return
  bezig.value = true
  error.value = ''
  saved.value = false
  try {
    await update(product.value.id, {
      gtin: gtin.value.trim() || null,
      brand: merk.value.trim() || null,
      netContent: inhoud.value,
      unit: eenheid.value ?? null,
    })
    saved.value = true
    await haal()
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}

async function bewaarNaam(taal: string) {
  if (!product.value) return
  bezig.value = true
  error.value = ''
  try {
    const waarde = (namen.value[taal] ?? '').trim()
    if (waarde) await setTranslation(product.value.id, taal, waarde)
    else await removeTranslation(product.value.id, taal)
    await haal()
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}

const getoondeNaam = computed(() => {
  const v = product.value?.vertalingen ?? []
  return v.find((x) => x.locale === locale.value)
    ?? v.find((x) => x.locale === 'en')
    ?? v[0]
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <UAlert v-if="nietGevonden" color="error" :description="t('products.notFound')" />

    <template v-else-if="product">
      <h1 class="text-2xl font-bold">{{ getoondeNaam?.name }}</h1>
      <p v-if="getoondeNaam && getoondeNaam.locale !== locale" class="mt-1 text-sm text-muted">
        {{ t('products.shownIn', { language: getoondeNaam.locale.toUpperCase() }) }}
      </p>
      <UBadge class="mt-2" variant="subtle">
        {{ t(`products.status${product.status.charAt(0).toUpperCase()}${product.status.slice(1)}`) }}
      </UBadge>

      <section class="mt-8">
        <h2 class="mb-3 font-semibold">{{ t('products.names') }}</h2>
        <!-- Alle drie de taalvakjes, ook de lege. Dat is hoe de catalogus
             meertalig wordt en de natuurlijkste plek om bij te dragen. -->
        <div class="space-y-3">
          <UFormField
            v-for="taal in localeCodes"
            :key="taal"
            :label="taal.toUpperCase()"
            :help="product.vertalingen.find((v) => v.locale === taal)
              ? bronLabel(product.vertalingen.find((v) => v.locale === taal)!.source)
              : undefined"
            :name="`naam-${taal}`"
          >
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="namen[taal]"
                :disabled="!magBewerken"
                :maxlength="200"
                class="w-full sm:flex-1"
              />
              <UButton
                v-if="magBewerken"
                :aria-label="`${t('products.save')} ${taal.toUpperCase()}`"
                size="sm"
                variant="subtle"
                :loading="bezig"
                @click="bewaarNaam(taal)"
              >
                {{ t('products.save') }}
              </UButton>
            </div>
          </UFormField>
        </div>
      </section>

      <section v-if="magBewerken" class="mt-8">
        <form class="space-y-4" @submit.prevent="bewaarGegevens">
          <UFormField :label="t('products.brand')" name="merk">
            <UInput v-model="merk" class="w-full" />
          </UFormField>

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

          <UFormField :label="t('products.gtin')" :help="t('products.gtinHelp')" name="gtin">
            <UInput v-model="gtin" :maxlength="14" class="w-full" />
          </UFormField>

          <UAlert v-if="error" color="error" :description="error" />
          <UAlert v-else-if="saved" color="success" :description="t('products.saved')" />

          <UButton type="submit" :loading="bezig">{{ t('products.save') }}</UButton>
        </form>
      </section>

      <UAlert v-else-if="error" class="mt-8" color="error" :description="error" />
    </template>
  </UContainer>
</template>
