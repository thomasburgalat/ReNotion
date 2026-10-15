-- Tous les membres ont les mêmes droits sur l'espace : renommer l'espace et régénérer le lien d'invitation.
drop policy if exists "workspaces: owner rename" on public.workspaces;
create policy "workspaces: members rename" on public.workspaces for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

create or replace function public.rotate_invite(ws uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare code text;
begin
  if not exists (select 1 from public.members m where m.workspace_id = ws and m.user_id = auth.uid()) then
    raise exception 'Réservé aux membres de l''espace';
  end if;
  update public.workspaces set invite_code = encode(extensions.gen_random_bytes(6), 'hex') where id = ws returning invite_code into code;
  return code;
end;
$$;
