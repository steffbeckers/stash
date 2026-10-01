-- Wie mag wat met de voorraad. Spec §3 van
-- docs/superpowers/specs/2026-10-01-voorraad-design.md.
--
-- Rechtstreeks schrijven onder RLS, geen RPC's: elke invariant gaat over één
-- rij of over een verwijzing, en het schema dwingt die zelf af. Dus ook geen
-- nieuwe security-definer-functies.

create policy "leden zien de voorraad van hun huishouden"
  on inventory_item for select to authenticated
  using (is_household_member(household_id));

create policy "leden mogen voorraad toevoegen"
  on inventory_item for insert to authenticated
  with check (is_household_member(household_id));

create policy "leden mogen voorraad wijzigen"
  on inventory_item for update to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "leden mogen voorraad verwijderen"
  on inventory_item for delete to authenticated
  using (is_household_member(household_id));

-- Rechten per kolom. Wat er níet staat, is de bedoeling:
-- - insert zonder status en closed_*: een item begint altijd in voorraad;
-- - update zonder household_id: een item verhuist nooit naar een ander
--   huishouden, ook niet door iemand die lid is van beide;
-- - closed_at en closed_by nergens: die vult de trigger uit de volgende
--   migratie in, en de client kan niet beweren dat iemand anders afstreepte.
grant select, delete on inventory_item to authenticated;
grant insert (household_id, product_id, storage_place_id,
              amount, unit, acquired_at, expires_at)
  on inventory_item to authenticated;
grant update (product_id, storage_place_id, amount, unit,
              acquired_at, expires_at, status, closed_reason)
  on inventory_item to authenticated;
