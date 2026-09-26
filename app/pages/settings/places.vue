<script setup lang="ts">
const { t } = useI18n()
const supabase = useSupabaseClient()
const { activeId, refresh } = useHousehold()

interface Place {
  id: string
  name: string
  kind: 'pantry' | 'fridge' | 'freezer' | 'other'
}

const places = ref<Place[]>([])
const name = ref('')
const kind = ref<Place['kind']>('pantry')
const error = ref('')

const kinds = computed(() =>
  (['pantry', 'fridge', 'freezer', 'other'] as const).map((value) => ({
    value,
    label: t(`places.${value}`),
  })),
)

async function load() {
  if (!activeId.value) return
  const { data, error: loadError } = await supabase
    .from('storage_place')
    .select('id, name, kind')
    .eq('household_id', activeId.value)
    .order('created_at')
  if (loadError) {
    error.value = t('householdSettings.error')
    return
  }
  error.value = ''
  // storage_place.kind is een tekstkolom met een check-constraint, geen
  // Postgres-enum, dus de gegenereerde types geven hier `string` terug in
  // plaats van de letterlijke unie. Alleen dat veld hoeft genoemd te worden
  // — id/name komen al getypeerd uit de gegenereerde Database-types, in
  // plaats van de hele rij ongetypeerd weg te casten zoals `as Place[]` deed.
  places.value = (data ?? []).map((row) => ({ ...row, kind: row.kind as Place['kind'] }))
}

async function add() {
  if (!activeId.value || !name.value.trim()) return
  const { error: insertError } = await supabase.from('storage_place').insert({
    household_id: activeId.value,
    name: name.value.trim(),
    kind: kind.value,
  })
  if (insertError) {
    error.value = t('householdSettings.error')
    return
  }
  name.value = ''
  await load()
}

async function remove(id: string) {
  const { error: deleteError } = await supabase.from('storage_place').delete().eq('id', id)
  if (deleteError) {
    error.value = t('householdSettings.error')
    return
  }
  await load()
}

// In onMounted, niet op top-level await: activeId komt uit localStorage en is
// tijdens SSR altijd null. Een top-level await zou de lijst leeg renderen en
// hem na hydratie nooit opnieuw ophalen.
//
// De pagina die taak 11's sweep tegen stille fouten miste: refresh() kan
// weigeren (RLS, netwerk) en zonder try/catch zag dat er precies hetzelfde
// uit als een leeg huishouden, zonder enige melding. app.vue en
// settings/household.vue hebben dit al; hier hetzelfde patroon, met de
// bestaande error-ref die de template al toont.
onMounted(async () => {
  try {
    await refresh()
  } catch {
    error.value = t('householdSettings.error')
    return
  }
  await load()
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <SettingsTabs />
    <h1 class="text-2xl font-bold">{{ t('places.title') }}</h1>

    <div class="mt-6 space-y-2">
      <UCard v-for="place in places" :key="place.id">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium">{{ place.name }}</p>
            <p class="text-sm text-muted">{{ t(`places.${place.kind}`) }}</p>
          </div>
          <UButton size="sm" color="error" variant="ghost" @click="remove(place.id)">
            {{ t('places.delete') }}
          </UButton>
        </div>
      </UCard>
    </div>

    <UAlert v-if="error" class="mt-4" color="error" :description="error" />

    <!-- Onder `sm` gestapeld. Naast elkaar werd het naamveld in het Frans op
         360px teruggedrukt tot 49px: alleen het invoerveld had flex-1, dus
         het leverde als enige in tegenover een keuzelijst van 149px en een
         knop van 114px. -->
    <form class="mt-6 flex flex-col gap-2 sm:flex-row" @submit.prevent="add">
      <UInput v-model="name" :placeholder="t('places.name')" class="w-full sm:flex-1" />
      <USelect v-model="kind" :items="kinds" value-key="value" :aria-label="t('places.kind')" class="w-full sm:w-auto" />
      <UButton type="submit" class="justify-center">{{ t('places.add') }}</UButton>
    </form>
  </UContainer>
</template>
