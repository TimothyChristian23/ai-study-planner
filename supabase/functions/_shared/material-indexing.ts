import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@1.8.1";
import { createEmbeddingsInBatches } from "./ai-providers.ts";

export const MATERIAL_STORAGE_BUCKET = "course-materials";
export const DEFAULT_COURSE_CLIENT_ID = "default-course";

const MAX_TEXT_CHARS = 120000;
const MAX_PDF_PAGES = 60;
const CHUNK_WORDS = 230;
const CHUNK_OVERLAP_WORDS = 45;
const EMBEDDING_BATCH_SIZE = 48;

export type SupabaseClient = ReturnType<typeof createClient>;

export type MaterialRow = {
  id: string;
  course_id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  storage_path: string | null;
  page_count: number;
  indexed_pages: number;
  index_attempts: number;
  topics: string[] | null;
};

export type MaterialIndexJobRow = {
  id: string;
  course_id: string;
  material_id: string;
  user_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
};

export type MaterialIndexResult = {
  materialId: string;
  chunkCount: number;
  pageCount: number;
  indexedPages: number;
  status: string;
  indexStatus: "indexed";
  indexAttempts: number;
  indexStartedAt: string;
  indexedAt: string;
};

export class MaterialIndexError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status = 500, retryable = true) {
    super(message);
    this.name = "MaterialIndexError";
    this.status = status;
    this.retryable = retryable;
  }
}

const topicPatterns = [
  { name: "Graph traversal", terms: ["graph", "bfs", "dfs", "traversal", "shortest path"] },
  { name: "Recurrence relations", terms: ["recurrence", "master theorem", "asymptotic", "big o"] },
  { name: "Hash tables", terms: ["hash", "collision", "chaining", "probing"] },
  { name: "Tree rotations", terms: ["tree", "rotation", "avl", "red black", "binary search"] },
  { name: "Exam logistics", terms: ["exam", "midterm", "final", "quiz", "deadline"] },
  { name: "Assignments", terms: ["assignment", "project", "homework", "submission"] },
];

export function getSupabaseKey() {
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");

  if (publishableKeys) {
    return JSON.parse(publishableKeys).default;
  }

  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

export function getServiceRoleKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function normalizeText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function inferTopic(text: string, fallbackTopics: string[]) {
  const haystack = text.toLowerCase();
  const matchedTopic = topicPatterns.find((topic) => topic.terms.some((term) => haystack.includes(term)));

  return matchedTopic?.name || fallbackTopics[0] || "General review";
}

function buildChunks(text: string, fallbackTopics: string[]) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const chunks: Array<{ content: string; topic: string }> = [];
  const stride = CHUNK_WORDS - CHUNK_OVERLAP_WORDS;

  for (let index = 0; index < words.length; index += stride) {
    const content = words.slice(index, index + CHUNK_WORDS).join(" ").trim();

    if (content.length < 60) {
      continue;
    }

    chunks.push({
      content,
      topic: inferTopic(content, fallbackTopics),
    });
  }

  return chunks;
}

async function extractPdfText(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocumentProxy(bytes);

  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new MaterialIndexError(`PDF has ${pdf.numPages} pages; limit is ${MAX_PDF_PAGES}.`, 422, false);
  }

  const { text, totalPages } = await extractText(pdf, { mergePages: true });

  return {
    text: Array.isArray(text) ? text.join("\n\n") : text,
    pageCount: totalPages,
  };
}

async function extractStoredFileText(file: Blob, fileName: string) {
  const extension = getFileExtension(fileName);

  if (["txt", "md", "csv", "json", "html"].includes(extension) || file.type.startsWith("text/")) {
    return {
      text: await file.text(),
      pageCount: 0,
    };
  }

  if (extension === "pdf" || file.type === "application/pdf") {
    return extractPdfText(file);
  }

  throw new MaterialIndexError(`Unsupported file type: ${extension || file.type || "unknown"}.`, 422, false);
}

async function createChunkRows(material: MaterialRow, chunks: Array<{ content: string; topic: string }>) {
  const result = await createEmbeddingsInBatches(
    chunks.map((chunk) => chunk.content),
    EMBEDDING_BATCH_SIZE,
    { taskType: "RETRIEVAL_DOCUMENT" },
  );

  return chunks.map((chunk, index) => ({
    material_id: material.id,
    course_id: material.course_id,
    user_id: material.user_id,
    chunk_index: index,
    content: chunk.content,
    topic: chunk.topic,
    embedding: result.embeddings[index],
    embedding_provider: result.provider,
    embedding_model: result.model,
  }));
}

export async function updateMaterialIndexState(
  supabase: SupabaseClient,
  materialId: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("materials")
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
    .eq("id", materialId);

  if (error) {
    throw error;
  }
}

export async function resolveCourseId(supabase: SupabaseClient, courseId = "", courseClientId = DEFAULT_COURSE_CLIENT_ID) {
  if (courseId) {
    return courseId;
  }

  const { data: course, error } = await supabase
    .from("courses")
    .select("id")
    .eq("client_id", courseClientId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return course?.id || "";
}

export async function loadMaterialForIndexing(
  supabase: SupabaseClient,
  {
    courseId,
    courseClientId = DEFAULT_COURSE_CLIENT_ID,
    materialClientId,
    materialId,
  }: {
    courseId?: string;
    courseClientId?: string;
    materialClientId?: string;
    materialId?: string;
  },
) {
  const resolvedCourseId = await resolveCourseId(supabase, courseId, courseClientId);

  if (!resolvedCourseId) {
    throw new MaterialIndexError("Cloud course was not found. Sync the planner first.", 404, false);
  }

  let materialQuery = supabase
    .from("materials")
    .select("id, course_id, user_id, file_name, file_type, storage_path, page_count, indexed_pages, index_attempts, topics")
    .eq("course_id", resolvedCourseId);

  materialQuery = materialId ? materialQuery.eq("id", materialId) : materialQuery.eq("client_id", materialClientId);

  const { data, error } = await materialQuery.maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new MaterialIndexError("Material was not found. Sync the planner first.", 404, false);
  }

  return data as MaterialRow;
}

