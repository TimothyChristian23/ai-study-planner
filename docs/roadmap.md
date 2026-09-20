# Roadmap

## Phase 1: Static Prototype

- [x] Build the landing dashboard
- [x] Mock upload state, study schedule, quiz, and weak-topic panels
- [x] Define course, material, quiz, and progress data models
- [x] Add local material intake with file picker and drag-and-drop
- [x] Persist course setup and uploaded material metadata in local storage
- [x] Index basic text files for first-pass material-grounded answers
- [x] Extract searchable text from uploaded PDFs in the browser
- [x] Add local source search across indexed materials
- [x] Document the prototype and MVP data models
- [x] Track quiz feedback by topic in local storage
- [x] Generate adaptive study sessions from weak topics and exam timing
- [x] Add assignment, quiz, project, and exam deadline tracking
- [x] Suggest deadlines from uploaded syllabus and assignment text
- [x] Blend urgent deadlines into generated study sessions
- [x] Respect preferred study days and start time in schedules
- [x] Generate source-backed quiz cards from indexed material text
- [x] Add answer reveal with material source attribution
- [x] Track quiz attempt history and accuracy
- [x] Add local passage retrieval for material-grounded answers
- [x] Show grounding confidence and cited source excerpts
- [x] Track recent grounded questions and cited sources
- [x] Track completed study sessions and minutes studied
- [x] Add focus session timer with notes
- [x] Feed completed sessions back into topic confidence
- [x] Show progress insights for confidence, streak, and recent sessions
- [x] Add exam readiness scoring with recommended next moves
- [x] Show 7-day activity trend for study and quiz momentum
- [x] Add spaced repetition review queue for due topics
- [x] Export a Markdown study report from local planner data
- [x] Add JSON backup/import and seeded demo restore controls
- [x] Export generated study sessions as an `.ics` calendar file

## Phase 2: Functional MVP

- [x] Scaffold Supabase schema, storage, RLS policies, and Edge Function foundation
- [x] Add authentication UI
- [x] Connect authenticated sessions to persisted planner records
- [x] Store courses, deadlines, assignments, and study sessions
- [x] Upload source files to private Supabase Storage
- [x] Parse uploaded PDFs and text files server-side
- [x] Persist generated schedules from deadlines and available study time
- [x] Replace manual sync/load with autosave and conflict handling
- [x] Add per-course selection for multiple cloud planners
- [x] Add cloud conflict resolution actions
- [x] Add signed download and reprocess controls for stored files
- [x] Add cloud material indexing status and retry metadata

## Phase 3: AI Study Engine

- [x] Add vector-ready material chunk schema and material Q&A function shell
- [x] Chunk and embed course materials
- [x] Retrieve relevant passages for user questions
- [x] Generate quizzes from selected materials
- [x] Cite source documents in AI answers

## Phase 4: Adaptive Learning

- Track quiz performance by topic
- Prioritize weak topics in new schedules
- Add spaced repetition review sessions
- Show progress trends by course and exam

## Phase 5: Portfolio Polish

- [x] Polish seeded demo reset and sample backup workflow
- [x] Add responsive mobile experience
- [x] Add screenshots and project write-up
- [x] Prepare GitHub Pages deployment workflow
- [x] Deploy publicly with seeded sample materials
