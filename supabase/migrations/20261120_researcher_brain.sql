create table if not exists public.researcher_brain (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc text not null,
  body jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, doc)
);
alter table public.researcher_brain enable row level security;
create policy "researcher_brain select own" on public.researcher_brain for select to authenticated using (user_id = auth.uid());
create policy "researcher_brain insert own" on public.researcher_brain for insert to authenticated with check (user_id = auth.uid());
create policy "researcher_brain update own" on public.researcher_brain for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
