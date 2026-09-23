create table storage_place (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  kind         text not null check (kind in ('pantry', 'fridge', 'freezer', 'other')),
  created_at   timestamptz not null default now()
);

create index storage_place_household_idx on storage_place (household_id);

alter table storage_place enable row level security;

create policy "leden zien de bewaarplaatsen van hun huishouden"
  on storage_place for select
  using (is_household_member(household_id));

create policy "leden mogen bewaarplaatsen aanmaken"
  on storage_place for insert
  with check (is_household_member(household_id));

create policy "leden mogen bewaarplaatsen wijzigen"
  on storage_place for update
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "leden mogen bewaarplaatsen verwijderen"
  on storage_place for delete
  using (is_household_member(household_id));

-- Een leeg huishouden is onbruikbaar, dus elk nieuw huishouden
-- start met de drie plaatsen die iedereen heeft.
create or replace function create_household(household_name text) returns uuid
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

  insert into storage_place (household_id, name, kind) values
    (new_id, 'Pantry', 'pantry'),
    (new_id, 'Fridge', 'fridge'),
    (new_id, 'Freezer', 'freezer');

  return new_id;
end;
$$;
