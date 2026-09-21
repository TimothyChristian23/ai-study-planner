# Production Upgrade Plan

This document tracks the path from the deployed static prototype to a production app with auth, durable storage, document retrieval, and AI answers.

## Target Stack

- Frontend: current static dashboard first, then React or Next.js once server-rendered routes are useful
- Auth: Supabase Auth
- Database: Supabase Postgres with row-level security
- File storage: Supabase Storage bucket for user course materials
- AI: Supabase Edge Functions calling OpenAI server-side
- Retrieval: extracted material chunks stored in Postgres with vector embeddings

## Foundation Added

- `.env.example` for browser-safe Supabase values and server-only OpenAI secrets
- `config.js` for browser-safe Supabase URL and anon key configuration
- `supabase/migrations/0001_initial_schema.sql` for courses, materials, chunks, schedules, quizzes, progress, answers, citations, storage bucket, RLS policies, and a vector search RPC
- `supabase/migrations/0002_static_client_sync.sql` for stable client IDs used by the static frontend sync path
- `supabase/functions/ask-materials` for authenticated material Q&A using retrieved chunks and OpenAI Responses
- Static account panel with sign in, sign up, sign out, and session detection when Supabase config is present
- Cloud course picker for selecting existing planner records or creating a new cloud course from the current local planner
- Debounced cloud autosave for signed-in users, with manual sync/load safety controls and a remote-change guard before autosave overwrites existing cloud data
- Account-panel conflict resolution actions for loading the cloud copy, keeping local changes, or explicitly overwriting cloud
- Signed-in Supabase Storage uploads to the private `course-materials` bucket, with `storage_path` saved on material rows
- Signed download and reprocess controls for cloud-stored course files
- Material indexing status fields for queued, running, indexed, and failed states, with retry attempt metadata
- `material_index_jobs` plus `claim_material_index_jobs` for durable indexing work, active-job dedupe, and retryable stale job claims
- `supabase/functions/index-material` for authenticated manual indexing that enqueues a durable job and processes it immediately when runtime allows
- `supabase/functions/process-index-jobs` for signed-in or worker-secret job processing across queued and stale indexing jobs
- The `Ask materials` panel now calls `ask-materials` for signed-in users and falls back to local browser retrieval when cloud retrieval is unavailable
- Cloud material answers now hydrate from `material_questions` and `answer_citations` with stable client IDs to avoid duplicate answer history rows
- `supabase/functions/generate-quiz` for creating and storing quiz cards from retrieved indexed chunks
- `scripts/supabase-smoke.mjs` and the `Supabase Smoke Tests` workflow for non-destructive deployment checks against Supabase tables, Edge Functions, and static app assets
- `scripts/index-job-monitor.mjs` for service-role operational checks against failed, stale running, and overdue queued indexing jobs
- Optional authenticated smoke-user sign-in for RLS CRUD checks that create and clean up an isolated temporary course with child rows
- Authenticated storage smoke checks for private `course-materials` upload, download, signed URL, verification, and cleanup
- Optional seeded AI fixture smoke checks for deployed material Q&A and quiz generation over temporary vector chunks
- `docs/deployment-smoke-setup.md` for GitHub secrets, variables, Supabase setup, smoke-test modes, result interpretation, and cleanup notes
- `docs/production-hardening.md` for domain, auth redirect, monitoring, worker scheduling, rollback, and release checklist coverage
- `docs/production-validation.md` for recording final live smoke, monitor, and manual user-flow results without secrets

## Setup Steps

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and fill in browser-safe Supabase values for local frontend work.
3. Update `config.js` with the Supabase project URL and anon/publishable key for the deployed static frontend.
4. Install and log in to the Supabase CLI.
5. Link the project:

   ```powershell
   supabase link --project-ref your-project-ref
   ```

6. Apply the database migration:

   ```powershell
   supabase db push
   ```

7. Set Edge Function secrets:

   ```powershell
   supabase secrets set OPENAI_API_KEY=sk-proj-your-key
   supabase secrets set OPENAI_EMBEDDING_MODEL=text-embedding-3-small
   supabase secrets set OPENAI_ANSWER_MODEL=gpt-5-mini
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   supabase secrets set INDEX_WORKER_SECRET=replace-with-a-long-random-secret
   ```

8. Deploy the Edge Functions:

   ```powershell
   supabase functions deploy ask-materials
   supabase functions deploy index-material
   supabase functions deploy process-index-jobs
   supabase functions deploy generate-quiz
   ```

9. Schedule indexing worker retries with your preferred scheduler, cron service, or Supabase-supported scheduled runtime:

   ```powershell
   curl -X POST "https://your-project-ref.supabase.co/functions/v1/process-index-jobs" `
     -H "Content-Type: application/json" `
     -H "x-index-worker-secret: replace-with-a-long-random-secret" `
     -d "{\"limit\":3}"
   ```

10. Run deployment smoke checks:

   ```powershell
   $env:SUPABASE_URL="https://your-project-ref.supabase.co"
   $env:SUPABASE_ANON_KEY="your-supabase-anon-or-publishable-key"
   $env:AI_STUDY_APP_URL="https://timothychristian23.github.io/ai-study-planner"
   node scripts/supabase-smoke.mjs
   ```

   Optional authenticated RLS pass:

   ```powershell
   $env:SUPABASE_SMOKE_EMAIL="smoke-user@example.com"
   $env:SUPABASE_SMOKE_PASSWORD="dedicated-smoke-user-password"
   node scripts/supabase-smoke.mjs
   ```

   Optional AI fixture pass:

   ```powershell
   $env:SUPABASE_SMOKE_RUN_AI="1"
   $env:OPENAI_API_KEY="sk-proj-your-openai-key"
   node scripts/supabase-smoke.mjs
   ```

11. Review `docs/production-hardening.md` before publicly sharing the production-backed app.

## Next Implementation Steps

1. Run the full production smoke suite and indexing monitor against the real Supabase project after the latest migrations and functions are deployed.
2. Fill out `docs/production-validation.md` with the live deployment results and any release blockers.

## Security Notes

- OpenAI keys must never be exposed to the browser.
- Keep row-level security enabled on every exposed table.
- Storage object paths should start with the authenticated user ID so storage policies can isolate files.
- The current static demo should remain available while production features are added behind Supabase configuration.
