# Production Validation Report

Use this report after deploying the latest Supabase migrations, Edge Functions, worker schedule, and GitHub Pages build. Keep real API keys, access tokens, and service-role keys out of this file.

## Deployment Snapshot

- Validation date: 2026-09-23
- App URL: `https://timothychristian23.github.io/ai-study-planner`
- Supabase project: `yawmgfvdkfubazucgyec`
- Git commit: `f07617f` (`Add course and exam progress trends`)
- Database migrations applied: `0001_initial_schema.sql` through `0004_material_index_jobs.sql`
- Edge Functions deployed:
  - `ask-materials`
  - `index-material`
  - `process-index-jobs`
  - `generate-quiz`
- Edge Function secrets:
  - `AI_PROVIDER`: pending Gemini update
  - `GEMINI_API_KEY`: pending Gemini update
  - `OPENAI_API_KEY`: configured
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

## Optional AI Fixture

Command:

```powershell
$env:SUPABASE_SMOKE_RUN_AI="1"
$env:AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="your-gemini-api-key"
node scripts/supabase-smoke.mjs
```

Result:

- Fixture embeddings: blocked by OpenAI API billing before Gemini provider support was added
- Material Q&A: pending until Gemini credentials are configured or OpenAI credits are added
- Quiz generation: pending until Gemini credentials are configured or OpenAI credits are added
- Cleanup: passed; temporary AI smoke course, jobs, and storage objects were removed
- Notes: deployed Edge Functions have `OPENAI_API_KEY` and the validation reached OpenAI; indexing failed with `credit_balance_exhausted`, meaning the API organization has no prepaid credits remaining. Gemini provider support is the free-first cloud AI path; configure `AI_PROVIDER=gemini` and `GEMINI_API_KEY`, reprocess materials so chunks get Gemini embeddings, then rerun the optional AI validation. The app degrades to browser-local source-backed Q&A and quiz cards when cloud provider credits are unavailable.

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

- Ready for public portfolio sharing:
- Blockers:
- OpenAI API credit balance is exhausted. Configure Gemini credentials and redeploy/reprocess materials, or add OpenAI credits, before validating cloud AI indexing/Q&A/quiz generation. The portfolio app remains usable through local source-backed study fallbacks.
- Follow-up fixes:
- Rollback point:
