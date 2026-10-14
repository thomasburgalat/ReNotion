-- Dossiers : une page peut être un simple conteneur (sans blocs) qui regroupe pages et sous-dossiers.
alter table public.pages add column if not exists kind text not null default 'page' check (kind in ('page', 'folder'));
