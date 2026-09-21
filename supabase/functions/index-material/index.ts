import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  DEFAULT_COURSE_CLIENT_ID,
  MaterialIndexError,
  enqueueMaterialIndexJob,
  failMaterialIndexing,
  getSupabaseKey,
  loadMaterialForIndexing,
  markMaterialIndexJobFailed,
  markMaterialIndexJobRunning,
  markMaterialIndexJobSucceeded,
  runMaterialIndexing,
} from "../_shared/material-indexing.ts";
import type { MaterialIndexJobRow, MaterialRow } from "../_shared/material-indexing.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let material: MaterialRow | null = null;
  let queuedJob: MaterialIndexJobRow | null = null;
  let runningJob: MaterialIndexJobRow | null = null;
  let materialClientId = "";

  try {
    const authorization = request.headers.get("Authorization") || "";
    const body = await request.json().catch(() => ({}));
    const {
      courseClientId = DEFAULT_COURSE_CLIENT_ID,
      courseId,
      materialClientId: requestedMaterialClientId,
      materialId,
    } = body || {};
    materialClientId = requestedMaterialClientId || "";

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing user session." }, 401);
    }

    if (!materialClientId && !materialId) {
      return jsonResponse({ error: "materialClientId or materialId is required." }, 400);
    }

    if (!Deno.env.get("OPENAI_API_KEY")) {
      return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    supabase = createClient(Deno.env.get("SUPABASE_URL") || "", getSupabaseKey(), {
      global: {
        headers: { Authorization: authorization },
      },
    });
    material = await loadMaterialForIndexing(supabase, {
      courseClientId,
      courseId,
      materialClientId,
      materialId,
    });
    queuedJob = await enqueueMaterialIndexJob(supabase, material, "manual");
    runningJob = await markMaterialIndexJobRunning(supabase, queuedJob);

    const result = await runMaterialIndexing(
      supabase,
      material,
      Number(runningJob.attempts || material.index_attempts || 1),
    );
    await markMaterialIndexJobSucceeded(supabase, runningJob.id, result);

    return jsonResponse({
      ...result,
      materialClientId,
      jobId: runningJob.id,
      jobStatus: "succeeded",
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Could not index material.";
    const status = error instanceof MaterialIndexError ? error.status : 500;
    const failedJob = runningJob || queuedJob;
    const indexAttempts =
      Number(failedJob?.attempts || 0) || (material ? Number(material.index_attempts || 0) + 1 : undefined);

    if (supabase && material) {
      try {
        await failMaterialIndexing(supabase, material.id, message, indexAttempts || 1);
      } catch (updateError) {
        console.error(updateError);
      }
    }

    if (supabase && failedJob) {
      try {
        await markMaterialIndexJobFailed(supabase, failedJob, error);
      } catch (jobError) {
        console.error(jobError);
      }
    }

    return jsonResponse(
      {
        error: message,
        indexStatus: "failed",
        indexAttempts,
        jobId: failedJob?.id,
        jobStatus: "failed",
      },
      status,
    );
  }
});
