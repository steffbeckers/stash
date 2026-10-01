<script setup lang="ts">
import { formatDatum, groepslabel, isVervallen, type Productgroep } from '~/utils/voorraad'

const props = defineProps<{ groep: Productgroep; vandaag: string }>()
const { t, locale } = useI18n()

const open = ref(false)

const label = computed(() => {
  const l = groepslabel(props.groep.items)
  if (l.soort === 'aantal') return `×${l.aantal}`
  const getal = new Intl.NumberFormat(locale.value)
  return l.totalen.map((x) => `${getal.format(x.amount)} ${x.unit}`).join(' + ')
})

function datumTekst(datum: string): string {
  const geformatteerd = formatDatum(datum, locale.value, props.vandaag)
  return isVervallen({ expiresAt: datum }, props.vandaag)
    ? t('inventory.expiredOn', { date: geformatteerd })
    : t('inventory.expiresOn', { date: geformatteerd })
}
</script>

<template>
  <li class="py-3">
    <button type="button" class="block w-full min-w-0 text-left" :aria-expanded="open" @click="open = !open">
      <span class="font-medium">{{ groep.naam }}</span>
      <span class="ml-1 text-muted">{{ label }}</span>
      <span
        v-if="groep.vroegsteVervaldatum"
        class="block text-sm"
        :class="isVervallen({ expiresAt: groep.vroegsteVervaldatum }, vandaag) ? 'text-error' : 'text-muted'"
      >
        {{ datumTekst(groep.vroegsteVervaldatum) }}
      </span>
    </button>

    <ul v-if="open" class="mt-2 space-y-2 border-l border-default pl-3 text-sm">
      <li v-for="item in groep.items" :key="item.id">
        {{ item.expiresAt ? datumTekst(item.expiresAt) : t('inventory.noExpiry') }}
        <template v-if="item.unit !== 'stuk' || item.amount !== 1"> · {{ item.amount }} {{ item.unit }}</template>
      </li>
    </ul>
  </li>
</template>
