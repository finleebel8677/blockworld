-- BLOCKWORLD cloud accounts, saves, friends and friend requests
-- Run this entire file in Supabase SQL Editor for your free project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 18),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Profiles visible to signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "Users create own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.player_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  save_data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.player_saves enable row level security;
create policy "Users read own saves" on public.player_saves
  for select to authenticated using (auth.uid() = user_id);
create policy "Users create own saves" on public.player_saves
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own saves" on public.player_saves
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique(from_user,to_user),
  check (from_user <> to_user)
);
alter table public.friend_requests enable row level security;
create policy "Users view requests involving them" on public.friend_requests
  for select to authenticated using (auth.uid() = from_user or auth.uid() = to_user);
create policy "Users send requests as themselves" on public.friend_requests
  for insert to authenticated with check (auth.uid() = from_user);
create policy "Recipients respond to requests" on public.friend_requests
  for update to authenticated using (auth.uid() = to_user) with check (auth.uid() = to_user);

create table if not exists public.friendships (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,friend_id),
  check (user_id <> friend_id)
);
alter table public.friendships enable row level security;
create policy "Users see own friendships" on public.friendships
  for select to authenticated using (auth.uid() = user_id);
create policy "Users create own friendship rows" on public.friendships
  for insert to authenticated with check (auth.uid() = user_id);

create or replace function public.accept_blockworld_friend_request()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    insert into public.friendships(user_id,friend_id) values (new.from_user,new.to_user)
      on conflict do nothing;
    insert into public.friendships(user_id,friend_id) values (new.to_user,new.from_user)
      on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists blockworld_friend_accept on public.friend_requests;
create trigger blockworld_friend_accept after update of status on public.friend_requests
  for each row execute function public.accept_blockworld_friend_request();
