/**
 * De eenheidsopties en de inhoud/eenheid-koppeling van een product.
 *
 * Gedeeld door app/pages/products/new.vue en app/pages/products/[id].vue —
 * beide formulieren hadden hier voorheen een letterlijk gedupliceerde
 * `eenheden`-computed, en allebei dezelfde ontbrekende validatie: de
 * check-constraint product_inhoud_en_eenheid eist (net_content is null) =
 * (unit is null), maar niets in de UI hield de twee velden functioneel
 * gekoppeld — alleen in layout (fix 2 van de eindreview).
 */

/**
 * Sentinelwaarde voor "geen eenheid" in de USelect-itemlijst.
 *
 * Niet de voor de hand liggende lege string: Reka UI's <SelectItem> gooit
 * zelf een fout zodra value="" — "A <SelectItem /> must have a value prop
 * that is not an empty string. This is because the Select value can be set
 * to an empty string to clear the selection and show the placeholder."
 * (node_modules/reka-ui/dist/Select/SelectItem.js, nagelezen in de bron).
 * "" is daar dus intern gereserveerd en mag niet als een echt item-value
 * gebruikt worden. Vandaar deze losse sentinel.
 */
export const GEEN_EENHEID = '__geen_eenheid__'

export interface EenheidOptie {
  value: string
  label: string
}

const EENHEID_WAARDEN = ['ml', 'g', 'stuk'] as const

/**
 * De keuzelijst voor USelect, met een lege optie vooraan.
 *
 * Zonder die optie kan een eenmaal gekozen eenheid niet meer teruggezet
 * worden naar "niets": USelect heeft hier geen eigen wis-knop (geverifieerd
 * tegen Select.vue — geen clearable-prop, geen clear-icoon in de template).
 * Op app/pages/products/[id].vue kon een product met inhoud én eenheid die
 * twee daardoor nooit meer kwijtraken via de UI.
 */
export function eenheidOpties(leegLabel: string): EenheidOptie[] {
  return [
    { value: GEEN_EENHEID, label: leegLabel },
    ...EENHEID_WAARDEN.map((value) => ({ value, label: value })),
  ]
}

export interface InhoudEenheid {
  netContent: number | null
  unit: string | null
}

/**
 * Normaliseert en bewaakt het paar vóór een create_product/update_product-
 * aanroep. Geeft `null` terug wanneer het paar de check-constraint
 * product_inhoud_en_eenheid zou schenden — de aanroeper toont dan vooraf een
 * gerichte foutmelding in plaats van de RPC te laten stukbreken op een
 * generieke "dat is mislukt".
 *
 * Twee redenen waarom dit meer is dan een kale null-check:
 * - `@nuxt/ui`'s Input past looseToNumber toe zodra `type="number"`, en die
 *   geeft bij een NaN-parse de OORSPRONKELIJKE waarde terug in plaats van
 *   NaN (node_modules/@nuxt/ui/dist/runtime/utils/index.js). Een geleegd
 *   getalveld zet `inhoud` dus op `''`, niet op `null` — ondanks het
 *   `number | null`-type van de ref. PostgREST faalt op het casten van `''`
 *   naar numeric, met dezelfde ondoorzichtige foutmelding.
 * - `eenheid` en `inhoud` zijn in de UI alleen via layout gekoppeld: niets
 *   hield tegen dat de een gevuld raakte zonder de ander.
 */
export function valideerInhoudEenheid(
  inhoud: number | null,
  eenheid: string | undefined,
): InhoudEenheid | null {
  const netContent = inhoud === null || (inhoud as unknown) === '' ? null : inhoud
  const unit = eenheid && eenheid !== GEEN_EENHEID ? eenheid : null
  if ((netContent === null) !== (unit === null)) return null
  return { netContent, unit }
}
