import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getAiProviderConfigurationMessage, hasAiProviderConfigured } from "../_shared/ai-providers.ts";
import {
  MaterialIndexError,
  failMaterialIndexing,
  getServiceRoleKey,
  getSupabaseKey,
  loadMaterialForIndexing,
  markMaterialIndexJobFailed,
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

function parseLimit(value: unknown) {
  const limit = Number(value ?? 1);

  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new MaterialIndexError("limit must be between 1 and 5.", 400, false);
  }

  return limit;
}

function hasValidWorkerSecret(request: Request) {
  const workerSecret = Deno.env.get("INDEX_WORKER_SECRET") || "";
  const providedSecret = request.headers.get("x-index-worker-secret") || "";

  return Boolean(workerSecret && providedSecret && workerSecret === providedSecret);
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
    const isWorker = hasValidWorkerSecret(request);

    if (!isWorker && !authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing user session or worker secret." }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const limit = parseLimit(body?.limit);

    if (!hasAiProviderConfigured()) {
      return jsonResponse({ error: getAiProviderConfigurationMessage() }, 500);
    }

    const serviceRoleKey = getServiceRoleKey();

    if (isWorker && !serviceRoleKey) {
      return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      isWorker ? serviceRoleKey : getSupabaseKey(),
      isWorker
        ? {}
        : {
            global: {
              headers: { Authorization: authorization },
            },
          },
    );
    const { data: jobs, error: claimError } = await supabase.rpc("claim_material_index_jobs", {
      claim_limit: limit,
    });

    if (claimError) {
      throw claimError;
    }

    const processed = [];

    for (const job of (jobs || []) as MaterialIndexJobRow[]) {
      let material: MaterialRow | null = null;

      try {
        material = await loadMaterialForIndexing(supabase, {
          courseId: job.course_id,
          materialId: job.material_id,
        });
        const result = await runMaterialIndexing(
          supabase,
          material,
          Number(job.attempts || material.index_attempts || 1),
        );
        await markMaterialIndexJobSucceeded(supabase, job.id, result);
        processed.push({
          jobId: job.id,
          materialId: material.id,
          status: "succeeded",
          chunkCount: result.chunkCount,
        });
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : "Could not index material.";

        if (material) {
          try {
            await failMaterialIndexing(supabase, material.id, message, Number(job.attempts || 1));
          } catch (updateError) {
            console.error(updateError);
          }
        }

        try {
          await markMaterialIndexJobFailed(supabase, job, error);
        } catch (jobError) {
          console.error(jobError);
        }

        processed.push({
          jobId: job.id,
          materialId: job.material_id,
          status: "failed",
          error: message,
        });
      }
    }

    return jsonResponse({
      mode: isWorker ? "worker" : "user",
      claimed: jobs?.length || 0,
      processed,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Could not process index jobs.";
    const status = error instanceof MaterialIndexError ? error.status : 500;

    return jsonResponse({ error: message }, status);
  }
});
