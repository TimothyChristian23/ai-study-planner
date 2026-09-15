# Data Model

This document captures the local data shape used by the static prototype and the suggested database shape for the MVP.

## Local Prototype State

```js
{
  course: {
    name: "Data Structures",
    examDate: "2026-10-18",
    dailyMinutes: 45
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
      topics: ["Graph traversal"]
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
- `name`
- `term`
- `exam_date`
- `daily_minutes`
- `created_at`
- `updated_at`

### materials

- `id`
- `course_id`
- `file_name`
- `file_type`
- `storage_path`
- `status`
- `page_count`
- `indexed_pages`
- `created_at`

### deadlines

- `id`
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

### answer_citations

- `id`
- `course_id`
- `material_chunk_id`
- `question`
- `answer_excerpt`
- `match_score`
- `created_at`

### study_sessions

- `id`
- `course_id`
- `scheduled_for`
- `duration_minutes`
- `focus_topic`
- `status`
- `created_at`

### study_session_logs

- `id`
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
- Generated schedule items include `dateKey` so the same local plan can drive both the UI and `.ics` calendar export.
- Exam readiness is derived from confidence, plan completion, deadline timing, due reviews, and available materials; it is not stored separately.
- Suggested deadlines are extracted locally from uploaded material text and kept separate until the student accepts them.
- The MVP should store files in object storage, extracted chunks in the database, and embeddings in a vector-capable store.
- AI answers should cite `material_chunks` by material name and page number.
