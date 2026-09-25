-- Hand-charted plays for The Depth Chart CFB (Tier 2 charting tool, /chart).
-- Run once in the Supabase SQL editor (project izlqhnxowdhtdofkwrho).
--
-- Locked down: row-level security ON and NO policies, so the public anon key can neither read
-- nor write. Only the site's server (SUPABASE_SERVICE_ROLE_KEY in Vercel) touches it; the
-- public gets the data through the site's own /api/chart/export route and the pages.

create table if not exists public.cfb_chart_plays (
  game_id     text        not null,             -- ESPN event id
  seq         text        not null,             -- ESPN play sequenceNumber within the game
  season      int         not null,
  off_tid     text,                             -- offense team id (ESPN)
  def_tid     text,
  kind        text,                             -- 'pass' | 'run' | 'sack' | 'other'
  data        jsonb       not null default '{}',-- the charted fields (see components/charttool)
  charted_by  text        not null default 'owner',
  updated_at  timestamptz not null default now(),
  primary key (game_id, seq)
);

create index if not exists cfb_chart_plays_season on public.cfb_chart_plays (season);
create index if not exists cfb_chart_plays_off on public.cfb_chart_plays (off_tid);

alter table public.cfb_chart_plays enable row level security;
-- (intentionally no policies)
revoke all on public.cfb_chart_plays from anon, authenticated;
