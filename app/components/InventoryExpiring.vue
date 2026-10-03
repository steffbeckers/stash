<script setup lang="ts">
import { formatDatum, groepeerStrook, isVervallen, type VoorraadItem } from '~/utils/voorraad'

const props = defineProps<{ items: VoorraadItem[]; vandaag: string }>()
const { t, locale } = useI18n()

// Drie potten met dezelfde datum zijn één rij met ×3, niet drie gelijke rijen.
const rijen = computed(() => groepeerStrook(props.items))
</script>

<template>
  <!-- Een section met aria-labelledby is een region met die naam: zo vindt
       e2e/inventory.spec.ts de strook, en een schermlezer ook. -->
  <section aria-labelledby="vervalt-binnenkort">
    <h2 id="vervalt-binnenkort" class="text-lg font-semibold">{{ t('inventory.expiringSoon') }}</h2>
    <ul class="mt-2 divide-y divide-default">
      <li v-for="rij in rijen" :key="rij.sleutel" class="flex items-center justify-between gap-2 py-2">
        <span class="min-w-0 truncate">
          {{ rij.naam }}<span v-if="rij.aantal > 1" class="ml-1 text-muted">×{{ rij.aantal }}</span>
        </span>
        <UBadge :color="isVervallen(rij, vandaag) ? 'error' : 'warning'" variant="subtle" class="shrink-0">
          {{
            isVervallen(rij, vandaag)
              ? t('inventory.expiredOn', { date: formatDatum(rij.expiresAt, locale, vandaag) })
              : t('inventory.expiresOn', { date: formatDatum(rij.expiresAt, locale, vandaag) })
          }}
        </UBadge>
      </li>
    </ul>
  </section>
</template>
