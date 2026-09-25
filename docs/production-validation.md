# Production Validation Report

Use this report after deploying the latest Supabase migrations, Edge Functions, worker schedule, and GitHub Pages build. Keep real API keys, access tokens, and service-role keys out of this file.

## Deployment Snapshot

- Validation date: 2026-09-25
- App URL: `https://timothychristian23.github.io/ai-study-planner`
- Supabase project: `yawmgfvdkfubazucgyec`
- Git commit: `main` after Gemini Flash-Lite provider validation
- Database migrations applied: `0001_initial_schema.sql` through `0005_ai_provider_embeddings.sql`
- Edge Functions deployed:
  - `ask-materials`
  - `index-material`
  - `process-index-jobs`
  - `generate-quiz`
- Edge Function secrets:
  - `AI_PROVIDER`: `gemini`
  - `GEMINI_API_KEY`: configured
  - `GEMINI_EMBEDDING_MODEL`: `gemini-embedding-001`
  - `GEMINI_ANSWER_MODEL`: `gemini-3.5-flash-lite`
  - `OPENAI_API_KEY`: optional fallback only
  - `INDEX_WORKER_SECRET`: configured
- Worker schedule: active through Supabase Cron as `ai-study-process-index-jobs` every 5 minutes
- Smoke-test user: configured for validation; password rotated after smoke run

## Smoke Suite

Command:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_ANON_KEY="your-supabase-anon-or-publishable-key"
$env:AI_STUDY_APP_URL="https://timothychristian23.github.io/ai-study-planner"
$env:SUPABASE_SMOKE_EMAIL="you+ai-study-smoke@your-domain.com"
$env:SUPABASE_SMOKE_PASSWORD="generated-dedicated-smoke-password"
node scripts/supabase-smoke.mjs
```

Result:

- Static app assets: passed against `https://timothychristian23.github.io/ai-study-planner`
- REST schema: passed for all checked tables
- Edge Function validation: passed for validation-only paths that do not call an AI provider
- Authenticated RLS CRUD: passed with isolated smoke course and child rows
- Authenticated Storage: passed upload, download, signed URL, and cleanup
- Cleanup: passed; smoke course and storage object were deleted
- Latest authenticated notes: 38 passed, 1 warning, 0 failed with `NODE_OPTIONS=--use-system-ca`; the remaining warning is the optional AI fixture because a local AI provider key was not set for seeded embeddings
- Previous public notes: 25 passed, 1 warning, 0 failed with `NODE_OPTIONS=--use-system-ca`; GitHub Pages deploy and GitHub-hosted `Supabase Smoke Tests` workflow both completed successfully

## Live Gemini AI Fixture

Execution:

A local one-off live smoke loaded `SUPABASE_SERVICE_ROLE_KEY` from the Supabase CLI without printing it, created a temporary confirmed auth user, uploaded a temporary material, invoked deployed `index-material`, `ask-materials`, and `generate-quiz`, then deleted the temporary rows, storage object, and auth user.

Result:

- Temporary auth user creation and sign-in: passed
- Private Storage upload: passed with a temporary text material
- Deployed `index-material`: passed with Gemini embeddings and one stored chunk
- Stored chunk metadata: passed with `embedding_provider = gemini`
- Deployed `ask-materials`: passed with one grounded citation
- Deployed `generate-quiz`: passed with one cloud-generated quiz card
- Cleanup: passed; temporary course rows, storage object, and auth user were removed
- Latest live result: 12 passed, 0 warnings, 0 failed using `GEMINI_ANSWER_MODEL=gemini-3.5-flash-lite`
- Notes: `gemini-3.8-flash` intermittently returned provider 503 high-demand errors during quiz generation. The app now uses retry/backoff for transient AI provider statuses and defaults Gemini answers to the lighter free-first `gemini-3.5-flash-lite` model.

## Index Job Monitor

Command:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/index-job-monitor.mjs
```

Result:

- Failed jobs: no rows in `material_index_jobs` during validation
- Stale running jobs: no rows in `material_index_jobs` during validation
- Overdue queued jobs: no rows in `material_index_jobs` during validation
- Material index status counts: no queued material index jobs found during validation
- Notes: Supabase Cron job `ai-study-process-index-jobs` is active on a 5-minute schedule; a manual Vault-backed worker trigger returned HTTP 200 with `mode: "worker"` and `claimed: 0`

## Manual User Flow

Validate with a dedicated test account:

- Sign up or sign in.
- Create or load a cloud course.
- Upload a small text or PDF material.
- Confirm private storage upload succeeds.
- Index or reprocess the material.
- Ask a question from the uploaded material.
- Generate a quiz from indexed chunks.
- Mark one quiz answer as `Got it` and one as `Needs review`.
- Generate a plan and confirm weak topics/deadlines influence it.
- Reload the app and confirm cloud data hydrates.
- Sign out and confirm no private data remains visible.

Result:

- Auth:
- Upload:
- Indexing:
- Material Q&A:
- Quiz generation:
- Planner persistence:
- Sign-out privacy:
- Notes:

## Release Decision

- Ready for public portfolio sharing: yes
- Blockers: none from the latest production smoke run
- Follow-up fixes: rotate Supabase keys before treating the project as production-sensitive if any service-role value was exposed in local terminal history, and run one manual browser walkthrough with the dedicated smoke account after any future UI changes
- Rollback point:
