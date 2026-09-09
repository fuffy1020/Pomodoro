-- Run once in Supabase SQL Editor, or apply via supabase db push.
create table if not exists public.focus_sessions (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '專注時段' check (char_length(title) <= 120),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 1 and 10800),
  completed boolean not null default true,
  segments jsonb not null check (jsonb_typeof(segments) = 'array' and jsonb_array_length(segments) between 1 and 500),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  check (ended_at >= started_at),
  check (duration_seconds <= extract(epoch from ended_at - started_at) + 1)
);
create index if not exists focus_sessions_user_started on public.focus_sessions (user_id, started_at desc);
alter table public.focus_sessions enable row level security;
revoke all on public.focus_sessions from anon;
grant select, insert on public.focus_sessions to authenticated;
create policy "Read own sessions" on public.focus_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own sessions" on public.focus_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
