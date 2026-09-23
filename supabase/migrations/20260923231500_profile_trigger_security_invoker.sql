-- protect_profile_privileges() stond als security definer, maar doet niets
-- waarvoor dat nodig is: de functie vergelijkt alleen velden van NEW en OLD en
-- bevraagt geen enkele tabel. Definer-rechten zijn hier dus puur extra
-- aanvalsoppervlak — een toekomstige uitbreiding van deze functie zou stil met
-- eigenaarsrechten draaien.
--
-- Tegenstelling met prevent_last_owner_removal(), die definer *wel* nodig
-- heeft: die telt eigenaars en moet daarbij rijen zien die RLS voor de
-- aanroeper zou wegfilteren.
--
-- `create or replace` behoudt de bestaande rechten en de trigger die er al aan
-- hangt; er is dus geen drop/create van de trigger nodig.
create or replace function protect_profile_privileges() returns trigger
  language plpgsql
  security invoker
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
