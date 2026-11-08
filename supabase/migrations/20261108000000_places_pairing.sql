-- GULZ account-linked Places and one-time terminal pairing.
-- All records are server-side only. The Cloudflare Worker uses the Supabase
-- service-role key; browser and CLI clients never receive it.

create table if not exists public.gulz_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_name text not null check (char_length(place_name) between 1 and 80),
  platform text not null default 'unknown',
  architecture text not null default 'unknown',
  gulz_version text not null default 'unknown',
  active_provider text,
  active_model text,
  status text not null default 'online' check (status in ('online', 'offline', 'revoked')),
  device_token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.gulz_place_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gulz_places_user_last_seen_idx
  on public.gulz_places (user_id, last_seen_at desc)
  where revoked_at is null;

create index if not exists gulz_pairing_user_created_idx
  on public.gulz_place_pairing_codes (user_id, created_at desc);

alter table public.gulz_places enable row level security;
alter table public.gulz_place_pairing_codes enable row level security;

create or replace function public.gulz_complete_place_pairing(
  p_code_hash text,
  p_place_name text,
  p_platform text,
  p_architecture text,
  p_gulz_version text,
  p_device_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pairing public.gulz_place_pairing_codes%rowtype;
  new_place public.gulz_places%rowtype;
begin
  select * into pairing
  from public.gulz_place_pairing_codes
  where code_hash = p_code_hash
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'PAIRING_CODE_INVALID_OR_EXPIRED';
  end if;

  update public.gulz_place_pairing_codes
    set consumed_at = now()
    where id = pairing.id;

  insert into public.gulz_places (
    user_id, place_name, platform, architecture, gulz_version, device_token_hash
  ) values (
    pairing.user_id,
    left(coalesce(nullif(trim(p_place_name), ''), 'GULZ Place'), 80),
    left(coalesce(nullif(trim(p_platform), ''), 'unknown'), 40),
    left(coalesce(nullif(trim(p_architecture), ''), 'unknown'), 40),
    left(coalesce(nullif(trim(p_gulz_version), ''), 'unknown'), 40),
    p_device_token_hash
  ) returning * into new_place;

  return jsonb_build_object('id', new_place.id, 'user_id', new_place.user_id);
end;
$$;

revoke all on function public.gulz_complete_place_pairing(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.gulz_complete_place_pairing(text, text, text, text, text, text) to service_role;
