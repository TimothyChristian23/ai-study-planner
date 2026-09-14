# AI Study Planner

AI Study Planner is a portfolio app concept for turning course materials into a focused study system. Students can upload syllabi, notes, PDFs, assignments, and exam dates, then get a study schedule, quizzes, weak-topic tracking, and answers grounded in their own materials.

## First Version

This initial repo includes a dependency-free static prototype:

- Upload queue for syllabi, notes, PDFs, and assignments
- Study schedule preview organized around exam dates
- Quiz card generated from sample course materials
- Weak-topic tracker with priority levels
- Material-grounded answer panel for study questions

Open `index.html` in a browser to preview the current prototype.

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

See `docs/roadmap.md` for a phased build plan.
