create table household (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table household_member (
  household_id uuid not null references household on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_member_user_idx on household_member (user_id);

-- security definer omzeilt RLS op household_member en voorkomt zo de
-- oneindige recursie die ontstaat als een policy zijn eigen tabel bevraagt
create function is_household_member(target uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from household_member
    where household_id = target and user_id = auth.uid()
  );
$$;

create function is_household_owner(target uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from household_member
    where household_id = target and user_id = auth.uid() and role = 'owner'
  );
$$;

alter table household enable row level security;
alter table household_member enable row level security;

create policy "leden zien hun huishouden"
  on household for select
  using (is_household_member(id));

create policy "eigenaars mogen hun huishouden wijzigen"
  on household for update
  using (is_household_owner(id))
  with check (is_household_owner(id));

create policy "eigenaars mogen hun huishouden opheffen"
  on household for delete
  using (is_household_owner(id));

create policy "iedereen mag een huishouden starten"
  on household for insert
  with check (auth.uid() is not null);

create policy "leden zien de ledenlijst"
  on household_member for select
  using (is_household_member(household_id));

create policy "eigenaars mogen leden verwijderen"
  on household_member for delete
  using (is_household_owner(household_id) or user_id = auth.uid());
