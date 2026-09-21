import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_DETAIL_LIMIT = 10;
const root = resolve(import.meta.dirname, "..");

const results = [];

function readConfigFallback() {
  try {
    const config = readFileSync(resolve(root, "config.js"), "utf8");
    const supabaseUrl = config.match(/supabaseUrl:\s*["']([^"']+)["']/)?.[1] || "";

    return { supabaseUrl };
  } catch {
    return { supabaseUrl: "" };
  }
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function truncate(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.INDEX_MONITOR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  );

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

function buildRestUrl({ supabaseUrl, table, params }) {
  const query = new URLSearchParams(params);

  return `${supabaseUrl}/rest/v1/${table}?${query}`;
}

function parseContentRangeCount(response, fallbackCount) {
  const contentRange = response.headers.get("content-range") || "";
  const exactCount = Number(contentRange.split("/").pop());

  return Number.isFinite(exactCount) ? exactCount : fallbackCount;
}

async function restSelect({ supabaseUrl, serviceRoleKey, table, params }) {
  const response = await fetchWithTimeout(buildRestUrl({ supabaseUrl, table, params }), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "count=exact",
    },
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(`${table} returned ${response.status}: ${truncate(JSON.stringify(body), 600)}`);
  }

  const rows = Array.isArray(body) ? body : [];

  return {
    rows,
    count: parseContentRangeCount(response, rows.length),
  };
}

function jobLine(job) {
  const label = job.file_name ? `${job.file_name} (${job.material_id})` : job.material_id;
  const timing = job.locked_at || job.run_after || job.updated_at || "";
  const message = job.error ? ` - ${truncate(job.error)}` : "";

  return `${label} attempts ${job.attempts || 0}/${job.max_attempts || 0} ${timing}${message}`;
}

function printJobDetails(label, jobs) {
  if (!jobs.length) {
    return;
  }

  console.log("");
  console.log(label);

  for (const job of jobs) {
    console.log(`- ${jobLine(job)}`);
  }
}

function assertThreshold({ name, count, threshold, detail }) {
  if (count > threshold) {
    fail(name, `${count} found; threshold is ${threshold}. ${detail}`);
    return;
  }

  pass(name, `${count} found; threshold is ${threshold}.`);
}

async function getJobRows({ supabaseUrl, serviceRoleKey, params }) {
  return restSelect({
    supabaseUrl,
    serviceRoleKey,
    table: "material_index_jobs",
    params: {
      select:
        "id,material_id,course_id,status,attempts,max_attempts,error,run_after,locked_at,updated_at,finished_at,materials(file_name)",
      ...params,
    },
  });
}

function flattenJobRows(rows) {
  return rows.map((row) => ({
    ...row,
    file_name: row.materials?.file_name || "",
    materials: undefined,
  }));
}

async function getMaterialStatusCounts({ supabaseUrl, serviceRoleKey }) {
  const { rows } = await restSelect({
    supabaseUrl,
    serviceRoleKey,
    table: "materials",
    params: {
      select: "index_status",
      limit: "1000",
    },
  });

  return rows.reduce((counts, material) => {
    const status = material.index_status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

async function main() {
  const fallback = readConfigFallback();
  const supabaseUrl = cleanBaseUrl(process.env.SUPABASE_URL || fallback.supabaseUrl);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const detailLimit = Math.max(1, Math.min(numberEnv("INDEX_MONITOR_DETAIL_LIMIT", DEFAULT_DETAIL_LIMIT), 50));
  const staleMinutes = numberEnv("INDEX_MONITOR_STALE_MINUTES", 10);
  const failedThreshold = numberEnv("INDEX_MONITOR_FAILED_THRESHOLD", 0);
  const staleThreshold = numberEnv("INDEX_MONITOR_STALE_RUNNING_THRESHOLD", 0);
  const overdueQueuedThreshold = numberEnv("INDEX_MONITOR_OVERDUE_QUEUED_THRESHOLD", 20);

  if (!supabaseUrl || !serviceRoleKey) {
    fail(
      "Monitor configuration",
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running scripts/index-job-monitor.mjs.",
    );
    process.exitCode = 1;
    return;
  }

  pass("Monitor configuration", `Using ${supabaseUrl}.`);

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - staleMinutes * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  const failedJobs = await getJobRows({
    supabaseUrl,
    serviceRoleKey,
    params: {
      status: "eq.failed",
      order: "updated_at.desc",
      limit: String(detailLimit),
    },
  });
  const staleRunningJobs = await getJobRows({
    supabaseUrl,
    serviceRoleKey,
    params: {
      status: "eq.running",
      locked_at: `lt.${staleCutoff}`,
      order: "locked_at.asc",
      limit: String(detailLimit),
    },
  });
  const overdueQueuedJobs = await getJobRows({
    supabaseUrl,
    serviceRoleKey,
    params: {
      status: "eq.queued",
      run_after: `lt.${nowIso}`,
      order: "run_after.asc",
      limit: String(detailLimit),
    },
  });
  const materialStatusCounts = await getMaterialStatusCounts({ supabaseUrl, serviceRoleKey });

  assertThreshold({
    name: "Failed index jobs",
    count: failedJobs.count,
    threshold: failedThreshold,
    detail: "Review errors or retry after fixing source files/secrets.",
  });
  assertThreshold({
    name: "Stale running index jobs",
    count: staleRunningJobs.count,
    threshold: staleThreshold,
    detail: `Jobs locked before ${staleCutoff} should be picked up by the worker.`,
  });
  assertThreshold({
    name: "Overdue queued index jobs",
    count: overdueQueuedJobs.count,
    threshold: overdueQueuedThreshold,
    detail: "Confirm the worker scheduler is active.",
  });

  printJobDetails("Failed index jobs", flattenJobRows(failedJobs.rows));
  printJobDetails("Stale running index jobs", flattenJobRows(staleRunningJobs.rows));
  printJobDetails("Overdue queued index jobs", flattenJobRows(overdueQueuedJobs.rows));

  console.log("");
  console.log("Material index status counts");

  for (const [status, count] of Object.entries(materialStatusCounts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`- ${status}: ${count}`);
  }

  const failedCount = results.filter((result) => result.status === "FAIL").length;
  const warningCount = results.filter((result) => result.status === "WARN").length;
  const passedCount = results.filter((result) => result.status === "PASS").length;

  console.log("");
  console.log(`Monitor summary: ${passedCount} passed, ${warningCount} warnings, ${failedCount} failed.`);

  if (failedCount) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fail("Index job monitor", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
