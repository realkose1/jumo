-- Jumo push notifications — run once in Supabase (SQL Editor).

-- One row per device: its APNs token + the player ids it follows (for targeting).
create table if not exists public.device_tokens (
  device_id   text primary key,
  token       text not null,
  platform    text default 'ios',
  player_ids  jsonb default '[]'::jsonb,
  updated_at  timestamptz default now()
);
alter table public.device_tokens enable row level security;
-- The app uses the public anon key to upsert its own token row.
drop policy if exists "device_tokens anon upsert" on public.device_tokens;
create policy "device_tokens anon upsert" on public.device_tokens
  for all to anon using (true) with check (true);

-- De-duplication log so each event is pushed only once.
create table if not exists public.push_log (
  event_key  text primary key,
  sent_at    timestamptz default now()
);
alter table public.push_log enable row level security;
-- No anon policy: only the cron (service_role key) reads/writes this.

-- Optional housekeeping: drop log rows older than 7 days (run manually or via cron).
-- delete from public.push_log where sent_at < now() - interval '7 days';
