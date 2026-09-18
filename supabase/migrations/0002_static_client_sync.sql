alter table public.courses
  add column if not exists client_id text not null default 'default-course';

alter table public.materials
  add column if not exists client_id text;

alter table public.deadlines
  add column if not exists client_id text;

alter table public.study_sessions
  add column if not exists client_id text;

alter table public.study_session_logs
  add column if not exists client_id text;

alter table public.quiz_attempts
  add column if not exists client_id text,
  add column if not exists question text,
  add column if not exists source_material_name text;

alter table public.material_questions
  add column if not exists client_id text;

alter table public.answer_citations
  add column if not exists client_id text,
  add column if not exists source_material_name text,
  add column if not exists topic text;

create unique index if not exists courses_user_client_id_idx
  on public.courses(user_id, client_id);

create unique index if not exists materials_course_client_id_idx
  on public.materials(course_id, client_id);

create unique index if not exists deadlines_course_client_id_idx
  on public.deadlines(course_id, client_id);

create unique index if not exists study_sessions_course_client_id_idx
  on public.study_sessions(course_id, client_id);

create unique index if not exists study_session_logs_course_client_id_idx
  on public.study_session_logs(course_id, client_id);

create unique index if not exists quiz_attempts_course_client_id_idx
  on public.quiz_attempts(course_id, client_id);

create unique index if not exists material_questions_course_client_id_idx
  on public.material_questions(course_id, client_id);

create unique index if not exists answer_citations_course_client_id_idx
  on public.answer_citations(course_id, client_id);