export async function enqueueMaterialIndexJob(
  supabase: SupabaseClient,
  material: MaterialRow,
  requestedBy = "user",
) {
  const { data: existingJob, error: existingError } = await supabase
    .from("material_index_jobs")
    .select("*")
    .eq("material_id", material.id)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingJob) {
    return existingJob as MaterialIndexJobRow;
  }

  const { data, error } = await supabase
    .from("material_index_jobs")
    .insert({
      course_id: material.course_id,
      material_id: material.id,
      user_id: material.user_id,
      status: "queued",
      requested_by: requestedBy,
      run_after: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  await updateMaterialIndexState(supabase, material.id, {
    status: "Queued for indexing",
    index_status: "queued",
    index_error: null,
  });

  return data as MaterialIndexJobRow;
}

export async function markMaterialIndexJobRunning(supabase: SupabaseClient, job: MaterialIndexJobRow) {
  const { data, error } = await supabase
    .from("material_index_jobs")
    .update({
      status: "running",
      attempts: Number(job.attempts || 0) + 1,
      locked_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as MaterialIndexJobRow;
}

export async function markMaterialIndexJobSucceeded(
  supabase: SupabaseClient,
  jobId: string,
  result: MaterialIndexResult,
) {
  const { error } = await supabase
    .from("material_index_jobs")
    .update({
      status: "succeeded",
      error: null,
      chunk_count: result.chunkCount,
      finished_at: result.indexedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw error;
  }
}

export async function markMaterialIndexJobFailed(
  supabase: SupabaseClient,
  job: MaterialIndexJobRow,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Could not index material.";
  const retryable = !(error instanceof MaterialIndexError) || error.retryable;
  const attempts = Number(job.attempts) || 1;
  const maxAttempts = Number(job.max_attempts) || 3;
  const shouldRetry = retryable && attempts < maxAttempts;
  const retryDelayMinutes = Math.min(60, Math.max(1, 2 ** attempts));

  const { error: updateError } = await supabase
    .from("material_index_jobs")
    .update({
      status: shouldRetry ? "queued" : "failed",
      attempts,
      error: message,
      run_after: shouldRetry ? new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString() : null,
      locked_at: null,
      finished_at: shouldRetry ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (updateError) {
    throw updateError;
  }
}

export async function failMaterialIndexing(
  supabase: SupabaseClient,
  materialId: string,
  message: string,
  indexAttempt: number,
) {
  await updateMaterialIndexState(supabase, materialId, {
    status: "Indexing failed",
    index_status: "failed",
    index_error: message,
    index_attempts: indexAttempt,
  });
}

export async function runMaterialIndexing(
  supabase: SupabaseClient,
  material: MaterialRow,
  indexAttempt = Number(material.index_attempts || 0) + 1,
): Promise<MaterialIndexResult> {
  const indexStartedAt = new Date().toISOString();
  await updateMaterialIndexState(supabase, material.id, {
    status: "Indexing...",
    index_status: "indexing",
    index_error: null,
    index_attempts: indexAttempt,
    index_started_at: indexStartedAt,
  });

  if (!material.storage_path) {
    throw new MaterialIndexError("Material does not have a stored file yet.", 400, false);
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(MATERIAL_STORAGE_BUCKET)
    .download(material.storage_path);

  if (downloadError || !file) {
    throw downloadError || new MaterialIndexError("Stored file could not be downloaded.");
  }

  const extracted = await extractStoredFileText(file, material.file_name);
  const normalizedText = normalizeText(extracted.text);

  if (!normalizedText) {
    throw new MaterialIndexError("No extractable text was found in this material.", 422, false);
  }

  const chunks = buildChunks(normalizedText, material.topics || []);

  if (!chunks.length) {
    throw new MaterialIndexError("Not enough text was found to create searchable chunks.", 422, false);
  }

  const chunkRows = await createChunkRows(material, chunks);
  const { error: deleteError } = await supabase.from("material_chunks").delete().eq("material_id", material.id);

  if (deleteError) {
    throw deleteError;
  }

  const { error: insertError } = await supabase.from("material_chunks").insert(chunkRows);

  if (insertError) {
    throw insertError;
  }

  const status = `Indexed ${chunkRows.length} chunks`;
  const pageCount = extracted.pageCount || material.page_count || 0;
  const indexedPages = extracted.pageCount || material.indexed_pages || 0;
  const indexedAt = new Date().toISOString();
  await updateMaterialIndexState(supabase, material.id, {
    status,
    page_count: pageCount,
    indexed_pages: indexedPages,
    index_status: "indexed",
    index_error: null,
    index_attempts: indexAttempt,
    chunk_count: chunkRows.length,
    index_started_at: indexStartedAt,
    indexed_at: indexedAt,
  });

  return {
    materialId: material.id,
    chunkCount: chunkRows.length,
    pageCount,
    indexedPages,
    status,
    indexStatus: "indexed",
    indexAttempts: indexAttempt,
    indexStartedAt,
    indexedAt,
  };
}
