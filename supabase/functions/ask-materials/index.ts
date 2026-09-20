import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type MatchChunk = {
  chunk_id: string;
  material_id: string;
  material_name: string;
  content: string;
  topic: string | null;
  similarity: number;
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

function getOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .flatMap((item) => {
      const content = item && typeof item === "object" && "content" in item ? item.content : [];
      return Array.isArray(content) ? content : [];
    })
    .map((item) => {
      if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
        return item.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function createEmbedding(input: string) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-small",
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed with ${response.status}`);
  }

  const body = await response.json();
  const embedding = body.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    throw new Error("Embedding response did not include a vector.");
  }

  return embedding;
}

async function createGroundedAnswer(question: string, chunks: MatchChunk[]) {
  const context = chunks
    .map((chunk, index) => {
      return `[${index + 1}] ${chunk.material_name}${chunk.topic ? ` (${chunk.topic})` : ""}: ${chunk.content}`;
    })
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_ANSWER_MODEL") || "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "Answer only from the provided study material excerpts. If the excerpts are insufficient, say what is missing. Include concise citations like [1] or [2].",
        },
        {
          role: "user",
          content: `Question: ${question}\n\nStudy material excerpts:\n${context}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI answer request failed with ${response.status}`);
  }

  const body = await response.json();
  return getOutputText(body) || "I could not generate a grounded answer from the retrieved material.";
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
    const body = await request.json();
    const { courseId, question } = body;
    const questionClientId =
      typeof body.questionClientId === "string" && body.questionClientId.trim()
        ? body.questionClientId.trim()
        : crypto.randomUUID();
    const askedAt =
      typeof body.askedAt === "string" && !Number.isNaN(Date.parse(body.askedAt))
        ? body.askedAt
        : new Date().toISOString();

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing user session." }, 401);
    }

    if (!courseId || typeof question !== "string" || !question.trim()) {
      return jsonResponse({ error: "courseId and question are required." }, 400);
    }

    if (!Deno.env.get("OPENAI_API_KEY")) {
      return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", getSupabaseKey(), {
      global: {
        headers: { Authorization: authorization },
      },
    });

    const embedding = await createEmbedding(question.trim());
    const { data: matches, error: matchError } = await supabase.rpc("match_material_chunks", {
      query_embedding: embedding,
      match_course_id: courseId,
      match_count: 5,
      similarity_threshold: 0.68,
    });

    if (matchError) {
      throw matchError;
    }

    const chunks = (matches || []) as MatchChunk[];

    if (!chunks.length) {
      return jsonResponse({
        answer: "I could not find enough indexed material to answer that yet.",
        grounding: "Grounding: none",
        citations: [],
      });
    }

    const answer = await createGroundedAnswer(question.trim(), chunks);
    const grounding = chunks.length >= 3 ? "Grounding: strong" : chunks.length >= 2 ? "Grounding: moderate" : "Grounding: light";
    const { data: savedQuestion, error: questionError } = await supabase
      .from("material_questions")
      .upsert(
        {
          course_id: courseId,
          client_id: questionClientId,
          question: question.trim(),
          answer,
          grounding,
          created_at: askedAt,
        },
        { onConflict: "course_id,client_id" },
      )
      .select("id, client_id, created_at")
      .single();

    if (questionError) {
      throw questionError;
    }

    const citationRows = chunks.map((chunk, index) => ({
      course_id: courseId,
      client_id: `${questionClientId}-citation-${index}`,
      material_question_id: savedQuestion.id,
      material_chunk_id: chunk.chunk_id,
      question: question.trim(),
      source_material_name: chunk.material_name,
      topic: chunk.topic || "General review",
      answer_excerpt: chunk.content.slice(0, 500),
      match_score: chunk.similarity,
      created_at: askedAt,
    }));

    const { error: deleteCitationError } = await supabase
      .from("answer_citations")
      .delete()
      .eq("material_question_id", savedQuestion.id);

    if (deleteCitationError) {
      throw deleteCitationError;
    }

    const { error: citationError } = await supabase.from("answer_citations").insert(citationRows);

    if (citationError) {
      throw citationError;
    }

    return jsonResponse({
      questionId: savedQuestion.id,
      questionClientId: savedQuestion.client_id || questionClientId,
      askedAt: savedQuestion.created_at || askedAt,
      answer,
      grounding,
      citations: chunks.map((chunk) => ({
        source: chunk.material_name,
        topic: chunk.topic || "General review",
        snippet: chunk.content,
        score: Number(chunk.similarity.toFixed(3)),
      })),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "Could not answer from materials." }, 500);
  }
});
