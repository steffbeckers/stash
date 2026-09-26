/**
 * De letters die de avatar toont.
 *
 * Geeft `null` in plaats van een lege string wanneer er geen bruikbare naam
 * is. De avatar valt dan terug op een icoon; een lege string zou als een
 * lege cirkel renderen en er kapot uitzien.
 *
 * `[...woord][0]` en niet `woord[0]`: een naam die met een teken buiten het
 * basisvlak begint (een surrogaatpaar) zou anders op een halve code-eenheid
 * worden afgekapt.
 */
export function initials(name: string | null | undefined): string | null {
  const woorden = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (woorden.length === 0) return null
  return woorden
    .slice(0, 2)
    .map((woord) => [...woord][0]!.toLocaleUpperCase())
    .join('')
}
