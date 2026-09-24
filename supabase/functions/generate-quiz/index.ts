import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  createEmbedding,
  createTextCompletion,
  getAiProviderConfigurationMessage,
  hasAiProviderConfigured,
} from "../_shared/ai-providers.ts";

type MatchChunk = {
  chunk_id: string;
  material_id: string;
  material_name: string;
  content: string;
  topic: string | null;
  similarity: number;
};

type GeneratedQuizItem = {
  topic?: string;
  question?: string;
  answer?: string;
  sourceIndex?: number;
};

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

function parseQuizItems(text: string): GeneratedQuizItem[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.quizItems || [];
  } catch {
    const match = text.match(/\[[\s\S]*\]/);

    if (!match) {
      return [];
    }

    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  }
}

async function createQuizItems(topic: string, count: number, chunks: MatchChunk[]) {
  const context = chunks
    .map((chunk, index) => {
      return `[${index + 1}] ${chunk.material_name}${chunk.topic ? ` (${chunk.topic})` : ""}: ${chunk.content}`;
    })
    .join("\n\n");

  const result = await createTextCompletion({
    system:
      "Create concise active-recall quiz cards only from the provided excerpts. Return JSON only: an array of objects with topic, question, answer, and sourceIndex.",
    user: `Topic focus: ${topic}\nCount: ${count}\n\nStudy material excerpts:\n${context}`,
    json: true,
    maxOutputTokens: 900,
    temperature: 0.3,
  });

  return parseQuizItems(result.text)
    .filter((item) => item.question?.trim() && item.answer?.trim())
    .slice(0, count);
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
    const { courseId, topic = "General review", count = 5 } = await request.json();
    const quizCount = Math.min(Math.max(Number(count) || 5, 1), 8);

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing user session." }, 401);
    }

    if (!courseId) {
      return jsonResponse({ error: "courseId is required." }, 400);
    }

    if (!hasAiProviderConfigured()) {
      return jsonResponse({ error: getAiProviderConfigurationMessage() }, 500);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", getSupabaseKey(), {
      global: {
        headers: { Authorization: authorization },
      },
    });

    const embeddingResult = await createEmbedding(`Generate active recall quiz questions about ${topic}.`, {
      taskType: "RETRIEVAL_QUERY",
    });
    const { data: matches, error: matchError } = await supabase.rpc("match_material_chunks", {
      query_embedding: embeddingResult.embedding,
      match_course_id: courseId,
      match_count: Math.max(quizCount * 2, 8),
      similarity_threshold: 0.45,
      match_embedding_provider: embeddingResult.provider,
    });

    if (matchError) {
      throw matchError;
    }

    const chunks = ((matches || []) as MatchChunk[]).slice(0, Math.max(quizCount * 2, 6));

    if (!chunks.length) {
      return jsonResponse({ error: "No indexed material chunks were found for quiz generation." }, 404);
    }

    const generatedItems = await createQuizItems(String(topic || "General review"), quizCount, chunks);

    if (!generatedItems.length) {
      return jsonResponse({ error: "No quiz cards could be generated from the retrieved chunks." }, 422);
    }

    const rows = generatedItems.map((item, index) => {
      const sourceIndex = Math.min(Math.max(Number(item.sourceIndex) || index + 1, 1), chunks.length) - 1;
      const chunk = chunks[sourceIndex] || chunks[index % chunks.length];

      return {
        course_id: courseId,
        material_chunk_id: chunk.chunk_id,
        topic: item.topic || chunk.topic || topic || "General review",
        question: String(item.question || "").trim(),
        answer: String(item.answer || "").trim(),
        source_material_name: chunk.material_name,
        source_excerpt: chunk.content.slice(0, 500),
      };
    });

    const { data: savedItems, error: insertError } = await supabase.from("quiz_items").insert(rows).select("*");

    if (insertError) {
      throw insertError;
    }

    return jsonResponse({
      quizItems: (savedItems || []).map((item) => ({
        id: item.id,
        topic: item.topic,
        question: item.question,
        answer: item.answer,
        source: item.source_material_name || "Indexed material",
        sourceExcerpt: item.source_excerpt || "",
        materialChunkId: item.material_chunk_id || "",
        generatedAt: item.created_at,
        cloudGenerated: true,
      })),
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Could not generate quiz cards from materials.";

    return jsonResponse({ error: message }, 500);
  }
});
