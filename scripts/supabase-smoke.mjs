import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 10000;
const root = resolve(import.meta.dirname, "..");

const tableChecks = [
  {
    table: "courses",
    columns: ["id", "client_id", "name", "exam_date", "daily_minutes", "preferred_start_time", "study_days", "updated_at"],
  },
  {
    table: "materials",
    columns: [
      "id",
      "client_id",
      "file_name",
      "storage_path",
      "status",
      "index_status",
      "index_error",
      "index_attempts",
      "chunk_count",
      "index_started_at",
      "indexed_at",
    ],
  },
  {
    table: "material_chunks",
    columns: ["id", "material_id", "course_id", "chunk_index", "content", "topic", "embedding"],
  },
  {
    table: "deadlines",
    columns: ["id", "client_id", "course_id", "title", "type", "due_date", "topic", "completed", "updated_at"],
  },
  {
    table: "study_sessions",
    columns: ["id", "client_id", "course_id", "scheduled_for", "duration_minutes", "focus_topic", "status"],
  },
  {
    table: "study_session_logs",
    columns: ["id", "client_id", "study_session_id", "course_id", "focus_topic", "minutes", "completed_at"],
  },
  {
    table: "quiz_items",
    columns: ["id", "course_id", "material_chunk_id", "topic", "question", "answer", "source_material_name", "source_excerpt"],
  },
  {
    table: "quiz_attempts",
    columns: ["id", "client_id", "course_id", "question", "source_material_name", "result", "confidence_after", "answered_at"],
  },
  {
    table: "topic_progress",
    columns: ["id", "course_id", "topic", "confidence_score", "study_sessions", "quiz_attempts", "quiz_misses"],
  },
  {
    table: "material_questions",
    columns: ["id", "client_id", "course_id", "question", "answer", "grounding", "created_at"],
  },
  {
    table: "answer_citations",
    columns: [
      "id",
      "client_id",
      "course_id",
      "material_question_id",
      "material_chunk_id",
      "question",
      "source_material_name",
      "topic",
      "answer_excerpt",
      "match_score",
    ],
  },
];

const functionChecks = [
  {
    name: "ask-materials",
    body: {},
    acceptedValidationStatuses: [400, 401],
    expectedError: "courseId and question are required",
  },
  {
    name: "index-material",
    body: {},
    acceptedValidationStatuses: [400, 401],
    expectedError: "materialClientId or materialId is required",
  },
  {
    name: "generate-quiz",
    body: {},
    acceptedValidationStatuses: [400, 401],
    expectedError: "courseId is required",
  },
];

const results = [];

