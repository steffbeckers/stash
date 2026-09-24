<script setup lang="ts">
// Tot deze schakelaar bestond koos `detectBrowserLanguage` de taal, en alleen
// op `/` (`redirectOn: 'root'` in nuxt.config.ts). Wie via een
// uitnodigingslink binnenkwam kreeg dus de taal van de afzender en had geen
// enkele manier om dat te veranderen. Vandaar dat dit component buiten
// `v-if="user"` in app.vue staat: een genodigde die nog geen account heeft is
// precies de gebruiker die het het hardst nodig heeft.
const { t, locale, locales } = useI18n()
const switchLocalePath = useSwitchLocalePath()

const huidige = computed(() => locales.value.find((l) => l.code === locale.value))

// Gewone items met een `to`, bewust geen `type: 'checkbox'`. Die variant
// rendert als `menuitemcheckbox` — een schakelaar die zijn `to` negeert, dus
// er gebeurde niets bij het klikken. Zo blijven het echte links: rechtsklikken
// en openen in een nieuw tabblad werkt, en de actieve taal krijgt een vinkje
// in plaats van een ander element te zijn.
//
// switchLocalePath() geeft het pad van de huidige route in een andere taal,
// dus je blijft staan waar je bent in plaats van naar de startpagina te vallen.
const items = computed(() => [
  locales.value.map((l) => ({
    label: l.name ?? l.code,
    to: switchLocalePath(l.code),
    trailingIcon: l.code === locale.value ? 'i-lucide-check' : undefined,
  })),
])
</script>

<template>
  <UDropdownMenu :items="items" :ui="{ content: 'w-44' }">
    <UButton
      :aria-label="t('nav.language')"
      size="sm"
      variant="ghost"
      color="neutral"
      icon="i-lucide-languages"
      trailing-icon="i-lucide-chevron-down"
    >
      {{ huidige?.name ?? locale }}
    </UButton>
  </UDropdownMenu>
</template>
