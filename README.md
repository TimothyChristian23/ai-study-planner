# AI Study Planner

AI Study Planner is a portfolio app concept for turning course materials into a focused study system. Students can upload syllabi, notes, PDFs, assignments, and exam dates, then get a study schedule, quizzes, weak-topic tracking, and answers grounded in their own materials.

## First Version

This repo currently includes a dependency-free static prototype with the first functional intake step:

- Upload queue for syllabi, notes, PDFs, and assignments
- Drag-and-drop or file picker material intake
- Local persistence for course name, exam date, daily study minutes, and uploaded material metadata
- Lightweight local indexing for `.txt`, `.md`, `.csv`, and PDF files
- Assignment, quiz, project, and exam deadline tracking
- Study schedule preview organized around exam dates
- Study session completion tracking with total minutes studied
- Focus session timer with quick notes and progress updates
- Progress insights for confidence, streak, completed sessions, and recent activity
- Spaced-review queue that schedules topics by confidence and review recency
- Downloadable `.ics` calendar export for generated study sessions
- Downloadable Markdown study report with plan, deadlines, weak topics, reviews, and activity
- JSON backup/import controls for moving local planner data between browsers or restoring demos
- Source-backed quiz cards generated from indexed course materials
- Weak-topic tracker with priority levels
- Quiz feedback that changes topic confidence and reprioritizes the plan
- Material-grounded answer panel with passage retrieval and citations

For the most reliable PDF indexing, run a local static server and open the served URL:

```powershell
node scripts/dev-server.mjs
```

You can also open `index.html` directly in a browser for the non-PDF parts of the prototype.

## Product Goals

- Help students convert messy course materials into a practical plan
- Keep study sessions tied to upcoming assignments and exams
- Generate recall-based quizzes from the uploaded materials
- Track weak topics and recycle them into future study sessions
- Answer student questions using only trusted class materials

## Suggested Tech Direction

- Frontend: React, Next.js, or Vite once the prototype graduates from static HTML
- Backend: Node.js API routes or FastAPI
- Storage: Supabase or PostgreSQL for users, courses, files, and progress
- AI: Retrieval augmented generation over parsed class materials
- File processing: PDF/text extraction, chunking, embeddings, and source citations

## Roadmap

See `docs/roadmap.md` for a phased build plan and `docs/data-model.md` for the MVP data model.
