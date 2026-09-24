-- Spec §4: een huishouden houdt altijd minstens één eigenaar, en de laatste
-- eigenaar kan pas weg nadat hij iemand anders heeft gepromoveerd. Die tweede
-- helft ontbrak, waardoor de laatste eigenaar vastzat in zijn huishouden.
--
-- Bewust een RPC en geen UPDATE-policy op household_member. Een policy zou de
-- tabel voor elke ingelogde gebruiker schrijfbaar maken en de bewaking over
-- twee plaatsen verdelen; deze functie houdt de regel op één plek. Dezelfde
-- vorm als create_household(), create_invite() en accept_invite().
--
-- security definer is hier nodig: er is geen UPDATE-policy, dus een
-- invoker-functie zou nul rijen raken en stil slagen.
create function set_member_role(target_household uuid, target_user uuid, new_role text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd';
  end if;

  if new_role not in ('owner', 'member') then
    raise exception 'onbekende rol';
  end if;

  if not is_household_owner(target_household) then
    raise exception 'alleen een eigenaar mag rollen wijzigen';
  end if;

  update household_member
     set role = new_role
   where household_id = target_household and user_id = target_user;

  -- Zonder deze controle slaagt een oproep op iemand die geen lid is stil.
  -- De trigger prevent_last_owner_removal bewaakt het andere uiteinde: het
  -- degraderen van de laatste eigenaar wordt daar geweigerd.
  if not found then
    raise exception 'die persoon is geen lid van dit huishouden';
  end if;
end;
$$;

-- Supabase geeft nieuwe functies een execute-grant aan anon via de
-- PUBLIC-pseudorol én rechtstreeks. `revoke ... from public` alleen laat die
-- directe grant intact, dus anon moet expliciet genoemd worden.
revoke all on function set_member_role(uuid, uuid, text) from public, anon;
grant execute on function set_member_role(uuid, uuid, text) to authenticated;
