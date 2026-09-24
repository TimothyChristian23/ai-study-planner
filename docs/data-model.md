# Data Model

This document captures the local data shape used by the static prototype and the suggested database shape for the MVP.

## Local Prototype State

```js
{
  course: {
    name: "Data Structures",
    examDate: "2026-10-18",
    dailyMinutes: 45,
    preferredStartTime: "18:00",
    studyDays: [1, 2, 3, 4, 5]
  },
  materials: [
    {
      id: "uuid",
      name: "Lecture 7 - Graph Traversal.pdf",
      type: "Notes",
      status: "PDF indexed",
      size: 184000,
      uploadedAt: "2026-09-14T12:08:00.000Z",
      text: "extracted text capped for the browser prototype",
      pageCount: 18,
      indexedPages: 18,
      topics: ["Graph traversal"],
      storageBucket: "course-materials",
      storagePath: "user-id/default-course/uuid/Lecture-7-Graph-Traversal.pdf",
      cloudStatus: "Cloud file saved"
    }
  ],
  deadlines: [
    {
      id: "uuid",
      title: "Assignment 3",
      type: "Assignment",
      dueDate: "2026-09-24",
      topic: "Graph traversal",
      completed: false,
      createdAt: "2026-09-14T12:10:00.000Z"
    }
  ],
  suggestedDeadlines: [
    {
      id: "uuid",
      title: "Assignment 4",
      type: "Assignment",
      dueDate: "2026-10-02",
      topic: "Graph traversal",
      confidence: "High",
      excerpt: "Assignment 4 is due October 2 before class.",
      sourceMaterialId: "uuid",
      sourceMaterialName: "Syllabus.pdf",
      createdAt: "2026-09-14T12:12:00.000Z"
    }
  ],
  topicProgress: {
    "Graph traversal": {
      confidence: 58,
      attempts: 3,
      misses: 1,
      studySessions: 2,
      lastReviewedAt: "2026-09-14T18:30:00.000Z"
    }
  },
  schedule: [
    {
      day: "Sep 15",
      dateKey: "2026-09-15",
      task: "Repair weak spot: Graph traversal",
      time: "45 min",
      focus: "Graph traversal",
      reason: "58% confidence - Lecture 7 - Graph Traversal.pdf"
    }
  ],
  completedSessions: {
    "Sep 15|Repair weak spot: Graph traversal|Graph traversal": {
      id: "Sep 15|Repair weak spot: Graph traversal|Graph traversal",
      task: "Repair weak spot: Graph traversal",
      focus: "Graph traversal",
      minutes: 45,
      completedAt: "2026-09-14T19:05:00.000Z",
      notes: "Reworked BFS queue examples."
    }
  },
  quizHistory: [
    {
      id: "uuid",
      topic: "Graph traversal",
      question: "Explain how \"bfs\" is used in this source.",
      source: "Lecture 7 - Graph Traversal.txt",
      result: "hit",
      confidenceAfter: 67,
      answeredAt: "2026-09-14T19:15:00.000Z"
    }
  ],
  answerHistory: [
    {
      id: "uuid",
      question: "What should I review before the graph traversal quiz?",
      answer: "Based on Lecture 7, review BFS queue behavior and DFS recursion order.",
      grounding: "Grounding: strong",
      citations: [
        {
          source: "Lecture 7 - Graph Traversal.txt",
          topic: "Graph traversal",
          snippet: "BFS uses a queue and is preferred when exploring by distance.",
          score: 6
        }
      ],
      askedAt: "2026-09-14T19:20:00.000Z"
    }
  ],
  materialSearchQuery: "graph traversal",
  focusSession: {
    selectedSessionId: "Sep 15|Repair weak spot: Graph traversal|Graph traversal",
    secondsRemaining: 1800,
    isRunning: false,
    startedAt: null,
    notes: "Reworked BFS queue examples."
  },
  questionIndex: 0
}
```

## MVP Tables

### users

- `id`
- `email`
- `created_at`

### courses

- `id`
- `user_id`
- `client_id`
- `name`
- `term`
- `exam_date`
- `daily_minutes`
- `preferred_start_time`
- `study_days`
- `created_at`
- `updated_at`

### materials

