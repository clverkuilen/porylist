create table user_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text,
  avatar_pokemon text,
  avatar_bg_color text,
  updated_at   timestamptz not null default now()
);

alter table user_profiles enable row level security;

create policy "Users can read own profile"
  on user_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on user_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on user_profiles for update
  using (auth.uid() = user_id);
