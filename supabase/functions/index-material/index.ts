import { createClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { corsHeaders } from "../_shared/cors.ts";

const MATERIAL_STORAGE_BUCKET = "course-materials";
const DEFAULT_COURSE_CLIENT_ID = "default-course";
const MAX_TEXT_CHARS = 120000;
const MAX_PDF_PAGES = 60;
const CHUNK_WORDS = 230;
const CHUNK_OVERLAP_WORDS = 45;
const EMBEDDING_BATCH_SIZE = 48;

type MaterialRow = {
  id: string;
  course_id: string;
  file_name: string;
  file_type: string;
  storage_path: string | null;
  page_count: number;
  indexed_pages: number;
  topics: string[] | null;
};

const topicPatterns = [
  { name: "Graph traversal", terms: ["graph", "bfs", "dfs", "traversal", "shortest path"] },
  { name: "Recurrence relations", terms: ["recurrence", "master theorem", "asymptotic", "big o"] },
  { name: "Hash tables", terms: ["hash", "collision", "chaining", "probing"] },
  { name: "Tree rotations", terms: ["tree", "rotation", "avl", "red black", "binary search"] },
  { name: "Exam logistics", terms: ["exam", "midterm", "final", "quiz", "deadline"] },
  { name: "Assignments", terms: ["assignment", "project", "homework", "submission"] },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getSupabaseKey() {
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");

  if (publishableKeys) {
    return JSON.parse(publishableKeys).default;
  }

  return Deno.env.get("SUPABASE_ANON_KEY") || "";
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
    throw new Error(`PDF has ${pdf.numPages} pages; limit is ${MAX_PDF_PAGES}.`);
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

  throw new Error(`Unsupported file type: ${extension || file.type || "unknown"}.`);
}

async function createEmbeddings(inputs: string[]) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-small",
      input: inputs,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed with ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  const embeddings = [...(body.data || [])]
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);

  if (embeddings.length !== inputs.length || embeddings.some((embedding) => !Array.isArray(embedding))) {
    throw new Error("Embedding response did not include a vector for every chunk.");
  }

  return embeddings;
}

async function createChunkRows(material: MaterialRow, chunks: Array<{ content: string; topic: string }>) {
  const rows = [];

  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    const embeddings = await createEmbeddings(batch.map((chunk) => chunk.content));

    rows.push(
      ...batch.map((chunk, batchIndex) => ({
        material_id: material.id,
        course_id: material.course_id,
        chunk_index: index + batchIndex,
        content: chunk.content,
        topic: chunk.topic,
        embedding: embeddings[batchIndex],
      })),
    );
  }

  return rows;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization") || "";
    const { courseClientId = DEFAULT_COURSE_CLIENT_ID, courseId, materialClientId, materialId } = await request.json();

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing user session." }, 401);
    }

    if (!materialClientId && !materialId) {
      return jsonResponse({ error: "materialClientId or materialId is required." }, 400);
    }

    if (!Deno.env.get("OPENAI_API_KEY")) {
      return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", getSupabaseKey(), {
      global: {
        headers: { Authorization: authorization },
      },
    });
    let resolvedCourseId = courseId;

    if (!resolvedCourseId) {
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("id")
        .eq("client_id", courseClientId)
        .maybeSingle();

      if (courseError) {
        throw courseError;
      }

      resolvedCourseId = course?.id;
    }

    if (!resolvedCourseId) {
      return jsonResponse({ error: "Cloud course was not found. Sync the planner first." }, 404);
    }

    let materialQuery = supabase
      .from("materials")
      .select("id, course_id, file_name, file_type, storage_path, page_count, indexed_pages, topics")
      .eq("course_id", resolvedCourseId);

    materialQuery = materialId ? materialQuery.eq("id", materialId) : materialQuery.eq("client_id", materialClientId);

    const { data: materialData, error: materialError } = await materialQuery.maybeSingle();

    if (materialError) {
      throw materialError;
    }

    const material = materialData as MaterialRow | null;

    if (!material) {
      return jsonResponse({ error: "Material was not found. Sync the planner first." }, 404);
    }

    if (!material.storage_path) {
      return jsonResponse({ error: "Material does not have a stored file yet." }, 400);
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from(MATERIAL_STORAGE_BUCKET)
      .download(material.storage_path);

    if (downloadError || !file) {
      throw downloadError || new Error("Stored file could not be downloaded.");
    }

    const extracted = await extractStoredFileText(file, material.file_name);
    const normalizedText = normalizeText(extracted.text);

    if (!normalizedText) {
      return jsonResponse({ error: "No extractable text was found in this material." }, 422);
    }

    const chunks = buildChunks(normalizedText, material.topics || []);

    if (!chunks.length) {
      return jsonResponse({ error: "Not enough text was found to create searchable chunks." }, 422);
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
    const { error: updateError } = await supabase
      .from("materials")
      .update({
        status,
        page_count: extracted.pageCount || material.page_count || 0,
        indexed_pages: extracted.pageCount || material.indexed_pages || 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", material.id);

    if (updateError) {
      throw updateError;
    }

    return jsonResponse({
      materialId: material.id,
      materialClientId,
      chunkCount: chunkRows.length,
      pageCount: extracted.pageCount || 0,
      status,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Could not index material.",
      },
      500,
    );
  }
});
