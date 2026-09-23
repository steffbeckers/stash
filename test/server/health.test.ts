import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('health endpoint', async () => {
  // `dev: true` is niet optioneel. Zonder die vlag bouwt @nuxt/test-utils een
  // productiebundel, en die draait op de cloudflare_module-preset uit
  // nuxt.config.ts. Die bundel importeert __STATIC_CONTENT_MANIFEST, een
  // pakket dat alleen binnen de Workers-runtime bestaat, dus Node struikelt er
  // met ERR_MODULE_NOT_FOUND over voordat de server ooit luistert:
  //
  //   Server process exited before becoming ready (exit code: 1, mode: built)
  //   Cannot find package '__STATIC_CONTENT_MANIFEST'
  //
  // In dev-modus draait Nitro gewoon op Node en gaat de test wel op. Nagegaan
  // door de vlag weg te halen, niet aangenomen.
  await setup({ server: true, dev: true })

  it('geeft status ok terug', async () => {
    const res = await $fetch<{ status: string; version: string }>('/api/health')
    expect(res.status).toBe('ok')
  })

  it('geeft een versie terug', async () => {
    const res = await $fetch<{ status: string; version: string }>('/api/health')
    expect(typeof res.version).toBe('string')
    expect(res.version.length).toBeGreaterThan(0)
  })
})
