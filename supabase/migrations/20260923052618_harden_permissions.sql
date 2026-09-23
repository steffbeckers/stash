-- Een update-policy werkt op rijniveau, niet op kolomniveau. Zonder deze
-- trigger kan een gebruiker via zijn eigen profiel zijn rol opschroeven.
create function protect_profile_privileges() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- auth.uid() is null bij de service-role en bij migraties; daar mag het wel.
  -- Is er een ingelogde gebruiker, dan is dit per definitie een poging van
  -- iemand die zijn eigen rechten wil opschroeven.
  if auth.uid() is not null then
    if new.trust_level is distinct from old.trust_level then
      raise exception 'vertrouwensniveau is niet zelf te wijzigen';
    end if;
    if new.role is distinct from old.role then
      raise exception 'rol is niet zelf te wijzigen';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_privileges_trigger
  before update on user_profile
  for each row execute function protect_profile_privileges();

-- Een huishouden zonder eigenaar is niet meer te beheren: geen uitnodigingen,
-- geen hernoemen, geen opheffen.
create function prevent_last_owner_removal() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
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

-- `when (pg_trigger_depth() = 0)` laat de trigger alleen afgaan op een directe
-- delete. Zonder deze clausule blokkeert hij ook de cascade vanuit
-- `household on delete cascade`, die de laatste eigenaarsrij verwijdert
-- terwijl er nog maar één is: precies dan hoort de trigger niets te doen.
create trigger prevent_last_owner_removal_trigger
  before delete on household_member
  for each row when (pg_trigger_depth() = 0) execute function prevent_last_owner_removal();

-- `revoke all ... from public` haalt Supabase's eigen directe grant aan anon
-- er niet af. Taak 8 ontdekte dat met een has_function_privilege-test:
-- create_invite en accept_invite staan goed, create_household uit taak 7 niet.
-- Niet uitbuitbaar, want de functie weigert zonder ingelogde gebruiker, maar
-- de verdediging in de diepte werkt niet zoals bedoeld en het is inconsistent
-- met de rest.
revoke execute on function create_household(text) from anon;
