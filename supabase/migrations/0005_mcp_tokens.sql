-- Jetons personnels pour le serveur MCP. Seule l'empreinte SHA-256 est stockée.
create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Assistant',
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;
create policy "mcp_tokens: own read" on public.mcp_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy "mcp_tokens: own revoke" on public.mcp_tokens for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update on public.mcp_tokens from authenticated, anon;

-- Crée un jeton et le renvoie une seule fois en clair
create or replace function public.create_mcp_token(token_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare tok text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.mcp_tokens t where t.user_id = auth.uid()) >= 10 then
    raise exception 'Maximum 10 jetons par personne';
  end if;
  tok := 'rn_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.mcp_tokens (user_id, name, token_hash, prefix)
  values (auth.uid(), left(coalesce(nullif(trim(token_name), ''), 'Assistant'), 40),
          encode(extensions.digest(tok, 'sha256'), 'hex'), left(tok, 10));
  return tok;
end;
$$;
revoke execute on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;