- `id`
- `client_id`
- `course_id`
- `file_name`
- `file_type`
- `storage_path`
- `status`
- `size_bytes`
- `page_count`
- `indexed_pages`
- `created_at`

### deadlines

- `id`
- `client_id`
- `course_id`
- `title`
- `type`
- `due_date`
- `topic`
- `completed`
- `created_at`
- `updated_at`

### material_chunks

- `id`
- `material_id`
- `chunk_index`
- `content`
- `embedding`
- `source_page`
- `created_at`

### material_index_jobs

- `id`
- `course_id`
- `material_id`
- `user_id`
- `status`
- `requested_by`
- `priority`
- `attempts`
- `max_attempts`
- `chunk_count`
- `error`
- `run_after`
- `locked_at`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

### answer_citations

- `id`
- `client_id`
- `course_id`
- `material_chunk_id`
- `material_question_id`
- `question`
- `answer_excerpt`
- `source_material_name`
- `topic`
- `match_score`
- `created_at`

### material_questions

- `id`
- `client_id`
- `course_id`
- `question`
- `answer`
- `grounding`
- `created_at`

### study_sessions

- `id`
- `client_id`
- `course_id`
- `scheduled_for`
- `duration_minutes`
- `focus_topic`
- `status`
- `created_at`

### study_session_logs

- `id`
- `client_id`
- `study_session_id`
- `course_id`
- `focus_topic`
- `minutes`
- `notes`
- `completed_at`

### quiz_items

- `id`
- `course_id`
- `material_chunk_id`
- `topic`
- `question`
- `answer`
- `source_material_name`
- `source_excerpt`
- `created_at`

### quiz_attempts

- `id`
- `client_id`
- `course_id`
- `quiz_item_id`
- `topic`
- `question`
- `source_material_name`
- `result`
- `confidence_after`
- `answered_at`

### topic_progress

- `id`
- `course_id`
- `topic`
- `confidence_score`
- `study_sessions`
- `quiz_attempts`
- `quiz_misses`
- `last_reviewed_at`
- `updated_at`

## Notes

- The browser prototype stores extracted text in `localStorage`, which is only appropriate for demo use.
- Local JSON backups wrap this state as `{ schemaVersion, exportedAt, app, state }` so demos can be moved between browsers.
- The seeded sample backup uses the same JSON shape as user exports, with sample schedule, progress, quiz history, and grounded answer history.
- Generated schedule items include `dateKey` so the same local plan can drive both the UI and `.ics` calendar export.
- Course availability stores preferred study days as JavaScript day numbers, where `0` is Sunday and `6` is Saturday.
- Exam readiness is derived from confidence, plan completion, deadline timing, due reviews, and available materials; it is not stored separately.
- Adaptive schedule priority is derived from `topicProgress`, quiz misses, due spaced reviews, deadline timing, and material/topic frequency; it is recalculated when plans are generated.
- Generated schedules reserve alternating slots for the highest-priority due or soon spaced reviews so completing those sessions updates `lastReviewedAt`.
- Suggested deadlines are extracted locally from uploaded material text and kept separate until the student accepts them.
- Material search uses local indexed text and file metadata until server-side parsing lands; signed-in uploads send raw files to private Supabase Storage.
- Manual cloud sync uses `client_id` columns so the static frontend can update the same Supabase rows instead of creating duplicates.
- Signed-in uploads store raw files in the private `course-materials` bucket and save `storage_path` on material records.
- The `index-material` Edge Function enqueues a durable material indexing job, then downloads stored PDFs and text-like files, extracts text, writes searchable `material_chunks`, and stores provider-tagged Gemini/OpenAI embeddings when runtime allows.
- The `process-index-jobs` Edge Function claims queued or stale indexing jobs through `claim_material_index_jobs`, then retries failed/stalled material processing from a signed-in request or worker-secret scheduler.
- Cloud loading restores planner metadata and history; local source search still uses browser-indexed text until the frontend answer panel is routed through cloud retrieval.
- Activity and course/exam progress trends are derived from `completedSessions`, `quizHistory`, `topicProgress`, deadlines, and generated schedules; they are not stored separately.
- The MVP should store files in object storage, extracted chunks in the database, and embeddings in a vector-capable store.
- AI answers should cite `material_chunks` by material name and page number.
