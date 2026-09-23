create table household_invite (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household on delete cascade,
  token        text not null unique,
  created_by   uuid not null references auth.users on delete cascade,
  expires_at   timestamptz not null,
  max_uses     int not null default 5 check (max_uses > 0),
  uses         int not null default 0,
  created_at   timestamptz not null default now()
);

alter table household_invite enable row level security;

create policy "eigenaars zien de uitnodigingen van hun huishouden"
  on household_invite for select
  using (is_household_owner(household_id));

create policy "eigenaars mogen uitnodigingen intrekken"
  on household_invite for delete
  using (is_household_owner(household_id));

create function create_invite(target uuid, valid_days int, uses int)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_token text;
begin
  if not is_household_owner(target) then
    raise exception 'alleen een eigenaar mag uitnodigen';
  end if;

  -- gen_random_bytes komt van pgcrypto, dat op deze Supabase-stack in het
  -- schema "extensions" staat, niet in "public" — vandaar het gekwalificeerde
  -- pad in plaats van search_path te verbreden.
  new_token := encode(extensions.gen_random_bytes(24), 'base64');
  new_token := replace(replace(replace(new_token, '+', '-'), '/', '_'), '=', '');

  insert into household_invite (household_id, token, created_by, expires_at, max_uses)
  values (target, new_token, auth.uid(), now() + make_interval(days => valid_days), uses);

  return new_token;
end;
$$;

create function accept_invite(invite_token text) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  inv    household_invite;
  actor  uuid := auth.uid();
begin
  if actor is null then
    raise exception 'niet ingelogd';
  end if;

  select * into inv from household_invite where token = invite_token for update;

  if inv is null then
    raise exception 'uitnodiging bestaat niet';
  end if;

  if inv.expires_at < now() then
    raise exception 'uitnodiging is verlopen';
  end if;

  if inv.uses >= inv.max_uses then
    raise exception 'uitnodiging is niet meer geldig';
  end if;

  -- al lid: niets doen, en het gebruik niet verhogen
  if exists (
    select 1 from household_member
    where household_id = inv.household_id and user_id = actor
  ) then
    return inv.household_id;
  end if;

  insert into household_member (household_id, user_id, role)
  values (inv.household_id, actor, 'member');

  update household_invite set uses = uses + 1 where id = inv.id;

  return inv.household_id;
end;
$$;

-- Op deze Supabase-stack grant "alter default privileges" execute op nieuwe
-- functies in public rechtstreeks aan anon/authenticated/service_role, niet
-- via de PUBLIC-pseudorol. "revoke ... from public" alleen laat die directe
-- grant aan anon dus intact; anon moet expliciet genoemd worden.
revoke all on function create_invite(uuid, int, int) from public, anon;
revoke all on function accept_invite(text) from public, anon;
grant execute on function create_invite(uuid, int, int) to authenticated;
grant execute on function accept_invite(text) to authenticated;
