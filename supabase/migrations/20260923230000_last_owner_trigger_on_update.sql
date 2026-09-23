-- De laatste-eigenaartrigger dekte alleen DELETE. Een UPDATE die de rol van de
-- enige eigenaar op 'member' zet, of die hem naar een ander huishouden
-- verplaatst, laat exact hetzelfde onbestuurbare huishouden achter: geen
-- uitnodigingen, geen hernoemen, geen opheffen.
--
-- Vandaag is dat pad onbereikbaar omdat household_member geen UPDATE-policy
-- heeft. Dat is bescherming door afwezigheid: ze verdwijnt stil zodra iemand
-- de promoveer-route uit spec §4 toevoegt. De invariant hoort in de trigger,
-- niet in het toeval dat er nog geen policy is.

create or replace function prevent_last_owner_removal() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  loses_ownership boolean;
begin
  -- Gaat het huishouden zelf weg, dan mag de cascade zijn werk doen; een
  -- eigenaarloze rest bestaat dan per definitie niet meer. Zie de fix in
  -- 20260923055349: dit vangt óók de cascade vanuit auth.users, die met
  -- pg_trigger_depth() niet van de vorige te onderscheiden was.
  if not exists (select 1 from household where id = old.household_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    loses_ownership := old.role = 'owner';
  else
    -- Een UPDATE raakt de invariant alleen als deze rij ophoudt eigenaar van
    -- dít huishouden te zijn: rol omlaag, of verhuisd naar een ander.
    loses_ownership := old.role = 'owner'
                       and (new.role is distinct from 'owner'
                            or new.household_id is distinct from old.household_id);
  end if;

  if loses_ownership then
    -- BEFORE-trigger: de wijziging is nog niet toegepast, dus dit telt de
    -- eigenaars inclusief degene die nu vertrekt.
    if (select count(*) from household_member
        where household_id = old.household_id and role = 'owner') <= 1 then
      raise exception 'een huishouden moet minstens één eigenaar houden';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists prevent_last_owner_removal_trigger on household_member;

create trigger prevent_last_owner_removal_trigger
  before delete or update on household_member
  for each row execute function prevent_last_owner_removal();

comment on function prevent_last_owner_removal() is
  'Bewaakt dat elk bestaand huishouden minstens één eigenaar houdt, bij zowel '
  'DELETE als UPDATE. Blijft security definer: de telling moet alle eigenaars '
  'zien, ook die welke RLS voor de aanroeper zou wegfilteren.';
