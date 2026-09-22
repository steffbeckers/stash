create table user_profile (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  trust_level  int not null default 0 check (trust_level between 0 and 3),
  role         text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  created_at   timestamptz not null default now()
);

alter table user_profile enable row level security;

create policy "iedereen mag publieke profielvelden lezen"
  on user_profile for select
  using (true);

create policy "je mag je eigen profiel bijwerken"
  on user_profile for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create function handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.user_profile (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
