<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <UContainer class="py-12">
    <h1 class="text-3xl font-bold">{{ t('app.name') }}</h1>
    <p class="mt-2 text-lg text-muted">{{ t('app.tagline') }}</p>
  </UContainer>
</template>
