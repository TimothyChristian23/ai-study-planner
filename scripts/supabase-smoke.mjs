import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 10000;
const MATERIAL_STORAGE_BUCKET = "course-materials";
const SMOKE_QA_QUESTION = "What should I review for breadth first search?";
const SMOKE_QUIZ_TOPIC = "Graph traversal";
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
    columns: [
      "id",
      "material_id",
      "course_id",
      "chunk_index",
      "content",
      "topic",
      "embedding",
      "embedding_provider",
      "embedding_model",
    ],
  },
  {
    table: "material_index_jobs",
    columns: [
      "id",
      "course_id",
      "material_id",
      "status",
      "requested_by",
      "attempts",
      "max_attempts",
      "run_after",
      "locked_at",
      "finished_at",
    ],
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
    name: "process-index-jobs",
    body: { limit: 0 },
    acceptedValidationStatuses: [400, 401],
    expectedError: "limit must be between 1 and 5",
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

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
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

function encodeFilterValue(value) {
  return encodeURIComponent(String(value));
}

function encodeStoragePath(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function signInSmokeUser({ supabaseUrl, supabaseAnonKey, email, password }) {
  if (!email || !password) {
    return null;
  }

  const response = await fetchWithTimeout(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: buildHeaders({ supabaseAnonKey, includeJson: true }),
    body: JSON.stringify({ email, password }),
  });
  const body = await readResponseBody(response);

  if (!response.ok || !body?.access_token || !body?.user?.id) {
    fail("Authenticated smoke sign in", `Received ${response.status}: ${truncate(JSON.stringify(body))}`);
    return null;
  }

  pass("Authenticated smoke sign in", `Signed in ${body.user.email || email}.`);

  return {
    accessToken: body.access_token,
    user: body.user,
  };
}

async function validateSmokeAccessToken({ supabaseUrl, supabaseAnonKey, accessToken }) {
  if (!accessToken) {
    return null;
  }

  const response = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, {
    headers: buildHeaders({ supabaseAnonKey, authToken: accessToken }),
  });
  const body = await readResponseBody(response);

  if (!response.ok || !body?.id) {
    fail("Authenticated smoke token", `Received ${response.status}: ${truncate(JSON.stringify(body))}`);
    return null;
  }

  pass("Authenticated smoke token", `Validated ${body.email || body.id}.`);

  return {
    accessToken,
    user: body,
  };
}

async function getSmokeSession({ supabaseUrl, supabaseAnonKey, smokeAccessToken, smokeEmail, smokePassword }) {
  const passwordSession = await signInSmokeUser({
    supabaseUrl,
    supabaseAnonKey,
    email: smokeEmail,
    password: smokePassword,
  });

  if (passwordSession) {
    return passwordSession;
  }

  if (smokeEmail || smokePassword) {
    return null;
  }

  return validateSmokeAccessToken({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: smokeAccessToken,
  });
}

async function restRequest({ supabaseUrl, supabaseAnonKey, authToken, table, query = "", method = "GET", body, prefer = "" }) {
  const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      ...buildHeaders({ supabaseAnonKey, authToken, includeJson: body !== undefined }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await readResponseBody(response);

  return { response, data };
}

function getRepresentationRow(data) {
  return Array.isArray(data) ? data[0] : data;
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

async function insertSmokeRow({ supabaseUrl, supabaseAnonKey, authToken, table, payload, select = "*" }) {
  const { response, data } = await restRequest({
    supabaseUrl,
    supabaseAnonKey,
    authToken,
    table,
    query: `select=${encodeURIComponent(select)}`,
    method: "POST",
    body: payload,
    prefer: "return=representation",
  });

  return { response, data, row: getRepresentationRow(data) };
}

async function readStorageResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return readResponseBody(response);
  }

  return response.text();
}

