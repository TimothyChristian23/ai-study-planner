# AI Study Planner

AI Study Planner is a production-backed portfolio app for turning course materials into a focused study system. Students can upload syllabi, notes, PDFs, assignments, and exam dates, then get adaptive study schedules, source-backed quizzes, weak-topic tracking, and AI answers grounded in their own materials.

[Live demo](https://timothychristian23.github.io/ai-study-planner/) | [Portfolio write-up](docs/portfolio-writeup.md) | [Production validation](docs/production-validation.md) | [Deployment notes](docs/deployment-smoke-setup.md)

## Live Demo

Try the deployed prototype:

https://timothychristian23.github.io/ai-study-planner/

## Screenshots

![AI Study Planner desktop dashboard](docs/assets/ai-study-planner-dashboard-desktop.png)

![AI Study Planner mobile dashboard](docs/assets/ai-study-planner-dashboard-mobile.png)

## Demo Walkthrough

1. Click `Load demo` to restore the seeded course, materials, deadlines, progress, and answer history.
2. Click `Generate plan` to build an adaptive study schedule from deadlines and weak topics.
3. Use the `Quiz` panel to reveal an answer, then mark it as `Needs review` or `Got it`.
4. Ask a question in `Ask materials` to see a grounded answer with cited source excerpts.
5. Export the plan with `Export calendar`, `Export report`, or `Sample backup`.

For the full cloud path, sign in with a Supabase test account, create a cloud course, upload a small text or PDF material, reprocess it, ask a question, and generate a quiz from the indexed chunks.

## What I Built

This repo contains a responsive, dependency-free frontend plus a validated Supabase backend. The browser app keeps a polished local demo path with seeded data, `localStorage` persistence, PDF/text indexing, study planning, retrieval-style answers, quizzes, exports, and mobile-friendly navigation.

The production path adds Supabase Auth, row-level security, private Storage uploads, cloud autosave, durable material indexing jobs, vector search, and Edge Functions for Gemini/OpenAI-backed Q&A and quiz generation. Gemini Flash-Lite is configured as the free-first cloud AI provider, with local source-backed fallbacks when cloud AI is unavailable.

The live Supabase deployment has been smoke-tested end to end: temporary auth user, private material upload, Gemini indexing, grounded material Q&A, Gemini quiz generation, and cleanup all passed.

## Tech Stack

- Frontend: static HTML, CSS, and JavaScript
- Persistence: `localStorage` for demo mode, Supabase Postgres for signed-in cloud mode
- Auth and storage: Supabase Auth, RLS policies, and private Storage buckets
- Backend: Supabase Edge Functions for indexing, Q&A, quiz generation, and background job processing
- AI: Gemini Flash-Lite and Gemini embeddings by default, with OpenAI support as an alternate provider
- Validation: GitHub Pages deployment, Supabase smoke tests, index job monitor, and production validation notes

## Feature Highlights

This repo currently includes:

- Upload queue for syllabi, notes, PDFs, and assignments
- Drag-and-drop or file picker material intake
- Local persistence for course name, exam date, daily study minutes, and uploaded material metadata
- Lightweight local indexing for `.txt`, `.md`, `.csv`, and PDF files
- Source search across uploaded material names, topics, and indexed passages
- Assignment, quiz, project, and exam deadline tracking
- Deadline suggestions extracted from uploaded syllabus or assignment text
- Study availability controls for preferred days and calendar start time
- Study schedule preview organized around exam dates
- Study session completion tracking with total minutes studied
- Focus session timer with quick notes and progress updates
- Progress insights for confidence, streak, completed sessions, and recent activity
- 7-day activity trend for study minutes and quiz attempts
- Course and exam progress trend cards tied to pace, weak topics, readiness, and plan completion
- Exam readiness score with risk signals and next-step recommendations
- Spaced-review queue that schedules due and upcoming reviews into generated plans
- Adaptive schedule priority that weighs low confidence, quiz misses, due reviews, and deadline pressure
- Downloadable `.ics` calendar export for generated study sessions
- Downloadable Markdown study report with plan, deadlines, weak topics, reviews, and activity
- JSON backup/import controls plus a downloadable seeded sample backup
- Source-backed quiz cards generated from indexed course materials
- Quiz attempt history with accuracy, streak, and recent results
- Weak-topic tracker with priority levels
- Quiz feedback that changes topic confidence and reprioritizes the plan
- Material-grounded answer panel with passage retrieval and citations
- Grounded answer history with recent questions and cited sources
- Supabase-auth-ready account panel with sign in, sign up, and sign out controls
- Cloud course picker for loading, syncing, and creating multiple planner records
- Supabase autosave for course setup, materials metadata, deadlines, schedules, progress, quiz attempts, and grounded question history, plus manual sync/load safety controls
- Cloud conflict resolution actions for loading cloud, keeping local, or overwriting a changed planner
- Signed-in Supabase Storage uploads for raw course files, with storage paths saved on material records
- Signed download and reprocess controls for cloud-stored course files
- Server-side material indexing for stored PDFs and text-like files, with durable jobs, retry metadata, chunking, optional Gemini/OpenAI embeddings, and local study mode when provider credits are unavailable
- Signed-in `Ask materials` answers from the authenticated retrieval Edge Function, with source-backed local retrieval fallback
- Signed-in quiz generation from indexed cloud material chunks, with source-backed local quiz fallback
- Responsive dashboard layout with mobile-friendly navigation and controls

For the most reliable PDF indexing, run a local static server and open the served URL:

```powershell
node scripts/dev-server.mjs
```

You can also open `index.html` directly in a browser for the non-PDF parts of the prototype.

## Deployment Smoke Tests

For the full deployment checklist, repository secrets, GitHub variables, and smoke-test interpretation guide, see `docs/deployment-smoke-setup.md`.

After applying Supabase migrations and deploying Edge Functions, run the non-destructive smoke checks:

```powershell
$env:SUPABASE_URL="https://your-project-ref.supabase.co"
$env:SUPABASE_ANON_KEY="your-supabase-anon-or-publishable-key"
$env:AI_STUDY_APP_URL="https://timothychristian23.github.io/ai-study-planner"
node scripts/supabase-smoke.mjs
```

For authenticated RLS CRUD coverage, create a dedicated Supabase test user and add:

```powershell
$env:SUPABASE_SMOKE_EMAIL="you+ai-study-smoke@your-domain.com"
$env:SUPABASE_SMOKE_PASSWORD="generated-dedicated-smoke-password"
node scripts/supabase-smoke.mjs
```

To run the optional AI fixture pass against deployed `ask-materials` and `generate-quiz`, also set a matching AI provider key:

```powershell
$env:AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="your-gemini-api-key"
$env:SUPABASE_SMOKE_RUN_AI="1"
node scripts/supabase-smoke.mjs
```

The smoke runner validates deployed table columns with `limit=0`, checks the static app assets when `AI_STUDY_APP_URL` is set, reaches deployed Edge Functions through validation paths that do not call an AI provider, and optionally signs in as the smoke user to create, read, update, and clean up an isolated temporary course with child rows. The authenticated pass also uploads, downloads, signs, verifies, and deletes a tiny file in the private `course-materials` bucket. The opt-in AI fixture seeds temporary vector chunks with the selected provider, calls deployed material Q&A and quiz generation, then cleans up through the same course cascade. GitHub Actions can run the same check from `Supabase Smoke Tests` when the `SUPABASE_URL` and `SUPABASE_ANON_KEY` repository secrets are set; add `SUPABASE_SMOKE_EMAIL` and `SUPABASE_SMOKE_PASSWORD` secrets to enable the authenticated CRUD and Storage pass, and set `SUPABASE_SMOKE_RUN_AI` plus `GEMINI_API_KEY` or `OPENAI_API_KEY` to enable the AI fixture. After deployment, `node scripts/index-job-monitor.mjs` can be run with `SUPABASE_SERVICE_ROLE_KEY` to check failed, stalled, and overdue indexing jobs.

## Product Goals

- Help students convert messy course materials into a practical plan
- Keep study sessions tied to upcoming assignments and exams
- Generate recall-based quizzes from the uploaded materials
- Track weak topics and recycle them into future study sessions
- Answer student questions using only trusted class materials

## Architecture Notes

- Static frontend keeps the public demo simple to deploy on GitHub Pages.
- Supabase Auth and RLS isolate each user's cloud courses, materials, deadlines, sessions, quiz attempts, and answer history.
- Private Supabase Storage keeps uploaded source files out of the public app bundle.
- Edge Functions handle server-side indexing, chunking, embedding, material Q&A, quiz generation, and background job retries.
- Gemini is the free-first AI provider; OpenAI can be enabled as an alternate server-side provider.
- Local source-backed planning, quiz, and answer fallbacks keep the portfolio demo usable without cloud credentials.

## Roadmap

See `docs/roadmap.md` for a phased build plan, `docs/data-model.md` for the MVP data model, `docs/production-upgrade.md` for the production migration plan, `docs/deployment-smoke-setup.md` for deployment smoke-test setup, `docs/production-hardening.md` for launch hardening and rollback, `docs/production-validation.md` for final live validation notes, and `docs/portfolio-writeup.md` for the portfolio case study with screenshots.
