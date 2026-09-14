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
  schedule: [
    {
      day: "Mon",
      task: "Review indexed notes from Lecture 7 - Graph Traversal.pdf",
      time: "45 min",
      focus: "Graph traversal"
    }
  ],
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

### material_chunks

- `id`
- `material_id`
- `chunk_index`
- `content`
- `embedding`
- `source_page`
- `created_at`

### study_sessions

- `id`
- `course_id`
- `scheduled_for`
- `duration_minutes`
- `focus_topic`
- `status`
- `created_at`

### quiz_items

- `id`
- `course_id`
- `material_chunk_id`
- `topic`
- `question`
- `answer`
- `created_at`

### topic_progress

- `id`
- `course_id`
- `topic`
- `confidence_score`
- `last_reviewed_at`
- `updated_at`

## Notes

- The browser prototype stores extracted text in `localStorage`, which is only appropriate for demo use.
- The MVP should store files in object storage, extracted chunks in the database, and embeddings in a vector-capable store.
- AI answers should cite `material_chunks` by material name and page number.
