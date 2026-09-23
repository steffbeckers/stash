import { describe, it, expect } from 'vitest'
import en from '../../i18n/locales/en.json'
import nl from '../../i18n/locales/nl.json'
import fr from '../../i18n/locales/fr.json'

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? flatten(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('locale-bestanden', () => {
  const enKeys = flatten(en).sort()

  it('nl heeft exact dezelfde sleutels als en', () => {
    expect(flatten(nl).sort()).toEqual(enKeys)
  })

  it('fr heeft exact dezelfde sleutels als en', () => {
    expect(flatten(fr).sort()).toEqual(enKeys)
  })

  it('heeft geen lege vertalingen', () => {
    for (const [name, bundle] of [['nl', nl], ['fr', fr], ['en', en]] as const) {
      const empty = flatten(bundle).filter((path) => {
        const value = path.split('.').reduce<unknown>(
          (acc, key) => (typeof acc === 'object' && acc !== null ? (acc as Record<string, unknown>)[key] : undefined),
          bundle as unknown,
        )
        return typeof value === 'string' && value.trim() === ''
      })
      expect(empty, `lege vertalingen in ${name}`).toEqual([])
    }
  })
})
