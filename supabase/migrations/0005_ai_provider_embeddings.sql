alter table public.material_chunks
  add column if not exists embedding_provider text not null default 'openai',
  add column if not exists embedding_model text not null default 'text-embedding-3-small';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'material_chunks_embedding_provider_check'
      and conrelid = 'public.material_chunks'::regclass
  ) then
    alter table public.material_chunks
      add constraint material_chunks_embedding_provider_check
      check (embedding_provider in ('openai', 'gemini'));
  end if;
end $$;

create index if not exists material_chunks_course_provider_idx
  on public.material_chunks(course_id, embedding_provider);

drop function if exists public.match_material_chunks(extensions.vector, uuid, integer, double precision);

create or replace function public.match_material_chunks(
  query_embedding extensions.vector(1536),
  match_course_id uuid,
  match_count integer default 5,
  similarity_threshold double precision default 0.68,
  match_embedding_provider text default 'openai'
)
returns table (
  chunk_id uuid,
  material_id uuid,
  material_name text,
  content text,
  topic text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    material_chunks.id as chunk_id,
    material_chunks.material_id,
    materials.file_name as material_name,
    material_chunks.content,
    material_chunks.topic,
    1 - (material_chunks.embedding <=> query_embedding) as similarity
  from public.material_chunks
  join public.materials on materials.id = material_chunks.material_id
  where material_chunks.course_id = match_course_id
    and material_chunks.user_id = auth.uid()
    and material_chunks.embedding is not null
    and material_chunks.embedding_provider = match_embedding_provider
    and 1 - (material_chunks.embedding <=> query_embedding) >= similarity_threshold
  order by material_chunks.embedding <=> query_embedding
  limit match_count;
$$;
