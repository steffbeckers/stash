<script setup lang="ts">
// Tot nu toe koos `detectBrowserLanguage` de taal, en alleen op `/`
// (`redirectOn: 'root'` in nuxt.config.ts). Wie via een uitnodigingslink
// binnenkwam kreeg dus de taal van de afzender en had geen enkele manier om
// dat te veranderen. Vandaar dat deze schakelaar buiten `v-if="user"` staat:
// een genodigde die nog geen account heeft is precies de gebruiker die hem
// het hardst nodig heeft.
const { t, locale, locales } = useI18n()
const switchLocalePath = useSwitchLocalePath()

// switchLocalePath() geeft het pad van de huidige route in een andere taal, dus
// je blijft staan waar je bent in plaats van naar de startpagina te vallen.
const opties = computed(() =>
  locales.value.map((l) => ({
    code: l.code,
    naam: l.name ?? l.code,
    pad: switchLocalePath(l.code),
  })),
)
</script>

<template>
  <nav :aria-label="t('nav.language')" class="flex items-center gap-1">
    <NuxtLink
      v-for="optie in opties"
      :key="optie.code"
      :to="optie.pad"
      :title="optie.naam"
      :aria-current="optie.code === locale ? 'true' : undefined"
      class="rounded px-2 py-1 text-sm uppercase transition-colors"
      :class="
        optie.code === locale
          ? 'font-semibold text-highlighted'
          : 'text-muted hover:text-default'
      "
    >
      {{ optie.code }}
    </NuxtLink>
  </nav>
</template>
