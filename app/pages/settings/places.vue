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
  places.value = (data ?? []) as Place[]
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
onMounted(async () => {
  await refresh()
  await load()
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
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

    <form class="mt-6 flex gap-2" @submit.prevent="add">
      <UInput v-model="name" :placeholder="t('places.name')" class="flex-1" />
      <USelect v-model="kind" :items="kinds" value-key="value" :aria-label="t('places.kind')" />
      <UButton type="submit">{{ t('places.add') }}</UButton>
    </form>
  </UContainer>
</template>
