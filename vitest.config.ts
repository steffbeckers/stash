import { defineConfig } from 'vitest/config'

// health.test.ts uses @nuxt/test-utils/e2e (setup + $fetch against a real
// running server), not @nuxt/test-utils/runtime component mounting. Per
// https://nuxt.com/docs/4.x/getting-started/testing, e2e tests must be a
// regular `environment: 'node'` project and must NOT use defineVitestConfig
// or defineVitestProject from @nuxt/test-utils/config — those are for
// Nuxt client-environment (component/unit) tests only and, combined with
// e2e's setup(), break test-file bundling (see
// https://github.com/nuxt/test-utils/issues/1490).
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['test/db/**', 'node_modules/**', 'e2e/**'],
  },
})