async function storageRequest({ supabaseUrl, supabaseAnonKey, authToken = "", path = "", method = "GET", body, headers = {} }) {
  const response = await fetchWithTimeout(`${supabaseUrl}/storage/v1${path}`, {
    method,
    headers: {
      apikey: supabaseAnonKey,
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });
  const data = await readStorageResponseBody(response);

  return { response, data };
}

async function invokeEdgeFunction({ supabaseUrl, supabaseAnonKey, authToken, name, body }) {
  const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: buildHeaders({
      supabaseAnonKey,
      authToken,
      includeJson: true,
    }),
    body: JSON.stringify(body),
  });
  const data = await readResponseBody(response);

  return { response, data };
}

function getSmokeAiProvider() {
  const preferred = String(process.env.AI_PROVIDER || "").trim().toLowerCase();

  if (preferred === "gemini" || preferred === "openai") {
    return preferred;
  }

  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return "";
}

function truncateAndNormalizeFixtureEmbedding(embedding) {
  if (!Array.isArray(embedding)) {
    return embedding;
  }

  const values = embedding.slice(0, 1536).map((value) => Number(value) || 0);
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;

  return values.map((value) => value / magnitude);
}

function validateFixtureEmbeddings(provider, embeddings, inputs) {
  if (embeddings.length !== inputs.length || embeddings.some((embedding) => !Array.isArray(embedding))) {
    fail("AI fixture embeddings", `${provider} did not return an embedding for every fixture input.`);
    return false;
  }

  if (embeddings.some((embedding) => embedding.length !== 1536)) {
    fail("AI fixture embeddings", `Smoke fixture expected 1536-dimension ${provider} embeddings.`);
    return false;
  }

  return true;
}

async function createOpenAiEmbeddings(inputs) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

  if (!apiKey) {
    fail("AI fixture embeddings", "Set OPENAI_API_KEY when SUPABASE_SMOKE_RUN_AI is enabled.");
    return null;
  }

  const response = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: inputs,
      encoding_format: "float",
    }),
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    fail("AI fixture embeddings", `Received ${response.status}: ${truncate(JSON.stringify(body))}`);
    return null;
  }

  const embeddings = [...(body.data || [])]
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);

  if (!validateFixtureEmbeddings("OpenAI", embeddings, inputs)) {
    return null;
  }

  pass("AI fixture embeddings", `Created ${embeddings.length} OpenAI fixture embeddings.`);

  return { embeddings, provider: "openai", model };
}

async function createGeminiEmbeddings(inputs) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

  if (!apiKey) {
    fail("AI fixture embeddings", "Set GEMINI_API_KEY when SUPABASE_SMOKE_RUN_AI is enabled with AI_PROVIDER=gemini.");
    return null;
  }

  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/${modelPath}:batchEmbedContents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      requests: inputs.map((input) => ({
        model: modelPath,
        content: {
          parts: [{ text: input }],
        },
        taskType: "RETRIEVAL_QUERY",
      })),
    }),
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    fail("AI fixture embeddings", `Received ${response.status}: ${truncate(JSON.stringify(body))}`);
    return null;
  }

  const embeddings = [...(body.embeddings || [])].map((item) => truncateAndNormalizeFixtureEmbedding(item.values));

  if (!validateFixtureEmbeddings("Gemini", embeddings, inputs)) {
    return null;
  }

  pass("AI fixture embeddings", `Created ${embeddings.length} Gemini fixture embeddings.`);

  return { embeddings, provider: "gemini", model };
}

async function createAiEmbeddings(inputs) {
  const provider = getSmokeAiProvider();

  if (provider === "gemini") {
    return createGeminiEmbeddings(inputs);
  }

  if (provider === "openai") {
    return createOpenAiEmbeddings(inputs);
  }

  fail("AI fixture embeddings", "Set GEMINI_API_KEY or OPENAI_API_KEY when SUPABASE_SMOKE_RUN_AI is enabled.");

  return null;
}

