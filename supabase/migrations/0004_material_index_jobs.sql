create table if not exists public.material_index_jobs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'queued',
  requested_by text not null default 'user',
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  chunk_count integer not null default 0,
  error text,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'material_index_jobs_status_check'
      and conrelid = 'public.material_index_jobs'::regclass
  ) then
    alter table public.material_index_jobs
      add constraint material_index_jobs_status_check
      check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'material_index_jobs_attempts_check'
      and conrelid = 'public.material_index_jobs'::regclass
  ) then
    alter table public.material_index_jobs
      add constraint material_index_jobs_attempts_check
      check (attempts >= 0 and max_attempts between 1 and 10);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'material_index_jobs_chunk_count_check'
      and conrelid = 'public.material_index_jobs'::regclass
  ) then
    alter table public.material_index_jobs
      add constraint material_index_jobs_chunk_count_check
      check (chunk_count >= 0);
  end if;
end $$;

create index if not exists material_index_jobs_course_status_idx
  on public.material_index_jobs(course_id, status, run_after);

create index if not exists material_index_jobs_material_idx
  on public.material_index_jobs(material_id);

create unique index if not exists material_index_jobs_active_material_idx
  on public.material_index_jobs(material_id)
  where status in ('queued', 'running');

alter table public.material_index_jobs enable row level security;

drop policy if exists "Users can manage own material index jobs" on public.material_index_jobs;

create policy "Users can manage own material index jobs" on public.material_index_jobs
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create or replace function public.claim_material_index_jobs(claim_limit integer default 1)
returns setof public.material_index_jobs
language sql
volatile
security invoker
set search_path = public
as $$
  with candidate_jobs as (
    select id
    from public.material_index_jobs
    where (
      status = 'queued'
      and run_after <= now()
    )
      or (
        status = 'running'
        and locked_at < now() - interval '10 minutes'
        and attempts < max_attempts
      )
    order by priority desc, created_at asc
    for update skip locked
    limit greatest(1, least(claim_limit, 10))
  )
  update public.material_index_jobs jobs
  set
    status = 'running',
    attempts = jobs.attempts + 1,
    locked_at = now(),
    started_at = coalesce(jobs.started_at, now()),
    error = null,
    updated_at = now()
  from candidate_jobs
  where jobs.id = candidate_jobs.id
  returning jobs.*;
$$;

revoke execute on function public.claim_material_index_jobs(integer) from public;
grant execute on function public.claim_material_index_jobs(integer) to authenticated, service_role;
