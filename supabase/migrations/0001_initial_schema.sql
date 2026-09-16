create extension if not exists vector with schema extensions;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  term text,
  exam_date date,
  daily_minutes integer not null default 45 check (daily_minutes between 15 and 240),
  preferred_start_time time not null default '18:00',
  study_days integer[] not null default array[1, 2, 3, 4, 5],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'Material',
  storage_path text,
  status text not null default 'Saved',
  size_bytes bigint not null default 0,
  page_count integer not null default 0,
  indexed_pages integer not null default 0,
  topics text[] not null default array['General review'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  type text not null default 'Assignment',
  due_date date not null,
  topic text not null default 'General review',
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  source_page integer,
  topic text,
  created_at timestamptz not null default now(),
  unique (material_id, chunk_index)
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  duration_minutes integer not null default 45,
  focus_topic text not null default 'General review',
  task text not null,
  reason text,
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.study_session_logs (
  id uuid primary key default gen_random_uuid(),
  study_session_id uuid references public.study_sessions(id) on delete set null,
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  focus_topic text not null default 'General review',
  minutes integer not null default 0,
  notes text,
  completed_at timestamptz not null default now()
);

create table public.quiz_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  material_chunk_id uuid references public.material_chunks(id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic text not null default 'General review',
  question text not null,
  answer text not null,
  source_material_name text,
  source_excerpt text,
  created_at timestamptz not null default now()
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  quiz_item_id uuid references public.quiz_items(id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic text not null default 'General review',
  result text not null check (result in ('hit', 'miss')),
  confidence_after integer not null default 0 check (confidence_after between 0 and 100),
  answered_at timestamptz not null default now()
);

create table public.topic_progress (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic text not null,
  confidence_score integer not null default 50 check (confidence_score between 0 and 100),
  study_sessions integer not null default 0,
  quiz_attempts integer not null default 0,
  quiz_misses integer not null default 0,
  last_reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (course_id, topic)
);

create table public.material_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  grounding text not null default 'Grounding: none',
  created_at timestamptz not null default now()
);

create table public.answer_citations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  material_question_id uuid not null references public.material_questions(id) on delete cascade,
  material_chunk_id uuid references public.material_chunks(id) on delete set null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question text not null,
  answer_excerpt text,
  match_score double precision not null default 0,
  created_at timestamptz not null default now()
);

create index materials_course_id_idx on public.materials(course_id);
create index material_chunks_course_id_idx on public.material_chunks(course_id);
create index material_chunks_embedding_idx on public.material_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index deadlines_course_id_idx on public.deadlines(course_id);
create index study_sessions_course_id_idx on public.study_sessions(course_id);
create index quiz_attempts_course_id_idx on public.quiz_attempts(course_id);
create index topic_progress_course_id_idx on public.topic_progress(course_id);
create index material_questions_course_id_idx on public.material_questions(course_id);

insert into storage.buckets (id, name, public)
values ('course-materials', 'course-materials', false)
on conflict (id) do nothing;

alter table public.courses enable row level security;
alter table public.materials enable row level security;
alter table public.deadlines enable row level security;
alter table public.material_chunks enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_session_logs enable row level security;
alter table public.quiz_items enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.topic_progress enable row level security;
alter table public.material_questions enable row level security;
alter table public.answer_citations enable row level security;

create policy "Users can manage own courses" on public.courses
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own materials" on public.materials
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own deadlines" on public.deadlines
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own material chunks" on public.material_chunks
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own study sessions" on public.study_sessions
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own study logs" on public.study_session_logs
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own quiz items" on public.quiz_items
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own quiz attempts" on public.quiz_attempts
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own topic progress" on public.topic_progress
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own material questions" on public.material_questions
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can manage own answer citations" on public.answer_citations
  for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy "Users can upload own course files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own course files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own course files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own course files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.match_material_chunks(
  query_embedding vector(1536),
  match_course_id uuid,
  match_count integer default 5,
  similarity_threshold double precision default 0.68
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
set search_path = public
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
    and 1 - (material_chunks.embedding <=> query_embedding) >= similarity_threshold
  order by material_chunks.embedding <=> query_embedding
  limit match_count;
$$;