async function deleteSmokeStorageObject({ supabaseUrl, supabaseAnonKey, authToken, objectPath }) {
  const deleteResult = await storageRequest({
    supabaseUrl,
    supabaseAnonKey,
    authToken,
    path: `/object/${MATERIAL_STORAGE_BUCKET}`,
    method: "DELETE",
    body: JSON.stringify({ prefixes: [objectPath] }),
    headers: { "Content-Type": "application/json" },
  });

  if (deleteResult.response.ok) {
    return deleteResult;
  }

  return storageRequest({
    supabaseUrl,
    supabaseAnonKey,
    authToken,
    path: `/object/${MATERIAL_STORAGE_BUCKET}/${encodeStoragePath(objectPath)}`,
    method: "DELETE",
  });
}

async function checkAuthenticatedStorage({ supabaseUrl, supabaseAnonKey, session, clientId }) {
  const content = `AI Study Planner storage smoke ${clientId}`;
  const objectPath = `${session.user.id}/${clientId}/smoke-notes.txt`;
  let uploaded = false;

  try {
    const uploadResult = await storageRequest({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      path: `/object/${MATERIAL_STORAGE_BUCKET}/${encodeStoragePath(objectPath)}`,
      method: "POST",
      body: content,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "60",
        "x-upsert": "false",
      },
    });

    if (![200, 201].includes(uploadResult.response.status)) {
      fail("Authenticated storage upload", `Received ${uploadResult.response.status}: ${truncate(JSON.stringify(uploadResult.data))}`);
      return;
    }

    uploaded = true;
    pass("Authenticated storage upload", `Uploaded ${objectPath}.`);

    const downloadResult = await storageRequest({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      path: `/object/authenticated/${MATERIAL_STORAGE_BUCKET}/${encodeStoragePath(objectPath)}`,
    });

    if (!downloadResult.response.ok || downloadResult.data !== content) {
      fail(
        "Authenticated storage download",
        `Received ${downloadResult.response.status}: ${truncate(typeof downloadResult.data === "string" ? downloadResult.data : JSON.stringify(downloadResult.data))}`,
      );
      return;
    }

    pass("Authenticated storage download", "Downloaded matching smoke file contents.");

    const signedResult = await storageRequest({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      path: `/object/sign/${MATERIAL_STORAGE_BUCKET}/${encodeStoragePath(objectPath)}`,
      method: "POST",
      body: JSON.stringify({ expiresIn: 60 }),
      headers: { "Content-Type": "application/json" },
    });

    const signedPath = signedResult.data?.signedURL || signedResult.data?.signedUrl || signedResult.data?.signed_url || "";

    if (!signedResult.response.ok || !signedPath) {
      fail("Authenticated storage signed URL", `Received ${signedResult.response.status}: ${truncate(JSON.stringify(signedResult.data))}`);
      return;
    }

    const signedUrl = signedPath.startsWith("http")
      ? signedPath
      : `${supabaseUrl}/storage/v1${signedPath.startsWith("/") ? signedPath : `/${signedPath}`}`;
    const signedDownload = await fetchWithTimeout(signedUrl);
    const signedContent = await signedDownload.text();

    if (!signedDownload.ok || signedContent !== content) {
      fail("Authenticated storage signed URL", `Signed download received ${signedDownload.status}: ${truncate(signedContent)}`);
      return;
    }

    pass("Authenticated storage signed URL", "Generated and downloaded a matching signed URL.");
  } finally {
    if (uploaded) {
      const deleteResult = await deleteSmokeStorageObject({
        supabaseUrl,
        supabaseAnonKey,
        authToken: session.accessToken,
        objectPath,
      });

      if (deleteResult.response.ok) {
        pass("Authenticated storage cleanup", "Deleted smoke storage object.");
      } else {
        fail("Authenticated storage cleanup", `Received ${deleteResult.response.status}: ${truncate(JSON.stringify(deleteResult.data))}`);
      }
    }
  }
}

