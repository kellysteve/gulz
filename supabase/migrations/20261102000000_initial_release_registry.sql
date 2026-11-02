-- GULZ release registry and private artifact storage.
-- This migration is intentionally server-side only: RLS is enabled and no
-- anon/authenticated policies are created. The Cloudflare Worker will access
-- these records using a server-side Supabase secret.

create table if not exists public.gulz_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  channel text not null check (channel in ('stable', 'beta', 'nightly')),
  status text not null default 'draft' check (status in ('draft', 'published', 'yanked')),
  release_notes text not null default '',
  manifest jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version, channel)
);

create table if not exists public.gulz_release_artifacts (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.gulz_releases(id) on delete cascade,
  platform text not null check (platform in ('android-termux', 'linux', 'macos', 'windows')),
  architecture text not null check (architecture in ('x64', 'arm64', 'armv7')),
  artifact_kind text not null,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[a-fA-F0-9]{64}$'),
  signature text,
  minimum_os text,
  created_at timestamptz not null default now(),
  unique (release_id, platform, architecture, artifact_kind)
);

create index if not exists gulz_releases_channel_status_published_idx
  on public.gulz_releases (channel, status, published_at desc);

create index if not exists gulz_release_artifacts_release_id_idx
  on public.gulz_release_artifacts (release_id);

alter table public.gulz_releases enable row level security;
alter table public.gulz_release_artifacts enable row level security;

-- Private bucket: public downloads must go through the authenticated/controlled
-- Cloudflare Worker release API, not direct anonymous object access.
insert into storage.buckets (id, name, public, file_size_limit)
values ('gulz-releases', 'gulz-releases', false, 1073741824)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;
