-- Jumo team cheer meter — run once in Supabase (SQL Editor).
-- Aggregate, shared tap-to-cheer counts per match & team. Until this is run the
-- app still works locally (optimistic counts persisted in localStorage); once the
-- table + RPC exist the counts become global across all users.

-- One row per (match, team). team is 'home' | 'away'.
create table if not exists public.match_cheers (
  match_id   text not null,
  team       text not null,
  count      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (match_id, team)
);
alter table public.match_cheers enable row level security;

-- Anyone (anon key) may read the counts.
drop policy if exists "match_cheers read" on public.match_cheers;
create policy "match_cheers read" on public.match_cheers
  for select to anon using (true);

-- Atomic "add N cheers" so concurrent taps from many users never lose updates.
-- Writes go only through this SECURITY DEFINER function (no direct anon write
-- policy), which caps each call to keep a single tap-spam burst bounded.
create or replace function public.add_cheers(p_match_id text, p_team text, p_n int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare new_count bigint;
begin
  if p_team not in ('home','away') then
    raise exception 'invalid team %', p_team;
  end if;
  if p_n is null or p_n <= 0 then
    select count into new_count from public.match_cheers where match_id = p_match_id and team = p_team;
    return coalesce(new_count, 0);
  end if;
  if p_n > 500 then p_n := 500; end if;   -- per-call cap (anti-abuse)
  insert into public.match_cheers as mc (match_id, team, count, updated_at)
    values (p_match_id, p_team, p_n, now())
  on conflict (match_id, team)
    do update set count = mc.count + excluded.count, updated_at = now()
  returning mc.count into new_count;
  return new_count;
end;
$$;

grant execute on function public.add_cheers(text, text, int) to anon, authenticated;