async function checkAiCloudFixture({ supabaseUrl, supabaseAnonKey, session, courseId, materialId, clientId }) {
  if (!isEnabled(process.env.SUPABASE_SMOKE_RUN_AI)) {
    warn(
      "AI cloud fixture",
      "Set SUPABASE_SMOKE_RUN_AI=1 and GEMINI_API_KEY or OPENAI_API_KEY to run material Q&A and quiz generation smoke checks.",
    );
    return;
  }

  const embeddingResult = await createAiEmbeddings([
    SMOKE_QA_QUESTION,
    `Generate active recall quiz questions about ${SMOKE_QUIZ_TOPIC}.`,
  ]);

  if (!embeddingResult) {
    return;
  }

  const { embeddings, provider, model } = embeddingResult;
  const chunkRows = [
    {
      material_id: materialId,
      course_id: courseId,
      chunk_index: 0,
      content:
        "Breadth first search uses a queue to visit graph neighbors layer by layer. Review queue order, visited sets, and shortest path behavior in unweighted graphs.",
      topic: SMOKE_QUIZ_TOPIC,
      embedding: embeddings[0],
      embedding_provider: provider,
      embedding_model: model,
    },
    {
      material_id: materialId,
      course_id: courseId,
      chunk_index: 1,
      content:
        "Depth first search uses recursion or a stack to explore one graph path before backtracking. Compare DFS traversal order with breadth first search.",
      topic: SMOKE_QUIZ_TOPIC,
      embedding: embeddings[1],
      embedding_provider: provider,
      embedding_model: model,
    },
  ];
  const { response: chunkResponse, data: chunkData } = await restRequest({
    supabaseUrl,
    supabaseAnonKey,
    authToken: session.accessToken,
    table: "material_chunks",
    query: "select=id,chunk_index,topic",
    method: "POST",
    body: chunkRows,
    prefer: "return=representation",
  });

  if (!chunkResponse.ok || !Array.isArray(chunkData) || chunkData.length !== chunkRows.length) {
    fail("AI fixture chunk seed", `Received ${chunkResponse.status}: ${truncate(JSON.stringify(chunkData))}`);
    return;
  }

  pass("AI fixture chunk seed", `Inserted ${chunkData.length} vector chunks.`);

  const qaResult = await invokeEdgeFunction({
    supabaseUrl,
    supabaseAnonKey,
    authToken: session.accessToken,
    name: "ask-materials",
    body: {
      courseId,
      question: SMOKE_QA_QUESTION,
      questionClientId: `${clientId}-ai-question`,
      askedAt: new Date().toISOString(),
    },
  });

  if (!qaResult.response.ok || !qaResult.data?.answer || !Array.isArray(qaResult.data?.citations) || !qaResult.data.citations.length) {
    fail("AI fixture material Q&A", `Received ${qaResult.response.status}: ${truncate(JSON.stringify(qaResult.data))}`);
    return;
  }

  pass("AI fixture material Q&A", `Answered with ${qaResult.data.citations.length} citation(s).`);

  const quizResult = await invokeEdgeFunction({
    supabaseUrl,
    supabaseAnonKey,
    authToken: session.accessToken,
    name: "generate-quiz",
    body: {
      courseId,
      topic: SMOKE_QUIZ_TOPIC,
      count: 1,
    },
  });
  const quizItems = Array.isArray(quizResult.data?.quizItems) ? quizResult.data.quizItems : [];

  if (!quizResult.response.ok || !quizItems[0]?.question || !quizItems[0]?.answer) {
    fail("AI fixture quiz generation", `Received ${quizResult.response.status}: ${truncate(JSON.stringify(quizResult.data))}`);
    return;
  }

  pass("AI fixture quiz generation", "Generated a cloud quiz card from seeded chunks.");
}

