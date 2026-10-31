-- Jumo 동시 접속자 집계(관리용) — run once in Supabase (SQL Editor).
--
-- 앱이 앞에 떠 있는 동안 2분마다 app_ping() 을 부른다. 기기 식별자를 그대로 보내지 않고
-- (기기 ID + KST 날짜) 해시(sid)를 보낸다 — 하루 안에서만 같은 값이라 날을 넘어 이어 볼 수
-- 없고, device_tokens 등 다른 테이블과도 이어지지 않는다.
-- 숫자는 /api/online?secret=<PUSH_CRON_SECRET> 로 본다(api/push-cron.js → app_presence_stats()).

create table if not exists public.app_presence (
  sid        text primary key,
  last_seen  timestamptz not null default now(),
  platform   text,
  app_build  text
);
create index if not exists app_presence_last_seen on public.app_presence (last_seen);
alter table public.app_presence enable row level security;
-- anon 정책 없음: 앱은 아래 app_ping() 으로만 쓰고, 행은 읽지 못한다.

create or replace function public.app_ping(p_sid text, p_platform text default null, p_build text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sid is null or length(p_sid) not between 8 and 64 then
    return;
  end if;
  insert into app_presence (sid, last_seen, platform, app_build)
  values (p_sid, now(), left(p_platform, 16), left(p_build, 32))
  on conflict (sid) do update
    set last_seen = excluded.last_seen, platform = excluded.platform, app_build = excluded.app_build;
  -- 가끔 오래된 행을 치운다(어제 숫자까지 보려고 3일은 남긴다).
  if random() < 0.01 then
    delete from app_presence where last_seen < now() - interval '3 days';
  end if;
end;
$$;
revoke all on function public.app_ping(text, text, text) from public;
grant execute on function public.app_ping(text, text, text) to anon, authenticated;

-- online = 최근 5분 안에 신호를 보낸 기기(앱은 2분마다 보낸다). today·yesterday 는 KST 기준.
-- sid 가 날마다 바뀌므로 어제 행은 어제 쓴 기기 수와 같다.
create or replace function public.app_presence_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as today0
  )
  -- left join: 행이 하나도 없어도 0 으로 답한다(count(a.sid) 는 빈 짝을 세지 않는다).
  select json_build_object(
    'online',    count(a.sid) filter (where a.last_seen > now() - interval '5 minutes'),
    'lastHour',  count(a.sid) filter (where a.last_seen > now() - interval '1 hour'),
    'today',     count(a.sid) filter (where a.last_seen >= b.today0),
    'yesterday', count(a.sid) filter (where a.last_seen >= b.today0 - interval '1 day' and a.last_seen < b.today0),
    'onlineByPlatform', coalesce((
      select json_object_agg(p, n) from (
        select coalesce(platform, '?') as p, count(*) as n
        from app_presence where last_seen > now() - interval '5 minutes' group by 1
      ) s
    ), '{}'::json),
    'at', now()
  )
  from b left join app_presence a on true
  group by b.today0;
$$;
revoke all on function public.app_presence_stats() from public, anon, authenticated;
grant execute on function public.app_presence_stats() to service_role;
