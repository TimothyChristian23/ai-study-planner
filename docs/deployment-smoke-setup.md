# Deployment and Smoke Test Setup

Use this checklist after creating the Supabase project and before relying on the `Supabase Smoke Tests` GitHub Actions workflow.

For domain, auth redirect, monitoring, rollback, and release-readiness checks, use `docs/production-hardening.md` alongside this setup guide.

## Supabase Setup

1. Create or select the Supabase project for AI Study Planner.
2. Keep the `course-materials` Storage bucket private.
3. Apply database migrations:

   ```powershell
   supabase link --project-ref your-project-ref
   supabase db push
   ```

4. Set Edge Function secrets:

   ```powershell
   supabase secrets set AI_PROVIDER=gemini
   supabase secrets set GEMINI_API_KEY=your-gemini-api-key
   supabase secrets set GEMINI_EMBEDDING_MODEL=gemini-embedding-001
   supabase secrets set GEMINI_ANSWER_MODEL=gemini-3.5-flash-lite
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   supabase secrets set INDEX_WORKER_SECRET=replace-with-a-long-random-secret
   ```

5. Deploy Edge Functions:

   ```powershell
   supabase functions deploy ask-materials
   supabase functions deploy index-material
   supabase functions deploy process-index-jobs
   supabase functions deploy generate-quiz
   ```

6. Schedule the indexing worker with a cron service or Supabase-supported scheduled runtime:

   ```powershell
   curl -X POST "https://your-project-ref.supabase.co/functions/v1/process-index-jobs" `
     -H "Content-Type: application/json" `
     -H "x-index-worker-secret: replace-with-a-long-random-secret" `
     -d "{\"limit\":3}"
   ```

7. Create a dedicated smoke-test user in Supabase Auth.

Use a test-only email that you control, such as a plus-address on your own domain. Supabase may reject placeholder domains like `example.com`. Do not use a personal student account, a real student account, or a service-role key for browser or smoke-test configuration.

## Static App Config

Update `config.js` for the deployed static frontend:

```js
window.AI_STUDY_PLANNER_CONFIG = {
  supabaseUrl: "https://your-project-ref.supabase.co",
  supabaseAnonKey: "your-supabase-anon-or-publishable-key",
};
```

The anon/publishable key is browser-safe only when row-level security remains enabled.

## GitHub Repository Secrets

Add these under `Settings -> Secrets and variables -> Actions -> Secrets`.

| Secret | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL used by the smoke runner. |
| `SUPABASE_ANON_KEY` | Yes | Browser-safe anon/publishable key used by REST, Auth, Storage, and Edge Function requests. |
| `SUPABASE_SMOKE_EMAIL` | Recommended | Dedicated smoke-test user email for authenticated RLS, Storage, Q&A, and quiz checks. |
| `SUPABASE_SMOKE_PASSWORD` | Recommended | Dedicated smoke-test user password. |
| `SUPABASE_SMOKE_ACCESS_TOKEN` | Optional | Temporary signed-in user token if not using email/password. |
| `GEMINI_API_KEY` | Optional | Enables the Gemini opt-in AI fixture smoke pass and should match the Edge Function secret when `AI_PROVIDER=gemini`. |
| `OPENAI_API_KEY` | Optional | Enables the OpenAI opt-in AI fixture smoke pass and should match the Edge Function secret when `AI_PROVIDER=openai`. |
| `GEMINI_EMBEDDING_MODEL` | Optional | Defaults to `gemini-embedding-001` with 1536 output dimensions. |
| `OPENAI_EMBEDDING_MODEL` | Optional | Defaults to `text-embedding-3-small`; keep this at 1536 dimensions for the current vector schema. |

Never add `SUPABASE_SERVICE_ROLE_KEY` to the static app or smoke workflow.

## GitHub Repository Variables

Add these under `Settings -> Secrets and variables -> Actions -> Variables`.

| Variable | Recommended value | Purpose |
| --- | --- | --- |
| `AI_STUDY_APP_URL` | `https://timothychristian23.github.io/ai-study-planner` | Static app URL checked by the smoke runner. |
| `AI_PROVIDER` | `gemini` | Provider used by the optional AI fixture; match the deployed Edge Function secret. |
| `SUPABASE_SMOKE_RUN_AI` | `false` by default | Set to `true` or `1` only when you want the workflow to call provider-backed deployed functions. |

## Local Smoke Runs

Basic deployment checks:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_ANON_KEY="your-supabase-anon-or-publishable-key"
$env:AI_STUDY_APP_URL="https://timothychristian23.github.io/ai-study-planner"
node scripts/supabase-smoke.mjs
```

Authenticated RLS and Storage checks:

```powershell
$env:SUPABASE_SMOKE_EMAIL="you+ai-study-smoke@your-domain.com"
$env:SUPABASE_SMOKE_PASSWORD="generated-dedicated-smoke-password"
node scripts/supabase-smoke.mjs
```

Optional AI fixture checks:

```powershell
$env:SUPABASE_SMOKE_RUN_AI="1"
$env:AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="your-gemini-api-key"
node scripts/supabase-smoke.mjs
```

The AI fixture seeds temporary vector chunks with the selected provider, calls deployed material Q&A and quiz generation, and deletes the smoke course afterward so database rows cascade away. Set `AI_PROVIDER=openai` and `OPENAI_API_KEY` instead if the deployed Edge Functions are using OpenAI.

## GitHub Actions

The `Supabase Smoke Tests` workflow runs:

- manually from the Actions tab with `workflow_dispatch`
- automatically after a successful `Deploy to GitHub Pages` workflow

If `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing, the workflow logs a skip message instead of failing the Pages deploy.

## Reading Results

- `PASS` means the check behaved as expected.
- `WARN` means a check was intentionally skipped or blocked by missing optional setup. Examples: no smoke user, AI fixture disabled, or Edge Function JWT validation blocking deeper validation.
- `FAIL` means the deployment, schema, policies, storage bucket, secrets, or function behavior needs attention.

The smoke runner is intentionally safe by default. It does not create user data unless a smoke user or token is configured, and it does not call Gemini or OpenAI unless `SUPABASE_SMOKE_RUN_AI` is enabled.

## Cleanup Notes

Authenticated smoke checks create temporary courses with a client ID beginning with `ai-study-smoke` unless `SUPABASE_SMOKE_CLIENT_PREFIX` is changed. Normal cleanup deletes the smoke course, which cascades child rows. Storage smoke checks also delete their temporary file.

If cleanup fails, rerun the smoke test after fixing the deployment or delete temporary rows manually:

```sql
delete from public.courses
where client_id like 'ai-study-smoke-%';
```

For Storage leftovers, remove objects under the smoke user's folder that include the same smoke client ID prefix.
