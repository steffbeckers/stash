create function create_household(household_name text) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_id uuid;
  actor  uuid := auth.uid();
begin
  if actor is null then
    raise exception 'niet ingelogd';
  end if;

  if household_name is null or length(trim(household_name)) = 0 then
    raise exception 'naam mag niet leeg zijn';
  end if;

  insert into household (name) values (trim(household_name)) returning id into new_id;
  insert into household_member (household_id, user_id, role) values (new_id, actor, 'owner');

  return new_id;
end;
$$;

revoke all on function create_household(text) from public;
grant execute on function create_household(text) to authenticated;
