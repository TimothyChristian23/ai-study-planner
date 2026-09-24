# Production Hardening Runbook

Use this checklist when moving AI Study Planner from a portfolio prototype into a publicly reliable Supabase-backed demo.

## Domain and Frontend

- Confirm the live app URL is the only production URL linked from the portfolio and README.
- If using a custom domain, configure DNS for GitHub Pages, add the domain in repository Pages settings, and enforce HTTPS.
- Keep `config.js` limited to browser-safe values only:

  ```js
  window.AI_STUDY_PLANNER_CONFIG = {
    supabaseUrl: "https://your-project-ref.supabase.co",
    supabaseAnonKey: "your-supabase-anon-or-publishable-key",
  };
  ```

- Never place `GEMINI_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `INDEX_WORKER_SECRET` in frontend files, GitHub Pages variables, screenshots, or client-side JavaScript.

## Supabase Auth

- Set the Supabase Auth site URL to the production app URL.
- Add redirect URLs for:
  - production GitHub Pages or custom domain
  - local development, such as `http://localhost:4173`
- Review email confirmation and password recovery templates so links point back to the production app.
- Keep the smoke-test user separate from personal or demo accounts.

## Secrets and Access

- Store Edge Function secrets only in Supabase:

  ```powershell
  supabase secrets set AI_PROVIDER=gemini
  supabase secrets set GEMINI_API_KEY=your-gemini-api-key
  supabase secrets set GEMINI_EMBEDDING_MODEL=gemini-embedding-001
  supabase secrets set GEMINI_ANSWER_MODEL=gemini-2.5-flash
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  supabase secrets set INDEX_WORKER_SECRET=replace-with-a-long-random-secret
  ```

- Store GitHub smoke-test secrets only under repository Actions secrets.
- Do not add `SUPABASE_SERVICE_ROLE_KEY` to GitHub Actions unless a future workflow truly needs server-side admin access.
- Rotate `INDEX_WORKER_SECRET` if worker logs, scheduler config, or copied commands are ever exposed.

## Worker Scheduling

Schedule `process-index-jobs` to run every few minutes. Keep the batch size small enough that one invocation has time to finish.

```powershell
curl -X POST "https://your-project-ref.supabase.co/functions/v1/process-index-jobs" `
  -H "Content-Type: application/json" `
  -H "x-index-worker-secret: replace-with-a-long-random-secret" `
  -d "{\"limit\":3}"
```

Operational expectations:

- `limit` must stay between `1` and `5`.
- Manual indexing still tries to process immediately from `index-material`.
- The worker should recover queued jobs and stale running jobs older than 10 minutes.
- If AI provider rate limits increase, lower the schedule frequency or reduce `limit`.

## Monitoring

Check these after every deploy and at least once during a public demo period:

- Supabase Edge Function logs for `ask-materials`, `index-material`, `process-index-jobs`, and `generate-quiz`
- Supabase Auth logs for repeated failed sign-ins or redirect problems
- Supabase Storage usage and rejected object requests
- Gemini/OpenAI usage and error rate
- GitHub Actions smoke-test results
- Failed or stalled indexing jobs

Run the indexing operations monitor with a server-side key:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/index-job-monitor.mjs
```

Optional thresholds:

```powershell
$env:INDEX_MONITOR_FAILED_THRESHOLD="0"
$env:INDEX_MONITOR_STALE_RUNNING_THRESHOLD="0"
$env:INDEX_MONITOR_OVERDUE_QUEUED_THRESHOLD="20"
$env:INDEX_MONITOR_STALE_MINUTES="10"
$env:INDEX_MONITOR_DETAIL_LIMIT="10"
node scripts/index-job-monitor.mjs
```

Useful SQL checks:

```sql
select id, material_id, attempts, max_attempts, error, updated_at
from public.material_index_jobs
where status = 'failed'
order by updated_at desc
limit 20;
```

```sql
select id, material_id, attempts, locked_at, updated_at
from public.material_index_jobs
where status = 'running'
  and locked_at < now() - interval '10 minutes'
order by locked_at asc;
```

```sql
select index_status, count(*)
from public.materials
group by index_status
order by index_status;
```

## Smoke Tests

Run the smoke suite after database migrations, function deploys, secret changes, and domain changes.

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_ANON_KEY="your-supabase-anon-or-publishable-key"
$env:AI_STUDY_APP_URL="https://timothychristian23.github.io/ai-study-planner"
$env:SUPABASE_SMOKE_EMAIL="you+ai-study-smoke@your-domain.com"
$env:SUPABASE_SMOKE_PASSWORD="generated-dedicated-smoke-password"
node scripts/supabase-smoke.mjs
```

Enable the AI fixture only when you intentionally want to call Gemini or OpenAI:

```powershell
$env:SUPABASE_SMOKE_RUN_AI="1"
$env:AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="your-gemini-api-key"
node scripts/supabase-smoke.mjs
```

## Rollback

Frontend rollback:

- Revert the bad commit or redeploy the last known-good commit through GitHub Pages.
- Recheck `config.js` after rollback so the deployed static app still points at the intended Supabase project.
- Run the smoke suite against the restored URL.

Edge Function rollback:

- Check out the last known-good commit.
- Redeploy only the affected function first.
- Run the validation path for that function through `scripts/supabase-smoke.mjs`.

Database rollback:

- Prefer forward-fix migrations for already-applied production schema changes.
- Avoid destructive rollback SQL unless the affected tables and storage paths have been backed up.
- If indexing jobs are causing trouble, pause the scheduler first, then repair or cancel rows in `material_index_jobs`.

Worker rollback:

- Disable the scheduler or rotate `INDEX_WORKER_SECRET`.
- Confirm `process-index-jobs` returns `401` without the current secret.
- Re-enable the scheduler after the function and migration state are verified.

## Release Checklist

- `supabase db push` completed successfully.
- All Edge Functions deployed.
- Required Supabase secrets are set.
- Worker schedule is active and uses the current `INDEX_WORKER_SECRET`.
- Supabase Auth URLs match the production and local app URLs.
- GitHub Pages build/deploy completed.
- Smoke tests pass for schema, Edge Function validation, static assets, RLS CRUD, Storage, and optional AI fixture.
- README live demo link opens the expected app.
- Failed indexing job count is understood before public sharing.