function readConfigFallback() {
  try {
    const config = readFileSync(resolve(root, "config.js"), "utf8");
    const supabaseUrl = config.match(/supabaseUrl:\s*["']([^"']+)["']/)?.[1] || "";
    const supabaseAnonKey = config.match(/supabaseAnonKey:\s*["']([^"']+)["']/)?.[1] || "";

    return { supabaseUrl, supabaseAnonKey };
  } catch {
    return { supabaseUrl: "", supabaseAnonKey: "" };
  }
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isJwt(value) {
  return String(value || "").split(".").length === 3;
}

function truncate(value, maxLength = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SMOKE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBody(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function record(status, name, detail = "") {
  results.push({ status, name, detail });
  const suffix = detail ? ` - ${detail}` : "";
  console.log(`${status.padEnd(4)} ${name}${suffix}`);
}

function pass(name, detail = "") {
  record("PASS", name, detail);
}

function warn(name, detail = "") {
  record("WARN", name, detail);
}

function fail(name, detail = "") {
  record("FAIL", name, detail);
}

function buildHeaders({ supabaseAnonKey, authToken = "", includeJson = false }) {
  return {
    apikey: supabaseAnonKey,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
  };
}

async function checkAppUrl(appUrl) {
  if (!appUrl) {
    warn("Static app smoke", "AI_STUDY_APP_URL is not set; skipping app asset checks.");
    return;
  }

  const baseUrl = cleanBaseUrl(appUrl);
  const indexResponse = await fetchWithTimeout(`${baseUrl}/`);

  if (!indexResponse.ok) {
    fail("Static app root", `Expected 2xx, received ${indexResponse.status}.`);
    return;
  }

  const indexHtml = await indexResponse.text();

  if (!indexHtml.includes("script.js") || !indexHtml.includes("config.js")) {
    fail("Static app root", "index.html did not reference the expected app scripts.");
    return;
  }

  pass("Static app root", `${baseUrl}/ responded with ${indexResponse.status}.`);

  for (const asset of ["script.js", "styles.css", "config.js"]) {
    const assetResponse = await fetchWithTimeout(`${baseUrl}/${asset}`);

    if (assetResponse.ok) {
      pass(`Static asset ${asset}`, `Received ${assetResponse.status}.`);
    } else {
      fail(`Static asset ${asset}`, `Expected 2xx, received ${assetResponse.status}.`);
    }
  }
}

async function checkRestSchema({ supabaseUrl, supabaseAnonKey, authToken }) {
  for (const check of tableChecks) {
    const query = new URLSearchParams({
      select: check.columns.join(","),
      limit: "0",
    });
    const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/${check.table}?${query}`, {
      headers: buildHeaders({ supabaseAnonKey, authToken }),
    });
    const body = await readResponseBody(response);

    if (response.ok) {
      pass(`REST schema ${check.table}`, `${check.columns.length} columns validated.`);
    } else {
      fail(`REST schema ${check.table}`, `Received ${response.status}: ${truncate(JSON.stringify(body))}`);
    }
  }
}

async function checkEdgeFunctions({ supabaseUrl, supabaseAnonKey, functionAuthToken }) {
  for (const check of functionChecks) {
    const endpoint = `${supabaseUrl}/functions/v1/${check.name}`;
    const optionsResponse = await fetchWithTimeout(endpoint, {
      method: "OPTIONS",
      headers: {
        Origin: process.env.AI_STUDY_APP_URL || "http://localhost:4173",
        "Access-Control-Request-Method": "POST",
      },
    });

    if ([200, 204].includes(optionsResponse.status)) {
      pass(`Function CORS ${check.name}`, `Received ${optionsResponse.status}.`);
    } else {
      fail(`Function CORS ${check.name}`, `Expected 200/204, received ${optionsResponse.status}.`);
      continue;
    }

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: buildHeaders({
        supabaseAnonKey,
        authToken: functionAuthToken,
        includeJson: true,
      }),
      body: JSON.stringify(check.body),
    });
    const body = await readResponseBody(response);
    const text = typeof body === "string" ? body : JSON.stringify(body);

    if (!check.acceptedValidationStatuses.includes(response.status)) {
      fail(`Function validation ${check.name}`, `Expected ${check.acceptedValidationStatuses.join("/")} but received ${response.status}: ${truncate(text)}`);
      continue;
    }

    if (response.status === 401) {
      warn(`Function validation ${check.name}`, "Reached endpoint, but JWT validation blocked the request before function-level validation.");
      continue;
    }

    if (!text.includes(check.expectedError)) {
      fail(`Function validation ${check.name}`, `Expected validation message containing "${check.expectedError}", received: ${truncate(text)}`);
      continue;
    }

    pass(`Function validation ${check.name}`, `Received expected ${response.status}.`);
  }
}

async function main() {
  const fallback = readConfigFallback();
  const supabaseUrl = cleanBaseUrl(process.env.SUPABASE_URL || fallback.supabaseUrl);
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || fallback.supabaseAnonKey;
  const smokeAccessToken = process.env.SUPABASE_SMOKE_ACCESS_TOKEN || "";
  const restAuthToken = smokeAccessToken || (isJwt(supabaseAnonKey) ? supabaseAnonKey : "");
  const functionAuthToken = smokeAccessToken || supabaseAnonKey;

  if (!supabaseUrl || !supabaseAnonKey) {
    fail(
      "Smoke configuration",
      "Set SUPABASE_URL and SUPABASE_ANON_KEY, or fill config.js before running this script.",
    );
    process.exitCode = 1;
    return;
  }

  pass("Smoke configuration", `Using ${supabaseUrl}.`);

  if (!smokeAccessToken) {
    warn(
      "Authenticated smoke token",
      "SUPABASE_SMOKE_ACCESS_TOKEN is not set; destructive/user-specific checks will stay skipped.",
    );
  }

  await checkAppUrl(process.env.AI_STUDY_APP_URL || "");
  await checkRestSchema({ supabaseUrl, supabaseAnonKey, authToken: restAuthToken });
  await checkEdgeFunctions({ supabaseUrl, supabaseAnonKey, functionAuthToken });

  const failedCount = results.filter((result) => result.status === "FAIL").length;
  const warningCount = results.filter((result) => result.status === "WARN").length;
  const passedCount = results.filter((result) => result.status === "PASS").length;

  console.log("");
  console.log(`Smoke summary: ${passedCount} passed, ${warningCount} warnings, ${failedCount} failed.`);

  if (failedCount) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fail("Smoke runner", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
