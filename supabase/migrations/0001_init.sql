-- ReNotion : espaces partagés, pages et blocs, avec RLS par membre.

create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mon espace',
  invite_code text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  color text not null default '#2383e2',
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index members_user_idx on public.members (user_id);

create table public.pages (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id text,
  title text not null default '',
  icon text not null default '',
  cover text not null default '',
  pos double precision not null default 0,
  trashed boolean not null default false,
  trashed_at bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index pages_ws_idx on public.pages (workspace_id);

create table public.blocks (
  id text primary key,
  page_id text not null references public.pages (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  pos double precision not null default 0,
  type text not null default 'p',
  text text not null default '',
  indent smallint not null default 0,
  props jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index blocks_ws_idx on public.blocks (workspace_id);
create index blocks_page_idx on public.blocks (page_id);

-- Appartenance (security definer pour éviter la récursion RLS)
create or replace function public.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.workspace_id = ws and m.user_id = (select auth.uid()));
$$;

alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.pages enable row level security;
alter table public.blocks enable row level security;

create policy "workspaces: members read" on public.workspaces for select to authenticated using (public.is_member(id));
create policy "workspaces: owner rename" on public.workspaces for update to authenticated
  using (exists (select 1 from public.members m where m.workspace_id = id and m.user_id = (select auth.uid()) and m.role = 'owner'));

create policy "members: members read" on public.members for select to authenticated using (public.is_member(workspace_id));
create policy "members: update self" on public.members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "members: leave" on public.members for delete to authenticated using (user_id = (select auth.uid()));

create policy "pages: members all" on public.pages for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "blocks: members all" on public.blocks for all to authenticated
  using (public.is_member(workspace_id))
  with check (public.is_member(workspace_id) and exists (select 1 from public.pages p where p.id = page_id and p.workspace_id = blocks.workspace_id));

-- Les membres ne peuvent pas changer leur rôle eux-mêmes
revoke update on public.members from authenticated;
grant update (display_name, color) on public.members to authenticated;
revoke update on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;

-- Rejoindre un espace avec un code d'invitation
create or replace function public.join_workspace(code text, name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select w.id into ws from public.workspaces w where w.invite_code = lower(trim(code));
  if ws is null then raise exception 'Code d''invitation invalide'; end if;
  insert into public.members (workspace_id, user_id, display_name, color)
  values (ws, auth.uid(), left(coalesce(nullif(trim(name), ''), 'Anonyme'), 40),
          (array['#e03e3e','#d9730d','#dfab01','#0f7b6c','#0b6e99','#6940a5','#ad1a72','#64473a'])[1 + floor(random() * 8)::int])
  on conflict (workspace_id, user_id) do nothing;
  return ws;
end;
$$;

-- Créer un nouvel espace (réservé aux personnes déjà membres d'un espace)
create or replace function public.create_workspace(ws_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare ws uuid; dn text; col text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select m.display_name, m.color into dn, col from public.members m where m.user_id = auth.uid() limit 1;
  if dn is null then raise exception 'Il faut déjà être membre d''un espace'; end if;
  insert into public.workspaces (name, created_by) values (left(coalesce(nullif(trim(ws_name), ''), 'Nouvel espace'), 60), auth.uid()) returning id into ws;
  insert into public.members (workspace_id, user_id, display_name, color, role) values (ws, auth.uid(), dn, col, 'owner');
  return ws;
end;
$$;

-- Nouveau code d'invitation (propriétaire uniquement)
create or replace function public.rotate_invite(ws uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare code text;
begin
  if not exists (select 1 from public.members m where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Réservé au propriétaire';
  end if;
  update public.workspaces set invite_code = encode(extensions.gen_random_bytes(6), 'hex') where id = ws returning invite_code into code;
  return code;
end;
$$;

revoke execute on function public.join_workspace(text, text) from public, anon;
revoke execute on function public.create_workspace(text) from public, anon;
revoke execute on function public.rotate_invite(uuid) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.join_workspace(text, text) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.rotate_invite(uuid) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- Temps réel : canaux privés "ws:<uuid>" réservés aux membres
create or replace function public.can_use_topic(topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where 'ws:' || m.workspace_id::text = topic and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.can_use_topic(text) from public, anon;
grant execute on function public.can_use_topic(text) to authenticated;

create policy "realtime: members receive" on realtime.messages for select to authenticated
  using (public.can_use_topic((select realtime.topic())));
create policy "realtime: members send" on realtime.messages for insert to authenticated
  with check (public.can_use_topic((select realtime.topic())));
