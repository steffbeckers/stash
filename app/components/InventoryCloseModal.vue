<script setup lang="ts">
import { formatDatum, formatHoeveelheid, isVervallen, type Reden, type Variant } from '~/utils/voorraad'

const props = defineProps<{ naam: string; varianten: Variant[]; vandaag: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ afstrepen: [itemId: string, reden: Reden] }>()
const { t, locale } = useI18n()

const gekozen = ref<string | null>(null)
// Elke keer dat de vraag opent, staat er niets geselecteerd (spec §6): wie
// afstreept, moet zien dat er nog een oudere ligt.
watch(open, (isOpen) => {
  if (isOpen) gekozen.value = null
})

const uitwisselbaar = computed(() => props.varianten.length === 1)
const variant = computed(() =>
  uitwisselbaar.value ? props.varianten[0] : props.varianten.find((v) => v.sleutel === gekozen.value),
)

function variantLabel(v: Variant): string {
  const delen = [
    v.expiresAt ? formatDatum(v.expiresAt, locale.value, props.vandaag) : t('inventory.noExpiry'),
    `×${v.items.length}`,
  ]
  if (v.unit !== 'stuk' || v.amount !== 1) delen.push(formatHoeveelheid(v.amount, v.unit, locale.value))
  if (isVervallen(v, props.vandaag)) delen.push(t('inventory.expired'))
  return delen.join(' · ')
}

function kies(reden: Reden) {
  // Tijdens de sluitanimatie staan de knoppen er nog: een tweede klik zou
  // een tweede close() geven en een onterechte "al afgestreept"-melding.
  if (!open.value) return
  const v = variant.value
  if (!v) return
  // items[0] is de oudste: bij uitwisselbare items maakt de keuze niets uit,
  // maar een vaste uitkomst is beter dan een willekeurige.
  emit('afstrepen', v.items[0]!.id, reden)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="t('inventory.closeTitle', { name: naam })">
    <template #body>
      <fieldset v-if="!uitwisselbaar">
        <legend class="font-medium">{{ t('inventory.whichOne') }}</legend>
        <div class="mt-2 space-y-2">
          <label v-for="v in varianten" :key="v.sleutel" class="flex items-center gap-2">
            <input v-model="gekozen" type="radio" name="variant" :value="v.sleutel">
            <span :class="isVervallen(v, vandaag) ? 'text-error' : ''">{{ variantLabel(v) }}</span>
          </label>
        </div>
      </fieldset>
      <p v-else class="text-muted">{{ t('inventory.closeQuestion') }}</p>
    </template>
    <template #footer>
      <div class="flex w-full flex-col gap-2 sm:flex-row">
        <UButton :disabled="!variant" class="justify-center sm:flex-1" @click="kies('consumed')">
          {{ t('inventory.consumed') }}
        </UButton>
        <UButton
          :disabled="!variant"
          color="error"
          variant="soft"
          class="justify-center sm:flex-1"
          @click="kies('discarded')"
        >
          {{ t('inventory.discarded') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
