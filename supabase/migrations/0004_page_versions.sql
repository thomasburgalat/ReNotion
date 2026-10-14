-- Historique des versions : instantanés d'une page (titre, icône, couverture, blocs), 100 max par page.
create table if not exists public.page_versions (
  id bigint generated always as identity primary key,
  page_id text not null references public.pages (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  reason text,
  data jsonb not null
);
create index if not exists page_versions_page_idx on public.page_versions (page_id, created_at desc);
create index if not exists page_versions_ws_idx on public.page_versions (workspace_id);

alter table public.page_versions enable row level security;

create policy "versions: members read" on public.page_versions for select to authenticated
  using (public.is_member(workspace_id));
create policy "versions: members add" on public.page_versions for insert to authenticated
  with check (
    public.is_member(workspace_id)
    and created_by = (select auth.uid())
    and exists (select 1 from public.pages p where p.id = page_id and p.workspace_id = page_versions.workspace_id)
  );

-- On ne garde que les 100 versions les plus récentes de chaque page
create or replace function public.prune_page_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.page_versions v
  where v.page_id = new.page_id
    and v.id not in (select x.id from public.page_versions x where x.page_id = new.page_id order by x.created_at desc, x.id desc limit 100);
  return null;
end;
$$;
revoke execute on function public.prune_page_versions() from public, anon, authenticated;

create trigger page_versions_prune after insert on public.page_versions
  for each row execute function public.prune_page_versions();
