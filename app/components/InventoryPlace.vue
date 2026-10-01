<script setup lang="ts">
import type { Bewaarplaats, Productgroep } from '~/utils/voorraad'

const props = defineProps<{ plaats: Bewaarplaats; groepen: Productgroep[]; vandaag: string }>()
const { t } = useI18n()
const localePath = useLocalePath()

const toevoegpad = computed(() => ({ path: localePath('inventory-new'), query: { plaats: props.plaats.id } }))
</script>

<template>
  <section :aria-labelledby="`plaats-${plaats.id}`">
    <div class="flex items-center justify-between gap-2">
      <h2 :id="`plaats-${plaats.id}`" class="min-w-0 truncate text-lg font-semibold">{{ plaats.name }}</h2>
      <!-- Zichtbaar "Add", voor een schermlezer "Add to Pantry": met drie
           plaatsen op één scherm zegt "Add" alleen niets. -->
      <UButton
        :to="toevoegpad"
        size="sm"
        variant="soft"
        icon="i-lucide-plus"
        class="shrink-0"
        :aria-label="t('inventory.addTo', { place: plaats.name })"
      >
        {{ t('inventory.add') }}
      </UButton>
    </div>
    <p v-if="groepen.length === 0" class="mt-2 text-sm text-muted">{{ t('inventory.placeEmpty') }}</p>
    <ul v-else class="mt-2 divide-y divide-default">
      <InventoryGroup v-for="groep in groepen" :key="groep.productId" :groep="groep" :vandaag="vandaag" />
    </ul>
  </section>
</template>
