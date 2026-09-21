# Production Validation Report

Use this report after deploying the latest Supabase migrations, Edge Functions, worker schedule, and GitHub Pages build. Keep real API keys, access tokens, and service-role keys out of this file.

## Deployment Snapshot

- Validation date: 2026-09-21
- App URL: `http://localhost:4173` for local smoke; GitHub Pages redeploy pending after commit push
- Supabase project: `yawmgfvdkfubazucgyec`
- Git commit: deployment/config commit in repository history
- Database migrations applied: `0001_initial_schema.sql` through `0004_material_index_jobs.sql`
- Edge Functions deployed:
  - `ask-materials`
  - `index-material`
  - `process-index-jobs`
  - `generate-quiz`
- Worker schedule: pending
- Smoke-test user: pending

## Smoke Suite

Command:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_ANON_KEY="your-supabase-anon-or-publishable-key"
$env:AI_STUDY_APP_URL="https://timothychristian23.github.io/ai-study-planner"
$env:SUPABASE_SMOKE_EMAIL="smoke-user@example.com"
$env:SUPABASE_SMOKE_PASSWORD="dedicated-smoke-user-password"
node scripts/supabase-smoke.mjs
```

Result:

- Static app assets: passed against `http://localhost:4173`
- REST schema: passed for all checked tables
- Edge Function validation: passed for validation-only paths that do not call OpenAI
- Authenticated RLS CRUD: not run; smoke-test user credentials were not configured
- Authenticated Storage: not run; smoke-test user credentials were not configured
- Cleanup: no authenticated fixture data created
- Notes: 25 passed, 1 warning, 0 failed with `NODE_OPTIONS=--use-system-ca`

## Optional AI Fixture

Command:

```powershell
$env:SUPABASE_SMOKE_RUN_AI="1"
$env:OPENAI_API_KEY="sk-proj-your-openai-key"
node scripts/supabase-smoke.mjs
```

Result:

- Fixture embeddings: pending
- Material Q&A: pending
- Quiz generation: pending
- Cleanup: pending
- Notes: requires `OPENAI_API_KEY` and smoke-test user credentials

## Index Job Monitor

Command:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/index-job-monitor.mjs
```

Result:

- Failed jobs: pending
- Stale running jobs: pending
- Overdue queued jobs: pending
- Material index status counts: pending
- Notes: requires local `SUPABASE_SERVICE_ROLE_KEY`

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
- Follow-up fixes:
- Rollback point:
