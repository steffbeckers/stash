import type { Bewaarplaats, Reden, VoorraadEenheid, VoorraadItem } from '~/utils/voorraad'

export interface Toevoeging {
  householdId: string
  productId: string
  storagePlaceId: string
  aantal: number
  amount: number
  unit: VoorraadEenheid
  acquiredAt: string
  expiresAt: string | null
}

export interface Itemwijziging {
  storagePlaceId: string
  expiresAt: string | null
  amount: number
  unit: VoorraadEenheid
}

/**
 * De voorraad, clientzijdig.
 *
 * Rechtstreeks op de tabel onder RLS, geen RPC's (spec §2). Elke schrijfactie
 * blijft binnen de kolommen die 20261001100100_inventory_item_rechten.sql
 * toestaat; een kolom daarbuiten geeft "permission denied", geen stille nul.
 *
 * Geen useState, zoals useProducts: de voorraad hoort bij de pagina die hem
 * toont, en wordt na elke eigen actie opnieuw opgehaald.
 */
export function useInventory() {
  const supabase = useSupabaseClient()
  const { locale } = useI18n()

  async function load(householdId: string): Promise<VoorraadItem[]> {
    const { data, error } = await supabase.rpc('voorraad', {
      target_household: householdId,
      voorkeurstaal: locale.value,
    })
    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id,
      productId: r.product_id,
      naam: r.naam,
      getoondeTaal: r.getoonde_taal,
      merk: r.merk,
      // voorraad() geeft alleen in_stock-items, en de samenhangcheck eist daar
      // een plaats. De kolom zelf is nullable, dus de cast zegt wat het schema
      // al garandeert.
      storagePlaceId: r.storage_place_id as string,
      // numeric komt via PostgREST als getal, maar dat is een eigenschap van
      // de serialisatie, niet van het type; Number() maakt het expliciet.
      amount: Number(r.amount),
      unit: r.unit as VoorraadEenheid,
      acquiredAt: r.acquired_at,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }))
  }

  async function loadPlaces(householdId: string): Promise<Bewaarplaats[]> {
    const { data, error } = await supabase
      .from('storage_place')
      .select('id, name, kind')
      .eq('household_id', householdId)
      // create_household() maakt drie plaatsen in één statement, dus met
      // dezelfde created_at. id als tweede sleutel houdt de volgorde vast.
      .order('created_at')
      .order('id')
    if (error) throw error
    return (data ?? []).map((r) => ({ ...r, kind: r.kind as Bewaarplaats['kind'] }))
  }

  async function add(t: Toevoeging): Promise<void> {
    const rijen = Array.from({ length: t.aantal }, () => ({
      household_id: t.householdId,
      product_id: t.productId,
      storage_place_id: t.storagePlaceId,
      amount: t.amount,
      unit: t.unit,
      acquired_at: t.acquiredAt,
      expires_at: t.expiresAt,
    }))
    // Eén insert met N rijen is één statement: alles of niets.
    const { error } = await supabase.from('inventory_item').insert(rijen)
    if (error) throw error
  }

  /**
   * Streept af. Het filter op status maakt dit idempotent (spec §7): was
   * iemand je voor, dan raakt de update nul rijen en geeft dit false.
   * Bewezen in test/db/inventory.test.ts, "afstrepen is idempotent".
   */
  async function close(id: string, reden: Reden): Promise<boolean> {
    const { data, error } = await supabase
      .from('inventory_item')
      .update({ status: 'closed', closed_reason: reden })
      .eq('id', id)
      .eq('status', 'in_stock')
      .select('id')
    if (error) throw error
    return (data ?? []).length === 1
  }

  /**
   * Ongedaan maken. De trigger wist closed_at, closed_by en closed_reason.
   * Is de plaats intussen weg, dan gooit dit de samenhangfout — herken die
   * met isSamenhangFout().
   */
  async function reopen(id: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('inventory_item')
      .update({ status: 'in_stock' })
      .eq('id', id)
      .eq('status', 'closed')
      .select('id')
    if (error) throw error
    return (data ?? []).length === 1
  }

  async function update(id: string, w: Itemwijziging): Promise<void> {
    const { error } = await supabase
      .from('inventory_item')
      .update({
        storage_place_id: w.storagePlaceId,
        expires_at: w.expiresAt,
        amount: w.amount,
        unit: w.unit,
      })
      .eq('id', id)
    if (error) throw error
  }

  async function remove(id: string): Promise<void> {
    const { error } = await supabase.from('inventory_item').delete().eq('id', id)
    if (error) throw error
  }

  return { load, loadPlaces, add, close, reopen, update, remove }
}
