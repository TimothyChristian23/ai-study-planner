alter table public.materials
  add column if not exists index_status text not null default 'not_started',
  add column if not exists index_error text,
  add column if not exists index_attempts integer not null default 0,
  add column if not exists chunk_count integer not null default 0,
  add column if not exists index_started_at timestamptz,
  add column if not exists indexed_at timestamptz;

update public.materials
set
  index_status = case
    when status ilike 'Indexed %' then 'indexed'
    when status ilike '%failed%' then 'failed'
    when status ilike '%indexing%' then 'indexing'
    else index_status
  end,
  chunk_count = coalesce((substring(status from 'Indexed ([0-9]+) chunks'))::integer, chunk_count),
  indexed_at = case
    when status ilike 'Indexed %' then coalesce(indexed_at, updated_at)
    else indexed_at
  end
where index_status = 'not_started'
  or status ilike 'Indexed %'
  or status ilike '%indexing%'
  or status ilike '%failed%';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'materials_index_status_check'
      and conrelid = 'public.materials'::regclass
  ) then
    alter table public.materials
      add constraint materials_index_status_check
      check (index_status in ('not_started', 'queued', 'indexing', 'indexed', 'failed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'materials_index_attempts_check'
      and conrelid = 'public.materials'::regclass
  ) then
    alter table public.materials
      add constraint materials_index_attempts_check
      check (index_attempts >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'materials_chunk_count_check'
      and conrelid = 'public.materials'::regclass
  ) then
    alter table public.materials
      add constraint materials_chunk_count_check
      check (chunk_count >= 0);
  end if;
end $$;

create index if not exists materials_course_index_status_idx
  on public.materials(course_id, index_status);
