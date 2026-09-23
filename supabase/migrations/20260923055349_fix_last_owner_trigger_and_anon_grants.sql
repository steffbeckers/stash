-- Fix-ronde op taak 10's review.
--
-- Kritiek: `pg_trigger_depth() = 0` kan niet onderscheiden "het huishouden
-- zelf wordt opgeheven" (lidmaatschap mag mee) van "de account van een lid
-- wordt verwijderd terwijl het huishouden blijft bestaan" (moet geblokkeerd
-- worden zolang het om de laatste eigenaar gaat) — beide zijn geneste
-- cascades op dezelfde triggerdiepte. Via auth.users on delete cascade is dit
-- vandaag al bereikbaar zonder app-code (Supabase Studio's "Delete user",
-- of auth.admin.deleteUser()). De WHEN-clausule wordt vervangen door een
-- check in de functie zelf: bestaat de ouderrij in household nog, dan is dit
-- geen cascade vanuit het huishouden zelf en moet de eigenaarscheck gewoon
-- gelden.
create or replace function prevent_last_owner_removal() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Wordt het huishouden zelf opgeheven, dan is de ouderrij binnen hetzelfde
  -- commando al weg en mag het lidmaatschap mee. Bestaat het huishouden nog,
  -- dan is dit het verwijderen van een lid (rechtstreeks, of via een cascade
  -- zoals het verwijderen van een auth.users-account) en moet er een eigenaar
  -- overblijven. pg_trigger_depth() kan dat onderscheid niet maken: beide
  -- paden zijn geneste cascades.
  if not exists (select 1 from household where id = old.household_id) then
    return old;
  end if;

  if old.role = 'owner' then
    if (
      select count(*) from household_member
      where household_id = old.household_id and role = 'owner'
    ) <= 1 then
      raise exception 'een huishouden moet minstens één eigenaar houden';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_last_owner_removal_trigger on household_member;

create trigger prevent_last_owner_removal_trigger
  before delete on household_member
  for each row execute function prevent_last_owner_removal();

-- Belangrijk: dezelfde klasse gat als create_household zat ook nog op
-- is_household_member/is_household_owner uit taak 6 — erger zelfs, want die
-- kregen in taak 6 helemaal geen revoke. Postgres grant EXECUTE op nieuwe
-- functies standaard aan PUBLIC (dus ook aan anon, los van Supabase's eigen
-- rechtstreekse grant aan anon/authenticated/service_role); "revoke ...
-- from anon" alleen raakt die PUBLIC-grant niet. Zelfde aanpak als taak 8:
-- from public én anon, en authenticated expliciet terug erbij, want RLS-
-- policies roepen deze functies aan als de bevragende rol zelf (authenticated
-- in de app), niet als de eigenaar van een security-definer-functie. Niet
-- uitbuitbaar (beide zijn null-safe tegen auth.uid()), maar functies van
-- dezelfde vorm horen consistent afgesloten te zijn.
revoke all on function is_household_member(uuid) from public, anon;
revoke all on function is_household_owner(uuid) from public, anon;
grant execute on function is_household_member(uuid) to authenticated;
grant execute on function is_household_owner(uuid) to authenticated;
