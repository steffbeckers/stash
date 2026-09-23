import { hasProtocol } from 'ufo'

/**
 * Geeft het pad terug als het veilig intern is, anders null.
 *
 * Een handgeschreven prefixcontrole volstaat hier niet: `/\evil.example`
 * begint met één slash en niet met twee, maar een browser behandelt hem als
 * protocol-relatief. Hetzelfde geldt voor een tab tussen de slashes. ufo's
 * hasProtocol kent die vormen, en navigateTo gebruikt dezelfde functie om
 * externe navigatie te weigeren — dus deze controle en die van Nuxt kunnen
 * niet uit elkaar lopen.
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/')) return null
  if (hasProtocol(value, { acceptRelative: true })) return null
  return value
}
