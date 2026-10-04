import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { metTermijn } from '../../app/utils/termijn'

const SUPABASE = 'https://abc.supabase.co'

/** Een fetch die nooit antwoordt, maar wel afbreekt op het signaal dat ze krijgt. */
function hangendeFetch() {
  const aanroepen: { invoer: RequestInfo | URL; init: RequestInit | undefined }[] = []
  const fetch = ((invoer: RequestInfo | URL, init?: RequestInit) => {
    aanroepen.push({ invoer, init })
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })
  }) as typeof globalThis.fetch
  return { fetch, aanroepen }
}

/** Het signaal dat de omwikkelde fetch kreeg bij aanroep i. */
function signaal(aanroepen: { init: RequestInit | undefined }[], i = 0): AbortSignal {
  const s = aanroepen[i]?.init?.signal
  if (!s) throw new Error(`aanroep ${i} kreeg geen signaal`)
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('metTermijn', () => {
  // AbortError en geen TimeoutError: postgrest-js herhaalt een AbortError
  // nooit, een TimeoutError bij een GET wel, tot drie keer.
  it('breekt een Supabase-verzoek af na de termijn, met een AbortError', async () => {
    const { fetch, aanroepen } = hangendeFetch()
    const verzoek = metTermijn(fetch, SUPABASE, 100)(`${SUPABASE}/rest/v1/inventory_item`, { method: 'PATCH' })
    verzoek.catch(() => {})

    await vi.advanceTimersByTimeAsync(99)
    expect(signaal(aanroepen).aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signaal(aanroepen).aborted).toBe(true)
    await expect(verzoek).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('laat een verzoek naar een andere host ongemoeid', async () => {
    const { fetch, aanroepen } = hangendeFetch()
    const init: RequestInit = { method: 'GET' }
    void metTermijn(fetch, SUPABASE, 100)('https://elders.example/x', init).catch(() => {})

    await vi.advanceTimersByTimeAsync(1000)
    expect(aanroepen[0]!.init).toBe(init)
    expect(init.signal).toBeUndefined()
  })

  it('breekt af als de aanroeper zelf afbreekt', async () => {
    const { fetch, aanroepen } = hangendeFetch()
    const eigen = new AbortController()
    void metTermijn(fetch, SUPABASE, 100)(`${SUPABASE}/rest/v1/x`, { signal: eigen.signal }).catch(() => {})

    eigen.abort()
    expect(signaal(aanroepen).aborted).toBe(true)
  })

  it('breekt meteen af als het signaal van de aanroeper al afgebroken was', () => {
    const { fetch, aanroepen } = hangendeFetch()
    const eigen = new AbortController()
    eigen.abort()
    void metTermijn(fetch, SUPABASE, 100)(`${SUPABASE}/rest/v1/x`, { signal: eigen.signal }).catch(() => {})

    expect(signaal(aanroepen).aborted).toBe(true)
  })

  // De herhaallus van @nuxtjs/supabase kijkt naar zijn eigen init.signal.
  it('zet het nieuwe signaal op het init-object, zodat een herhaallus het ziet', async () => {
    const { fetch, aanroepen } = hangendeFetch()
    const init: RequestInit = { method: 'POST' }
    void metTermijn(fetch, SUPABASE, 100)(`${SUPABASE}/rest/v1/rpc/voorraad`, init).catch(() => {})

    expect(init.signal).toBe(signaal(aanroepen))
    await vi.advanceTimersByTimeAsync(100)
    expect(init.signal!.aborted).toBe(true)
  })

  it('herkent een Request als invoer', async () => {
    const { fetch, aanroepen } = hangendeFetch()
    void metTermijn(fetch, SUPABASE, 100)(new Request(`${SUPABASE}/auth/v1/token`)).catch(() => {})

    await vi.advanceTimersByTimeAsync(100)
    expect(signaal(aanroepen).aborted).toBe(true)
  })

  it('volgt het signaal van een Request', () => {
    const { fetch, aanroepen } = hangendeFetch()
    const eigen = new AbortController()
    void metTermijn(fetch, SUPABASE, 100)(new Request(`${SUPABASE}/rest/v1/x`, { signal: eigen.signal })).catch(() => {})

    eigen.abort()
    expect(signaal(aanroepen).aborted).toBe(true)
  })
})