async function checkAuthenticatedCrud({ supabaseUrl, supabaseAnonKey, session }) {
  if (!session?.accessToken || !session?.user?.id) {
    warn(
      "Authenticated RLS CRUD",
      "Set SUPABASE_SMOKE_EMAIL/SUPABASE_SMOKE_PASSWORD or SUPABASE_SMOKE_ACCESS_TOKEN to run isolated CRUD checks.",
    );
    return;
  }

  const now = new Date().toISOString();
  const clientPrefix = process.env.SUPABASE_SMOKE_CLIENT_PREFIX || "ai-study-smoke";
  const clientId = `${clientPrefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let courseId = "";

  try {
    const courseResult = await insertSmokeRow({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      table: "courses",
      payload: {
        client_id: clientId,
        name: "Smoke Test Course",
        term: "Smoke",
        exam_date: "2026-12-31",
        daily_minutes: 30,
        preferred_start_time: "18:00",
        study_days: [1, 2, 3],
        updated_at: now,
      },
      select: "id,client_id,name",
    });

    if (!courseResult.response.ok || !courseResult.row?.id) {
      fail("Authenticated course insert", `Received ${courseResult.response.status}: ${truncate(JSON.stringify(courseResult.data))}`);
      return;
    }

    courseId = courseResult.row.id;
    pass("Authenticated course insert", `Created ${courseResult.row.client_id}.`);

    const materialResult = await insertSmokeRow({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      table: "materials",
      payload: {
        course_id: courseId,
        client_id: `${clientId}-material`,
        file_name: "smoke-notes.txt",
        file_type: "Notes",
        status: "Saved",
        size_bytes: 17,
        page_count: 0,
        indexed_pages: 0,
        index_status: "not_started",
        index_attempts: 0,
        chunk_count: 0,
        topics: ["Smoke test"],
      },
      select: "id,client_id,index_status",
    });

    if (!materialResult.response.ok || !materialResult.row?.id) {
      fail("Authenticated material insert", `Received ${materialResult.response.status}: ${truncate(JSON.stringify(materialResult.data))}`);
      return;
    }

    pass("Authenticated material insert", `Created ${materialResult.row.client_id}.`);

    const deadlineResult = await insertSmokeRow({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      table: "deadlines",
      payload: {
        course_id: courseId,
        client_id: `${clientId}-deadline`,
        title: "Smoke deadline",
        type: "Assignment",
        due_date: "2026-12-15",
        topic: "Smoke test",
        completed: false,
      },
      select: "id,client_id,title",
    });

    if (!deadlineResult.response.ok || !deadlineResult.row?.id) {
      fail("Authenticated deadline insert", `Received ${deadlineResult.response.status}: ${truncate(JSON.stringify(deadlineResult.data))}`);
      return;
    }

    pass("Authenticated deadline insert", `Created ${deadlineResult.row.client_id}.`);

    const questionResult = await insertSmokeRow({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      table: "material_questions",
      payload: {
        course_id: courseId,
        client_id: `${clientId}-question`,
        question: "What did the smoke test verify?",
        answer: "It verified authenticated RLS CRUD.",
        grounding: "Grounding: smoke",
        created_at: now,
      },
      select: "id,client_id,question",
    });

    if (!questionResult.response.ok || !questionResult.row?.id) {
      fail("Authenticated question insert", `Received ${questionResult.response.status}: ${truncate(JSON.stringify(questionResult.data))}`);
      return;
    }

    pass("Authenticated question insert", `Created ${questionResult.row.client_id}.`);

    const citationResult = await insertSmokeRow({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      table: "answer_citations",
      payload: {
        course_id: courseId,
        client_id: `${clientId}-citation-0`,
        material_question_id: questionResult.row.id,
        question: "What did the smoke test verify?",
        source_material_name: "smoke-notes.txt",
        topic: "Smoke test",
        answer_excerpt: "Authenticated inserts should be isolated to the smoke test user.",
        match_score: 1,
        created_at: now,
      },
      select: "id,client_id,source_material_name",
    });

    if (!citationResult.response.ok || !citationResult.row?.id) {
      fail("Authenticated citation insert", `Received ${citationResult.response.status}: ${truncate(JSON.stringify(citationResult.data))}`);
      return;
    }

    pass("Authenticated citation insert", `Created ${citationResult.row.client_id}.`);

    await checkAuthenticatedStorage({
      supabaseUrl,
      supabaseAnonKey,
      session,
      clientId,
    });

    await checkAiCloudFixture({
      supabaseUrl,
      supabaseAnonKey,
      session,
      courseId,
      materialId: materialResult.row.id,
      clientId,
    });

    const updateResult = await restRequest({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      table: "courses",
      query: `id=eq.${encodeFilterValue(courseId)}&select=id,name`,
      method: "PATCH",
      body: {
        name: "Smoke Test Course Updated",
        updated_at: new Date().toISOString(),
      },
      prefer: "return=representation",
    });
    const updatedCourse = getRepresentationRow(updateResult.data);

    if (!updateResult.response.ok || updatedCourse?.name !== "Smoke Test Course Updated") {
      fail("Authenticated course update", `Received ${updateResult.response.status}: ${truncate(JSON.stringify(updateResult.data))}`);
      return;
    }

    pass("Authenticated course update", "Updated smoke course name.");

    const readResult = await restRequest({
      supabaseUrl,
      supabaseAnonKey,
      authToken: session.accessToken,
      table: "materials",
      query: `course_id=eq.${encodeFilterValue(courseId)}&select=id,client_id`,
    });

    if (!readResult.response.ok || !Array.isArray(readResult.data) || readResult.data.length !== 1) {
      fail("Authenticated material read", `Received ${readResult.response.status}: ${truncate(JSON.stringify(readResult.data))}`);
      return;
    }

    pass("Authenticated material read", "Read isolated smoke material through RLS.");
  } finally {
    if (courseId) {
      const deleteResult = await restRequest({
        supabaseUrl,
        supabaseAnonKey,
        authToken: session.accessToken,
        table: "courses",
        query: `id=eq.${encodeFilterValue(courseId)}`,
        method: "DELETE",
      });

      if (deleteResult.response.ok) {
        pass("Authenticated cleanup", "Deleted smoke course and cascaded child rows.");
      } else {
        fail("Authenticated cleanup", `Received ${deleteResult.response.status}: ${truncate(JSON.stringify(deleteResult.data))}`);
      }
    }
  }
}

async function main() {
  const fallback = readConfigFallback();
  const supabaseUrl = cleanBaseUrl(process.env.SUPABASE_URL || fallback.supabaseUrl);
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || fallback.supabaseAnonKey;
  const smokeAccessToken = process.env.SUPABASE_SMOKE_ACCESS_TOKEN || "";
  const smokeEmail = process.env.SUPABASE_SMOKE_EMAIL || "";
  const smokePassword = process.env.SUPABASE_SMOKE_PASSWORD || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    fail(
      "Smoke configuration",
      "Set SUPABASE_URL and SUPABASE_ANON_KEY, or fill config.js before running this script.",
    );
    process.exitCode = 1;
    return;
  }

  pass("Smoke configuration", `Using ${supabaseUrl}.`);

  const smokeSession = await getSmokeSession({
    supabaseUrl,
    supabaseAnonKey,
    smokeAccessToken,
    smokeEmail,
    smokePassword,
  });
  const restAuthToken = smokeSession?.accessToken || (isJwt(supabaseAnonKey) ? supabaseAnonKey : "");
  const functionAuthToken = smokeSession?.accessToken || smokeAccessToken || supabaseAnonKey;

  await checkAppUrl(process.env.AI_STUDY_APP_URL || "");
  await checkRestSchema({ supabaseUrl, supabaseAnonKey, authToken: restAuthToken });
  await checkEdgeFunctions({ supabaseUrl, supabaseAnonKey, functionAuthToken });
  await checkAuthenticatedCrud({ supabaseUrl, supabaseAnonKey, session: smokeSession });

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
