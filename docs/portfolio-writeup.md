# AI Study Planner Portfolio Write-Up

AI Study Planner is a browser-based portfolio prototype that turns course materials, deadlines, and weak-topic feedback into a practical study workflow. The project demonstrates product thinking, local file handling, source-grounded retrieval patterns, adaptive scheduling, and progress visualization without requiring a backend.

## Screenshots

![AI Study Planner desktop dashboard](assets/ai-study-planner-dashboard-desktop.png)

![AI Study Planner mobile dashboard](assets/ai-study-planner-dashboard-mobile.png)

## Problem

Students often know they need to study, but their course information is scattered across PDFs, syllabi, lecture notes, assignments, and exam announcements. The hard part is converting that pile into a specific plan: what to review, when to review it, and which weak topics need more practice.

## Solution

The app gives students one local planning surface where they can upload course materials, set deadlines, generate a schedule, run focus sessions, quiz themselves, and ask questions grounded in indexed course text. The prototype keeps all data in the browser so the demo is easy to run and inspect.

## Key Features

- Local material intake for PDFs, text, Markdown, and CSV files
- Browser PDF/text indexing for source search, quiz generation, and grounded answers
- Deadline tracking plus local deadline suggestions from syllabus or assignment text
- Adaptive schedule generation based on weak topics, due dates, preferred study days, and start time
- Topic priority scoring that raises low-confidence, missed, review-due, and deadline-sensitive topics
- Focus timer with completion notes that feed back into topic confidence
- Source-backed quiz cards, quiz history, accuracy, and streak tracking
- Spaced-review queue with due reviews inserted into generated plans, plus exam readiness scoring
- Material-grounded answers with citations and recent question history
- Markdown report export, `.ics` calendar export, JSON backup/import, and seeded sample backup
- Responsive dashboard layout for desktop and mobile portfolio review

## Technical Notes

The first version is intentionally dependency-free: static HTML, CSS, and JavaScript with `localStorage` persistence. PDF parsing uses PDF.js from a CDN when served from the local static server. The retrieval prototype scores indexed passages with local keyword/topic matching, which keeps the demo understandable while mapping cleanly to a future embedding-based RAG system.

The production foundation extends the static prototype with Supabase Auth, row-level security, private Storage uploads, Edge Functions, vector-ready material chunks, OpenAI-backed Q&A and quiz generation, durable indexing jobs, deployment smoke tests, and an operations monitor for failed or stalled indexing work.

## Production Validation

The final production-backed validation should be recorded in `production-validation.md` after migrations, Edge Functions, worker scheduling, and smoke tests are run against the live Supabase project. Keep secrets out of the report and capture only outcomes, blockers, and release notes.

## Product Decisions

- Keep source citations visible so answers feel grounded rather than magical.
- Treat weak-topic confidence as a shared signal across quizzes, sessions, readiness, and schedule priority.
- Blend quiz misses, due reviews, and deadline pressure into schedule priority so the plan responds to student behavior.
- Include backup and sample-demo workflows so reviewers can reset or move a portfolio state quickly.
- Export reports and calendars because students need artifacts they can use outside the app.

## Future Build

The next product step is tightening adaptive learning across cloud quiz history, topic progress, and generated schedules. The production foundation already has the main backend pieces for authentication, durable course storage, file object storage, extracted material chunks, embeddings, and AI-generated answers over retrieved chunks.
