-- Daily request quotas for the optional hosted GULZ AI service.
-- Identity hashes are generated server-side; raw IP addresses and device tokens
-- are never stored in this usage table.

create table if not exists public.gulz_ai_usage_daily (
  identity_hash text not null,
  usage_date date not null default current_date,
  requests integer not null default 0 check (requests >= 0),
  updated_at timestamptz not null default now(),
  primary key (identity_hash, usage_date)
);

alter table public.gulz_ai_usage_daily enable row level security;

create or replace function public.gulz_consume_ai_request(
  p_identity_hash text,
  p_daily_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used integer;
  allowed boolean;
begin
  if p_daily_limit < 1 or p_daily_limit > 10000 then
    raise exception 'INVALID_DAILY_LIMIT';
  end if;

  insert into public.gulz_ai_usage_daily (identity_hash, usage_date, requests)
  values (p_identity_hash, current_date, 1)
  on conflict (identity_hash, usage_date)
  do update set
    requests = case
      when public.gulz_ai_usage_daily.requests < p_daily_limit
      then public.gulz_ai_usage_daily.requests + 1
      else public.gulz_ai_usage_daily.requests
    end,
    updated_at = now()
  returning requests into used;

  allowed := used <= p_daily_limit;
  return jsonb_build_object(
    'allowed', allowed,
    'used', used,
    'limit', p_daily_limit,
    'remaining', greatest(p_daily_limit - used, 0)
  );
end;
$$;

revoke all on function public.gulz_consume_ai_request(text, integer) from public, anon, authenticated;
grant execute on function public.gulz_consume_ai_request(text, integer) to service_role;
