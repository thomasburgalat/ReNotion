-- Médias (images, PDF…) : bucket privé, un dossier par espace (<workspace_id>/<fichier>), accès réservé aux membres.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 26214400,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_member_folder(folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.workspace_id::text = folder and m.user_id = (select auth.uid()));
$$;
revoke execute on function public.is_member_folder(text) from public, anon;
grant execute on function public.is_member_folder(text) to authenticated;

create policy "media: members read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_member_folder((storage.foldername(name))[1]));
create policy "media: members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_member_folder((storage.foldername(name))[1]));
create policy "media: members delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_member_folder((storage.foldername(name))[1]));
