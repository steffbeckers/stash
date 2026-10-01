<script setup lang="ts">
import { formatDatum, isVervallen, type VoorraadItem } from '~/utils/voorraad'

defineProps<{ items: VoorraadItem[]; vandaag: string }>()
const { t, locale } = useI18n()
</script>

<template>
  <!-- Een section met aria-labelledby is een region met die naam: zo vindt
       e2e/inventory.spec.ts de strook, en een schermlezer ook. -->
  <section aria-labelledby="vervalt-binnenkort">
    <h2 id="vervalt-binnenkort" class="text-lg font-semibold">{{ t('inventory.expiringSoon') }}</h2>
    <ul class="mt-2 divide-y divide-default">
      <li v-for="item in items" :key="item.id" class="flex items-center justify-between gap-2 py-2">
        <span class="min-w-0 truncate">{{ item.naam }}</span>
        <UBadge :color="isVervallen(item, vandaag) ? 'error' : 'warning'" variant="subtle" class="shrink-0">
          {{
            isVervallen(item, vandaag)
              ? t('inventory.expiredOn', { date: formatDatum(item.expiresAt!, locale, vandaag) })
              : t('inventory.expiresOn', { date: formatDatum(item.expiresAt!, locale, vandaag) })
          }}
        </UBadge>
      </li>
    </ul>
  </section>
</template>
