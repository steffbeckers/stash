-- Wie streepte af, en wanneer? Dat bepaalt de database, niet de client: de
-- kolomrechten uit de vorige migratie houden closed_at en closed_by buiten
-- bereik, en deze trigger vult ze in. Spec §3.
--
-- security invoker: de trigger leest niets dat de aanroeper niet al mag zien,
-- en auth.uid() werkt in beide varianten. Zelfde afweging als
-- prevent_last_translation_removal().
create function stamp_inventory_item_closure() returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
begin
  if old.status = 'in_stock' and new.status = 'closed' then
    new.closed_at := now();
    new.closed_by := auth.uid();
  elsif old.status = 'closed' and new.status = 'in_stock' then
    -- Ongedaan maken: alle drie weg, ook de reden, anders faalt de
    -- samenhangcheck op een item in voorraad met een reden.
    new.closed_at := null;
    new.closed_by := null;
    new.closed_reason := null;
  end if;
  -- closed -> closed: bewust niets. Een referentiële actie is ook een update:
  -- on delete set null op closed_by (een verwijderd account) en op
  -- storage_place_id (een verwijderde plaats) komen hier langs. Wie hier de
  -- oude stempels terugzet, draait die acties stil terug.
  return new;
end;
$$;

create trigger stamp_inventory_item_closure_trigger
  before update on inventory_item
  for each row execute function stamp_inventory_item_closure();

-- Triggerfuncties zijn er alleen voor de trigger. Zelfde behandeling als in
-- 20260924180000_revoke_trigger_function_grants.sql.
revoke all on function stamp_inventory_item_closure() from public, anon, authenticated;
