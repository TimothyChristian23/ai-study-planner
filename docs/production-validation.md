# Production Validation Report

Use this report after deploying the latest Supabase migrations, Edge Functions, worker schedule, and GitHub Pages build. Keep real API keys, access tokens, and service-role keys out of this file.

## Deployment Snapshot

- Validation date:
- App URL:
- Supabase project:
- Git commit:
- Database migrations applied:
- Edge Functions deployed:
  - `ask-materials`
  - `index-material`
  - `process-index-jobs`
  - `generate-quiz`
- Worker schedule:
- Smoke-test user:

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

- Static app assets:
- REST schema:
- Edge Function validation:
- Authenticated RLS CRUD:
- Authenticated Storage:
- Cleanup:
- Notes:

## Optional AI Fixture

Command:

```powershell
$env:SUPABASE_SMOKE_RUN_AI="1"
$env:OPENAI_API_KEY="sk-proj-your-openai-key"
node scripts/supabase-smoke.mjs
```

Result:

- Fixture embeddings:
- Material Q&A:
- Quiz generation:
- Cleanup:
- Notes:

## Index Job Monitor

Command:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/index-job-monitor.mjs
```

Result:

- Failed jobs:
- Stale running jobs:
- Overdue queued jobs:
- Material index status counts:
- Notes:

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
