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

// `locale: false` is hier niet optioneel.
//
// ULink haalt zijn `to` standaard nog een keer door $localePath, met de
// *huidige* taal (node_modules/@nuxt/ui/dist/runtime/components/Link.vue).
// Een pad dat al met /nl of /fr begint laat hij met rust, maar de
// standaardtaal krijgt geen prefix — dus /confirm werd alsnog omgezet naar
// /nl/bevestigen, en de Engelse optie wees terug naar de pagina waar je al
// stond. Nederlands en Frans leken daardoor te werken.
//
// switchLocalePath() levert het juiste pad; `locale: false` zorgt dat het
// blijft staan. Het alternatief (`locale: l.code` en het kale pad doorgeven)
// werkt ook, maar dan bepaalt ULink de vertaling en wij niet.
const items = computed(() => [
  locales.value.map((l) => ({
    label: l.name ?? l.code,
    to: switchLocalePath(l.code),
    locale: false as const,
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
