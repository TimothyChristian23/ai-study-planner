# Production Upgrade Plan

This document tracks the path from the deployed static prototype to a production app with auth, durable storage, document retrieval, and AI answers.

## Target Stack

- Frontend: current static dashboard first, then React or Next.js once server-rendered routes are useful
- Auth: Supabase Auth
- Database: Supabase Postgres with row-level security
- File storage: Supabase Storage bucket for user course materials
- AI: Supabase Edge Functions calling OpenAI server-side
- Retrieval: extracted material chunks stored in Postgres with vector embeddings

## Foundation Added

- `.env.example` for browser-safe Supabase values and server-only OpenAI secrets
- `config.js` for browser-safe Supabase URL and anon key configuration
- `supabase/migrations/0001_initial_schema.sql` for courses, materials, chunks, schedules, quizzes, progress, answers, citations, storage bucket, RLS policies, and a vector search RPC
- `supabase/functions/ask-materials` for authenticated material Q&A using retrieved chunks and OpenAI Responses
- Static account panel with sign in, sign up, sign out, and session detection when Supabase config is present

## Setup Steps

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and fill in browser-safe Supabase values for local frontend work.
3. Update `config.js` with the Supabase project URL and anon/publishable key for the deployed static frontend.
4. Install and log in to the Supabase CLI.
5. Link the project:

   ```powershell
   supabase link --project-ref your-project-ref
   ```

6. Apply the database migration:

   ```powershell
   supabase db push
   ```

7. Set Edge Function secrets:

   ```powershell
   supabase secrets set OPENAI_API_KEY=sk-proj-your-key
   supabase secrets set OPENAI_EMBEDDING_MODEL=text-embedding-3-small
   supabase secrets set OPENAI_ANSWER_MODEL=gpt-5-mini
   ```

8. Deploy the first Edge Function:

   ```powershell
   supabase functions deploy ask-materials
   ```

## Next Implementation Steps

1. Replace `localStorage` courses/materials/deadlines with Supabase-backed records for signed-in users.
2. Upload source files to the `course-materials` bucket.
3. Add a parsing/indexing function that extracts text, chunks it, embeds it, and writes `material_chunks`.
4. Route the `Ask materials` panel through `ask-materials`.
5. Move quiz, schedule, and progress history into Postgres tables.

## Security Notes

- OpenAI keys must never be exposed to the browser.
- Keep row-level security enabled on every exposed table.
- Storage object paths should start with the authenticated user ID so storage policies can isolate files.
- The current static demo should remain available while production features are added behind Supabase configuration.
