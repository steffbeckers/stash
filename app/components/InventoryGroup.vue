<script setup lang="ts">
import {
  EENHEDEN,
  formatDatum,
  formatHoeveelheid,
  groepslabel,
  isVervallen,
  varianten,
  type Bewaarplaats,
  type Productgroep,
  type Reden,
  type Variant,
  type VoorraadEenheid,
  type VoorraadItem,
} from '~/utils/voorraad'

const props = defineProps<{ groep: Productgroep; plaatsen: Bewaarplaats[]; vandaag: string }>()
const emit = defineEmits<{ afstrepen: [itemId: string, naam: string, reden: Reden]; changed: [] }>()
const { t, locale } = useI18n()
const toast = useToast()
const { update, remove } = useInventory()

const open = ref(false)

const label = computed(() => {
  const l = groepslabel(props.groep.items)
  if (l.soort === 'aantal') return `×${l.aantal}`
  return l.totalen.map((x) => formatHoeveelheid(x.amount, x.unit, locale.value)).join(' + ')
})

function datumTekst(datum: string): string {
  const geformatteerd = formatDatum(datum, locale.value, props.vandaag)
  return isVervallen({ expiresAt: datum }, props.vandaag)
    ? t('inventory.expiredOn', { date: geformatteerd })
    : t('inventory.expiresOn', { date: geformatteerd })
}

// Afstrepen: op de groep met al haar varianten, op één item met alleen dat
// item. Eén variant betekent: niets te kiezen.
const afstrepenOpen = ref(false)
const afstreepVarianten = ref<Variant[]>([])

function afstrepenGroep() {
  afstreepVarianten.value = props.groep.varianten
  afstrepenOpen.value = true
}

function afstrepenItem(item: VoorraadItem) {
  afstreepVarianten.value = varianten([item])
  afstrepenOpen.value = true
}

// Bewerken: vervaldatum, plaats en hoeveelheid van één item.
const bewerkt = ref<string | null>(null)
const bewerking = reactive({
  storagePlaceId: '',
  expiresAt: '',
  amount: 1 as number,
  unit: 'stuk' as VoorraadEenheid,
})
const plaatsOpties = computed(() => props.plaatsen.map((p) => ({ value: p.id, label: p.name })))
const eenheidKeuzes = EENHEDEN.map((e) => ({ value: e, label: e }))

function startBewerken(item: VoorraadItem) {
  bewerking.storagePlaceId = item.storagePlaceId
  bewerking.expiresAt = item.expiresAt ?? ''
  bewerking.amount = item.amount
  bewerking.unit = item.unit
  bewerkt.value = item.id
}

async function bewaarBewerking(item: VoorraadItem) {
  const amount = Number(bewerking.amount)
  if (!(amount > 0)) {
    toast.add({ title: t('inventory.amountPositive'), color: 'error' })
    return
  }
  try {
    await update(item.id, {
      storagePlaceId: bewerking.storagePlaceId,
      expiresAt: bewerking.expiresAt || null,
      amount,
      unit: bewerking.unit,
    })
    bewerkt.value = null
    emit('changed')
  } catch {
    toast.add({ title: t('householdSettings.error'), color: 'error' })
  }
}

// Verwijderen: met een bevestiging, want onomkeerbaar. Bedoeld voor wat er
// nooit had mogen staan, niet voor wat op is (spec §6).
const teVerwijderen = ref<VoorraadItem | null>(null)
const verwijderOpen = computed({
  get: () => teVerwijderen.value !== null,
  set: (waarde: boolean) => {
    if (!waarde) teVerwijderen.value = null
  },
})

async function bevestigVerwijderen() {
  const item = teVerwijderen.value
  if (!item) return
  teVerwijderen.value = null
  try {
    await remove(item.id)
    emit('changed')
  } catch {
    toast.add({ title: t('householdSettings.error'), color: 'error' })
  }
}
</script>

<template>
  <li class="py-3">
    <div class="flex items-start gap-2">
      <button type="button" class="block min-w-0 flex-1 text-left" :aria-expanded="open" @click="open = !open">
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
      <UButton
        icon="i-lucide-check"
        variant="soft"
        class="shrink-0"
        :aria-label="t('inventory.closeNamed', { name: groep.naam })"
        @click="afstrepenGroep"
      />
    </div>

    <ul v-if="open" class="mt-2 space-y-3 border-l border-default pl-3 text-sm">
      <li v-for="item in groep.items" :key="item.id">
        <div v-if="bewerkt !== item.id" class="flex flex-wrap items-center justify-between gap-2">
          <span>
            {{ item.expiresAt ? datumTekst(item.expiresAt) : t('inventory.noExpiry') }}
            <template v-if="item.unit !== 'stuk' || item.amount !== 1"> · {{ formatHoeveelheid(item.amount, item.unit, locale) }}</template>
          </span>
          <div class="flex gap-1">
            <UButton size="xs" variant="soft" @click="afstrepenItem(item)">{{ t('inventory.closeItem') }}</UButton>
            <UButton size="xs" variant="ghost" @click="startBewerken(item)">{{ t('inventory.edit') }}</UButton>
            <UButton size="xs" variant="ghost" color="error" @click="teVerwijderen = item">
              {{ t('inventory.delete') }}
            </UButton>
          </div>
        </div>

        <form v-else class="space-y-2" @submit.prevent="bewaarBewerking(item)">
          <USelect
            v-model="bewerking.storagePlaceId"
            :items="plaatsOpties"
            value-key="value"
            :aria-label="t('inventory.place')"
            class="w-full"
          />
          <UInput v-model="bewerking.expiresAt" type="date" :aria-label="t('inventory.expiresAt')" class="w-full" />
          <div class="flex flex-col gap-2 sm:flex-row">
            <UInput
              v-model.number="bewerking.amount"
              type="number"
              min="0"
              step="any"
              :aria-label="t('inventory.amount')"
              class="w-full sm:flex-1"
            />
            <USelect
              v-model="bewerking.unit"
              :items="eenheidKeuzes"
              value-key="value"
              :aria-label="t('inventory.amountUnit')"
              class="w-full sm:w-auto"
            />
          </div>
          <div class="flex gap-2">
            <UButton type="submit" size="sm">{{ t('inventory.saveItem') }}</UButton>
            <UButton size="sm" variant="ghost" @click="bewerkt = null">{{ t('inventory.cancel') }}</UButton>
          </div>
        </form>
      </li>
    </ul>

    <InventoryCloseModal
      v-model:open="afstrepenOpen"
      :naam="groep.naam"
      :varianten="afstreepVarianten"
      :vandaag="vandaag"
      @afstrepen="(id, reden) => emit('afstrepen', id, groep.naam, reden)"
    />

    <UModal v-model:open="verwijderOpen" :title="t('inventory.deleteTitle')" :description="t('inventory.deleteHelp')">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" @click="teVerwijderen = null">{{ t('inventory.cancel') }}</UButton>
          <UButton color="error" @click="bevestigVerwijderen">{{ t('inventory.delete') }}</UButton>
        </div>
      </template>
    </UModal>
  </li>
</template>
