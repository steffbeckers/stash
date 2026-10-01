export interface Zoekresultaat {
  productId: string
  naam: string
  getoondeTaal: string
  merk: string | null
  netContent: number | null
  unit: string | null
  gtin: string | null
  status: string
}

export interface ProductVertaling {
  locale: string
  name: string
  source: string
}

export interface ProductDetail {
  id: string
  gtin: string | null
  brand: string | null
  netContent: number | null
  unit: string | null
  status: string
  createdBy: string | null
  vertalingen: ProductVertaling[]
}

export interface ProductInvoer {
  gtin: string | null
  brand: string | null
  netContent: number | null
  unit: string | null
}

/**
 * De catalogus, clientzijdig.
 *
 * Bewust geen useState: anders dan het profiel of het actieve huishouden is
 * een zoekresultaat niets om vast te houden — het verandert bij elke
 * toetsaanslag en hoort bij de pagina, niet bij de sessie.
 *
 * Elke schrijfactie gaat door een RPC. Er is geen insert- of update-policy op
 * product, dus een rechtstreekse tabelbewerking zou hier stil nul rijen raken.
 */
export function useProducts() {
  const supabase = useSupabaseClient()
  const { locale } = useI18n()

  async function search(zoekterm: string, maximum = 20): Promise<Zoekresultaat[]> {
    const { data, error } = await supabase.rpc('search_products', {
      zoekterm,
      voorkeurstaal: locale.value,
      maximum,
    })
    if (error) throw error
    return (data ?? []).map((r) => ({
      productId: r.product_id,
      naam: r.naam,
      getoondeTaal: r.getoonde_taal,
      merk: r.merk,
      netContent: r.net_content === null ? null : Number(r.net_content),
      unit: r.unit,
      gtin: r.gtin,
      status: r.status,
    }))
  }

  async function load(id: string): Promise<ProductDetail | null> {
    const { data, error } = await supabase
      .from('product')
      .select('id, gtin, brand, net_content, unit, status, created_by')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    const { data: namen, error: naamError } = await supabase
      .from('product_translation')
      .select('locale, name, source')
      .eq('product_id', id)
      .order('locale')
    if (naamError) throw naamError

    return {
      id: data.id,
      gtin: data.gtin,
      brand: data.brand,
      netContent: data.net_content === null ? null : Number(data.net_content),
      unit: data.unit,
      status: data.status,
      createdBy: data.created_by,
      vertalingen: namen ?? [],
    }
  }

  async function create(invoer: ProductInvoer & { locale: string, name: string }): Promise<string> {
    const { data, error } = await supabase.rpc('create_product', {
      // De gegenereerde Args-types van elke RPC in database.types.ts kennen
      // geen `| null` voor IN-parameters (geverifieerd: geen enkele functie
      // in dat bestand heeft dat, ook niet die van Taak 2) — Postgres kent
      // geen NOT NULL op functieparameters, dus de generator laat
      // nulbaarheid daar gewoon weg. product.gtin/brand/net_content/unit
      // zijn wél nullable kolommen (zie de Row-types), dus dit is een
      // onnauwkeurigheid van de generator, geen echte contractbreuk. Opnieuw
      // genereren verandert er niets aan.
      gtin: invoer.gtin as string,
      brand: invoer.brand as string,
      net_content: invoer.netContent as number,
      unit: invoer.unit as string,
      locale: invoer.locale,
      name: invoer.name,
    })
    if (error) throw error
    return data as string
  }

  async function update(id: string, invoer: ProductInvoer): Promise<void> {
    const { error } = await supabase.rpc('update_product', {
      target_product: id,
      // Zelfde reden als bij create_product hierboven.
      gtin: invoer.gtin as string,
      brand: invoer.brand as string,
      net_content: invoer.netContent as number,
      unit: invoer.unit as string,
    })
    if (error) throw error
  }

  async function setTranslation(id: string, taal: string, naam: string): Promise<void> {
    const { error } = await supabase.rpc('set_product_translation', {
      target_product: id,
      locale: taal,
      name: naam,
    })
    if (error) throw error
  }

  async function removeTranslation(id: string, taal: string): Promise<void> {
    const { error } = await supabase.rpc('remove_product_translation', {
      target_product: id,
      locale: taal,
    })
    if (error) throw error
  }

  return { search, load, create, update, setTranslation, removeTranslation }
}
