const STORAGE_KEY = "ai-study-planner-state-v1";
const MAX_TEXT_CHARS = 18000;
const MAX_PDF_PAGES = 35;
const PDFJS_VERSION = "6.3.289";
const PDFJS_MODULE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;
const SUPABASE_CONFIG = window.AI_STUDY_PLANNER_CONFIG || {};
const DEFAULT_CLOUD_COURSE_CLIENT_ID = "default-course";
const CLOUD_COURSE_SELECTION_KEY = "ai-study-planner-selected-cloud-course-v1";
const MATERIAL_STORAGE_BUCKET = "course-materials";
const MATERIAL_INDEX_STATUSES = new Set(["not_started", "queued", "indexing", "indexed", "failed"]);
const CLOUD_AUTOSAVE_DELAY_MS = 1400;

let pdfjsLoadingPromise;
let quizAnswerVisible = false;
let focusTimerId = null;
let supabaseClient = null;
let authSession = null;
let authStatusMessage = "";
let cloudAutosaveTimer = null;
let cloudAutosaveInFlight = false;
let cloudAutosaveQueued = false;
let cloudAutosaveBlocked = false;
let lastCloudSyncSignature = "";
let lastCloudSeenCourseUpdatedAt = "";
let cloudSyncBaselineConfirmed = false;
let activeCloudCourseClientId = loadStoredCloudCourseClientId();
let cloudCourses = [];
let cloudCoursesLoading = false;
let cloudConflict = null;

const stopWords = new Set([
  "about",
  "after",
  "before",
  "from",
  "have",
  "should",
  "that",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

const topicPatterns = [
  { name: "Graph traversal", terms: ["graph", "bfs", "dfs", "traversal", "shortest path"] },
  { name: "Recurrence relations", terms: ["recurrence", "master theorem", "asymptotic", "big o"] },
  { name: "Hash tables", terms: ["hash", "collision", "chaining", "probing"] },
  { name: "Tree rotations", terms: ["tree", "rotation", "avl", "red black", "binary search"] },
  { name: "Exam logistics", terms: ["exam", "midterm", "final", "quiz", "deadline"] },
  { name: "Assignments", terms: ["assignment", "project", "homework", "submission"] },
];

const monthLookup = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const sampleMaterials = [
  {
    id: "sample-syllabus",
    name: "CS 241 Syllabus.pdf",
    type: "Syllabus",
    status: "PDF saved",
    size: 312000,
    uploadedAt: "2026-09-14T12:00:00.000Z",
    text: "",
    topics: ["Exam logistics", "Assignments"],
  },
  {
    id: "sample-lecture-7",
    name: "Lecture 7 - Graph Traversal.txt",
    type: "Notes",
    status: "Text indexed",
    size: 5200,
    uploadedAt: "2026-09-14T12:05:00.000Z",
    text:
      "Graph traversal covers breadth first search and depth first search. BFS uses a queue and is preferred when exploring by distance from a start node. DFS uses recursion or a stack and is useful for topological structure, cycle checks, and connected components.",
    topics: ["Graph traversal"],
  },
  {
    id: "sample-assignment-3",
    name: "Assignment 3 Brief.pdf",
    type: "Assignment",
    status: "PDF saved",
    size: 184000,
    uploadedAt: "2026-09-14T12:08:00.000Z",
    text: "",
    topics: ["Assignments", "Graph traversal"],
  },
];

const sampleDeadlines = [
  {
    id: "sample-deadline-assignment-3",
    title: "Assignment 3",
    type: "Assignment",
    dueDate: "2026-09-24",
    topic: "Graph traversal",
    completed: false,
    createdAt: "2026-09-14T12:10:00.000Z",
  },
  {
    id: "sample-deadline-graph-quiz",
    title: "Graph Traversal Quiz",
    type: "Quiz",
    dueDate: "2026-09-28",
    topic: "Graph traversal",
    completed: false,
    createdAt: "2026-09-14T12:12:00.000Z",
  },
  {
    id: "sample-deadline-midterm",
    title: "Midterm Exam",
    type: "Exam",
    dueDate: "2026-10-18",
    topic: "Exam logistics",
    completed: false,
    createdAt: "2026-09-14T12:14:00.000Z",
  },
];

const defaultState = {
  course: {
    name: "Data Structures",
    examDate: "2026-10-18",
    dailyMinutes: 45,
    preferredStartTime: "18:00",
    studyDays: [1, 2, 3, 4, 5],
  },
  materials: sampleMaterials,
  deadlines: sampleDeadlines,
  suggestedDeadlines: [],
  schedule: [],
  topicProgress: {},
  completedSessions: {},
  quizItems: [],
  quizHistory: [],
  answerHistory: [],
  materialSearchQuery: "",
  focusSession: {
    selectedSessionId: "",
    secondsRemaining: null,
    isRunning: false,
    startedAt: null,
    notes: "",
  },
  questionIndex: 0,
};

let state = loadState();

function normalizeState(rawState = {}) {
  const merged = { ...structuredClone(defaultState), ...rawState };

  merged.course = { ...structuredClone(defaultState.course), ...(rawState.course || {}) };
  merged.course.dailyMinutes = Number(merged.course.dailyMinutes) || defaultState.course.dailyMinutes;
  merged.course.preferredStartTime = isValidStudyTime(merged.course.preferredStartTime)
    ? merged.course.preferredStartTime
    : defaultState.course.preferredStartTime;
  const normalizedStudyDays = Array.isArray(merged.course.studyDays)
    ? [...new Set(merged.course.studyDays.map(Number).filter((day) => day >= 0 && day <= 6))]
    : defaultState.course.studyDays;
  merged.course.studyDays = normalizedStudyDays.length ? normalizedStudyDays : defaultState.course.studyDays;
  merged.materials = (merged.materials || []).map((material) => ({
    ...material,
    id: material.id || makeId(),
    name: material.name || "Untitled material",
    type: material.type || inferType(material.name || ""),
    status: material.status || "Saved",
    size: Number(material.size) || 0,
    uploadedAt: material.uploadedAt || new Date().toISOString(),
    topics: material.topics?.length ? material.topics : inferTopics(`${material.name || ""} ${material.text || ""}`),
    text: material.text || "",
    pageCount: Number(material.pageCount) || 0,
    indexedPages: Number(material.indexedPages) || 0,
    indexStatus: normalizeMaterialIndexStatus(material),
    indexError: material.indexError || material.index_error || "",
    indexAttempts: Number(material.indexAttempts ?? material.index_attempts) || 0,
    chunkCount: getMaterialChunkCount(material),
    indexStartedAt: material.indexStartedAt || material.index_started_at || null,
    indexedAt: material.indexedAt || material.indexed_at || null,
    storageBucket: material.storageBucket || MATERIAL_STORAGE_BUCKET,
    storagePath: material.storagePath || "",
    cloudStatus: material.cloudStatus || (material.storagePath ? "Cloud file saved" : "Local only"),
    cloudUploadedAt: material.cloudUploadedAt || null,
    cloudError: material.cloudError || "",
  }));
  merged.deadlines = (merged.deadlines || []).map((deadline) => ({
    ...deadline,
    id: deadline.id || makeId(),
    title: deadline.title || "Untitled deadline",
    type: deadline.type || "Assignment",
    dueDate: deadline.dueDate || merged.course?.examDate || defaultState.course.examDate,
    topic: deadline.topic || "General review",
    completed: Boolean(deadline.completed),
    createdAt: deadline.createdAt || new Date().toISOString(),
  }));
  merged.suggestedDeadlines = (merged.suggestedDeadlines || []).map((suggestion) => ({
    ...suggestion,
    id: suggestion.id || makeId(),
    title: suggestion.title || "Suggested deadline",
    type: suggestion.type || "Assignment",
    dueDate: suggestion.dueDate || merged.course?.examDate || defaultState.course.examDate,
    topic: suggestion.topic || "General review",
    confidence: suggestion.confidence || "Medium",
    excerpt: suggestion.excerpt || "",
    sourceMaterialId: suggestion.sourceMaterialId || "",
    sourceMaterialName: suggestion.sourceMaterialName || "Uploaded material",
    createdAt: suggestion.createdAt || new Date().toISOString(),
  }));
  merged.schedule = Array.isArray(merged.schedule) ? merged.schedule.map(withSessionId) : [];
  merged.topicProgress = merged.topicProgress || {};
  merged.completedSessions = merged.completedSessions || {};
  merged.quizItems = (merged.quizItems || [])
    .map(normalizeQuizItem)
    .filter((item) => item.question && item.answer)
    .slice(0, 40);
  merged.quizHistory = (merged.quizHistory || [])
    .map((attempt) => ({
      ...attempt,
      id: attempt.id || makeId(),
      topic: attempt.topic || "General review",
      question: attempt.question || "Quiz attempt",
      source: attempt.source || "No source",
      result: attempt.result === "hit" ? "hit" : "miss",
      confidenceAfter: Number(attempt.confidenceAfter) || 0,
      answeredAt: attempt.answeredAt || new Date().toISOString(),
    }))
    .slice(0, 50);
  merged.answerHistory = (merged.answerHistory || [])
    .map((entry) => ({
      ...entry,
      id: entry.id || makeId(),
      question: entry.question || "Study question",
      answer: entry.answer || "",
      grounding: entry.grounding || "Grounding: none",
      citations: Array.isArray(entry.citations) ? entry.citations.slice(0, 3).map(normalizeAnswerCitation) : [],
      askedAt: entry.askedAt || new Date().toISOString(),
    }))
    .slice(0, 20);
  merged.materialSearchQuery = rawState.materialSearchQuery || "";
  const rawFocusSession = rawState.focusSession || {};
  const rawSecondsRemaining = Number(rawFocusSession.secondsRemaining);
  merged.focusSession = {
    ...structuredClone(defaultState.focusSession),
    ...rawFocusSession,
    selectedSessionId: rawFocusSession.selectedSessionId || "",
    secondsRemaining: Number.isFinite(rawSecondsRemaining) ? Math.max(0, Math.round(rawSecondsRemaining)) : null,
    isRunning: Boolean(rawFocusSession.isRunning),
    startedAt: rawFocusSession.startedAt || null,
    notes: rawFocusSession.notes || "",
  };

  if (merged.focusSession.isRunning) {
    const startedAt = new Date(merged.focusSession.startedAt).getTime();

    if (Number.isFinite(startedAt) && merged.focusSession.secondsRemaining !== null) {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      merged.focusSession.secondsRemaining = Math.max(0, merged.focusSession.secondsRemaining - elapsedSeconds);
      merged.focusSession.startedAt = new Date().toISOString();
    } else {
      merged.focusSession.isRunning = false;
      merged.focusSession.startedAt = null;
    }

    if (merged.focusSession.secondsRemaining <= 0) {
      merged.focusSession.isRunning = false;
      merged.focusSession.startedAt = null;
    }
  }

  merged.questionIndex = Number(merged.questionIndex) || 0;

  return merged;
}

function normalizeMaterialIndexStatus(material = {}) {
  const explicitStatus = String(material.indexStatus || material.index_status || "").toLowerCase();

  if (MATERIAL_INDEX_STATUSES.has(explicitStatus)) {
    return explicitStatus;
  }

  const statusText = `${material.status || ""} ${material.cloudStatus || ""}`.toLowerCase();

  if (/indexed\s+\d+\s+chunks?/.test(statusText) || statusText.includes("cloud indexed")) {
    return "indexed";
  }

  if (statusText.includes("queued for indexing") || statusText.includes("indexing queued")) {
    return "queued";
  }

  if (material.indexError || material.index_error || statusText.includes("indexing failed")) {
    return "failed";
  }

  if (statusText.includes("indexing")) {
    return "indexing";
  }

  return "not_started";
}

function getMaterialChunkCount(material = {}) {
  const explicitCount = Number(material.chunkCount ?? material.chunk_count);

  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return explicitCount;
  }

  const match = String(material.status || material.cloudStatus || "").match(/Indexed\s+(\d+)\s+chunks?/i);

  return match ? Number(match[1]) || 0 : 0;
}

function updateMaterialIndexState(materialId, patch) {
  state.materials = state.materials.map((item) =>
    item.id === materialId
      ? {
          ...item,
          ...patch,
          indexStatus: normalizeMaterialIndexStatus({ ...item, ...patch }),
          chunkCount: getMaterialChunkCount({ ...item, ...patch }),
        }
      : item,
  );
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return structuredClone(defaultState);
  }

  try {
    const parsed = JSON.parse(stored);
    return normalizeState(parsed);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getCloudCourseSelectionStorageKey() {
  return authSession?.user?.id
    ? `${CLOUD_COURSE_SELECTION_KEY}:${authSession.user.id}`
    : CLOUD_COURSE_SELECTION_KEY;
}

function loadStoredCloudCourseClientId() {
  if (authSession?.user?.id) {
    return localStorage.getItem(getCloudCourseSelectionStorageKey()) || DEFAULT_CLOUD_COURSE_CLIENT_ID;
  }

  return localStorage.getItem(CLOUD_COURSE_SELECTION_KEY) || DEFAULT_CLOUD_COURSE_CLIENT_ID;
}

function setActiveCloudCourseClientId(clientId) {
  activeCloudCourseClientId = clientId || DEFAULT_CLOUD_COURSE_CLIENT_ID;
  localStorage.setItem(CLOUD_COURSE_SELECTION_KEY, activeCloudCourseClientId);
  localStorage.setItem(getCloudCourseSelectionStorageKey(), activeCloudCourseClientId);
}

function getActiveCloudCourseClientId() {
  return activeCloudCourseClientId || DEFAULT_CLOUD_COURSE_CLIENT_ID;
}

function createCloudCourseClientId(courseName = state.course.name) {
  const slug = String(courseName || "course")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);

  return `${slug || "course"}-${Date.now()}`;
}

function sortById(items) {
  return [...items].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
}

function getCloudSyncSnapshot() {
  return {
    course: {
      name: state.course.name || "Course",
      examDate: state.course.examDate || "",
      dailyMinutes: Number(state.course.dailyMinutes) || defaultState.course.dailyMinutes,
      preferredStartTime: getPreferredStartTime(),
      studyDays: getStudyDays(),
    },
    materials: sortById(state.materials || []).map((material) => ({
      id: material.id,
      name: material.name,
      type: material.type || "Material",
      status: material.status || "Saved",
      size: Number(material.size) || 0,
      pageCount: Number(material.pageCount) || 0,
      indexedPages: Number(material.indexedPages) || 0,
      indexStatus: normalizeMaterialIndexStatus(material),
      indexError: material.indexError || "",
      indexAttempts: Number(material.indexAttempts) || 0,
      chunkCount: getMaterialChunkCount(material),
      indexStartedAt: material.indexStartedAt || "",
      indexedAt: material.indexedAt || "",
      storagePath: material.storagePath || "",
      topics: material.topics || [],
      uploadedAt: material.uploadedAt || "",
    })),
    deadlines: sortById(state.deadlines || []).map((deadline) => ({
      id: deadline.id,
      title: deadline.title,
      type: deadline.type || "Assignment",
      dueDate: deadline.dueDate,
      topic: deadline.topic || "General review",
      completed: Boolean(deadline.completed),
      createdAt: deadline.createdAt || "",
    })),
    schedule: sortById(state.schedule || []).map((session) => ({
      id: session.id,
      day: session.day,
      dateKey: session.dateKey,
      task: session.task,
      time: session.time,
      focus: session.focus,
      reason: session.reason || "",
      completed: Boolean(state.completedSessions?.[session.id]),
    })),
    completedSessions: sortById(Object.values(state.completedSessions || {})).map((session) => ({
      id: session.id,
      task: session.task,
      focus: session.focus,
      minutes: Number(session.minutes) || 0,
      notes: session.notes || "",
      completedAt: session.completedAt || "",
    })),
    quizItems: sortById(state.quizItems || []).map((item) => ({
      id: item.id,
      topic: item.topic || "General review",
      question: item.question,
      answer: item.answer,
      source: item.source || "Indexed material",
      sourceExcerpt: item.sourceExcerpt || "",
      materialChunkId: item.materialChunkId || "",
      generatedAt: item.generatedAt || "",
      cloudGenerated: Boolean(item.cloudGenerated),
    })),
    topicProgress: Object.fromEntries(
      Object.entries(state.topicProgress || {})
        .sort(([topicA], [topicB]) => topicA.localeCompare(topicB))
        .map(([topic, progress]) => [
          topic,
          {
            confidence: Math.round(Number(progress.confidence) || 0),
            studySessions: Number(progress.studySessions) || 0,
            attempts: Number(progress.attempts) || 0,
            misses: Number(progress.misses) || 0,
            lastReviewedAt: progress.lastReviewedAt || "",
          },
        ]),
    ),
    quizHistory: sortById(state.quizHistory || []).map((attempt) => ({
      id: attempt.id,
      topic: attempt.topic || "General review",
      question: attempt.question || "Quiz attempt",
      source: attempt.source || "No source",
      result: attempt.result === "hit" ? "hit" : "miss",
      confidenceAfter: Number(attempt.confidenceAfter) || 0,
      answeredAt: attempt.answeredAt || "",
    })),
    answerHistory: sortById(state.answerHistory || []).map((entry) => ({
      id: entry.id,
      question: entry.question,
      answer: entry.answer || "",
      grounding: entry.grounding || "Grounding: none",
      citations: (entry.citations || []).map(normalizeAnswerCitation),
      askedAt: entry.askedAt || "",
    })),
  };
}

function getCloudSyncSignature() {
  return JSON.stringify(getCloudSyncSnapshot());
}

function hasCloudLoadConflictRisk() {
  return !cloudSyncBaselineConfirmed || (Boolean(lastCloudSyncSignature) && getCloudSyncSignature() !== lastCloudSyncSignature);
}

function getPlannerSummary() {
  return `${state.materials.length} materials, ${state.deadlines.length} deadlines, ${state.schedule.length} sessions`;
}

function formatCloudDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clearCloudAutosaveTimer() {
  if (cloudAutosaveTimer) {
    window.clearTimeout(cloudAutosaveTimer);
    cloudAutosaveTimer = null;
  }
}

function rememberCloudCourse(course) {
  if (!course?.client_id) {
    return;
  }

  cloudCourses = [
    course,
    ...cloudCourses.filter((item) => item.client_id !== course.client_id),
  ].sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
}

function setCloudConflict(course, reason = "Cloud data changed before autosave could run.") {
  cloudAutosaveBlocked = true;
  cloudConflict = {
    courseClientId: course?.client_id || getActiveCloudCourseClientId(),
    courseName: course?.name || state.course.name || "Selected course",
    remoteUpdatedAt: course?.updated_at || "",
    localSummary: getPlannerSummary(),
    reason,
    detectedAt: new Date().toISOString(),
  };
}

function clearCloudConflict() {
  cloudConflict = null;
}

function markCloudSyncBaseline(course = null) {
  rememberCloudCourse(course);
  lastCloudSyncSignature = getCloudSyncSignature();
  lastCloudSeenCourseUpdatedAt = course?.updated_at || lastCloudSeenCourseUpdatedAt || "";
  cloudSyncBaselineConfirmed = cloudSyncBaselineConfirmed || Boolean(course?.updated_at);
  cloudAutosaveBlocked = false;
  clearCloudConflict();
}

function resetCloudSyncTracking() {
  clearCloudAutosaveTimer();
  cloudAutosaveInFlight = false;
  cloudAutosaveQueued = false;
  cloudAutosaveBlocked = false;
  lastCloudSyncSignature = "";
  lastCloudSeenCourseUpdatedAt = "";
  cloudSyncBaselineConfirmed = false;
  clearCloudConflict();
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasSupabaseConfig() {
  return Boolean(SUPABASE_CONFIG.supabaseUrl && SUPABASE_CONFIG.supabaseAnonKey);
}

function getSupabaseClient() {
  if (!hasSupabaseConfig() || !window.supabase?.createClient) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.supabaseUrl, SUPABASE_CONFIG.supabaseAnonKey);
  }

  return supabaseClient;
}

function setAuthStatus(message) {
  authStatusMessage = message;
  document.querySelector("#authStatus").textContent = message;
}

function clearAuthStatus() {
  authStatusMessage = "";
}

async function refreshAuthSession() {
  const client = getSupabaseClient();

  if (!client) {
    authSession = null;
    return null;
  }

  const { data, error } = await client.auth.getSession();

  if (error) {
    console.warn(error);
    authSession = null;
    return null;
  }

  authSession = data.session || null;
  return authSession;
}

function getAuthenticatedSupabaseClient() {
  const client = getSupabaseClient();

  if (!client) {
    setAuthStatus("Add Supabase config to enable cloud sync.");
    return null;
  }

  if (!authSession?.user?.id) {
    setAuthStatus("Sign in before syncing planner data.");
    return null;
  }

  return client;
}

async function refreshCloudCourses() {
  const client = getSupabaseClient();

  if (!client || !authSession?.user?.id) {
    cloudCourses = [];
    cloudCoursesLoading = false;
    return [];
  }

  cloudCoursesLoading = true;
  renderAuthPanel();

  try {
    const { data, error } = await client
      .from("courses")
      .select("id, client_id, name, term, exam_date, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    cloudCourses = data || [];

    if (cloudCourses.length && !cloudCourses.some((course) => course.client_id === getActiveCloudCourseClientId())) {
      setActiveCloudCourseClientId(cloudCourses[0].client_id);
      resetCloudSyncTracking();
      markCloudSyncBaseline();
      setAuthStatus("Selected your most recent cloud course. Load cloud before editing, or Sync now to overwrite it.");
    }

    return cloudCourses;
  } catch (error) {
    console.error(error);
    setAuthStatus(getCloudErrorMessage(error));
    return [];
  } finally {
    cloudCoursesLoading = false;
    renderAuthPanel();
  }
}

function getCloudCourseOptionLabel(course) {
  const name = course?.name || state.course.name || "Current planner";
  const examDate = toDateInputValue(course?.exam_date);

  return examDate ? `${name} (${examDate})` : name;
}

function renderCloudCourseSelect() {
  const courseSelect = document.querySelector("#cloudCourseSelect");

  if (!courseSelect) {
    return;
  }

  const activeClientId = getActiveCloudCourseClientId();
  const options = [];
  const activeCourse = cloudCourses.find((course) => course.client_id === activeClientId);

  if (!activeCourse) {
    options.push({
      value: activeClientId,
      label: `${state.course.name || "Current planner"} (new)`,
    });
  }

  cloudCourses.forEach((course) => {
    options.push({
      value: course.client_id,
      label: getCloudCourseOptionLabel(course),
    });
  });

  courseSelect.replaceChildren(
    ...options.map((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      return element;
    }),
  );
  courseSelect.value = activeClientId;
}

async function handleCloudCourseSelection(clientId) {
  if (!clientId || clientId === getActiveCloudCourseClientId()) {
    renderAuthPanel();
    return;
  }

  if (
    hasCloudLoadConflictRisk() &&
    !window.confirm("Switching cloud courses can leave unsynced local changes behind. Continue?")
  ) {
    renderAuthPanel();
    return;
  }

  setActiveCloudCourseClientId(clientId);
  resetCloudSyncTracking();
  markCloudSyncBaseline();
  renderAuthPanel();

  const selectedCourse = cloudCourses.find((course) => course.client_id === clientId);
  setAuthStatus(`Selected ${getCloudCourseOptionLabel(selectedCourse)}. Load cloud or Sync now.`);
}

async function createCloudCourseFromCurrentPlanner() {
  const client = getAuthenticatedSupabaseClient();

  if (!client) {
    return;
  }

  const previousCourseClientId = getActiveCloudCourseClientId();
  const nextCourseClientId = createCloudCourseClientId();

  setActiveCloudCourseClientId(nextCourseClientId);
  resetCloudSyncTracking();
  setAuthStatus("Creating cloud course...");

  const synced = await syncPlannerToCloud();

  if (!synced) {
    setActiveCloudCourseClientId(previousCourseClientId);
    resetCloudSyncTracking();
    renderAuthPanel();
    return;
  }

  await refreshCloudCourses();
  setAuthStatus(`Created ${state.course.name || "cloud course"} and synced planner data.`);
}

async function loadCloudConflictVersion() {
  await loadPlannerFromCloud({ force: true });
}

function keepLocalConflictVersion() {
  if (!cloudConflict) {
    renderAuthPanel();
    return;
  }

  lastCloudSeenCourseUpdatedAt = cloudConflict.remoteUpdatedAt || lastCloudSeenCourseUpdatedAt;
  cloudAutosaveBlocked = false;
  clearCloudConflict();
  setAuthStatus("Keeping local planner. Autosave will update cloud.");
  queueCloudAutosave("conflict resolution");
  renderAuthPanel();
}

async function overwriteCloudConflictVersion() {
  if (!cloudConflict) {
    await syncPlannerToCloud();
    return;
  }

  cloudAutosaveBlocked = false;
  await syncPlannerToCloud();
}

function canAutosaveToCloud() {
  return Boolean(getSupabaseClient() && authSession?.user?.id);
}

async function shouldPauseCloudAutosaveForConflict(client) {
  const course = await getCloudCourse(client);

  if (!course) {
    return false;
  }

  const remoteUpdatedAt = course.updated_at || "";

  if (remoteUpdatedAt && remoteUpdatedAt !== lastCloudSeenCourseUpdatedAt) {
    setCloudConflict(course);
    lastCloudSeenCourseUpdatedAt = remoteUpdatedAt;
    setAuthStatus("Cloud autosave paused. Choose how to resolve the cloud conflict.");
    renderAuthPanel();
    return true;
  }

  return false;
}

async function flushCloudAutosave() {
  cloudAutosaveTimer = null;

  if (!canAutosaveToCloud() || cloudAutosaveBlocked) {
    return;
  }

  const nextSignature = getCloudSyncSignature();

  if (nextSignature === lastCloudSyncSignature) {
    return;
  }

  if (cloudAutosaveInFlight) {
    cloudAutosaveQueued = true;
    return;
  }

  cloudAutosaveInFlight = true;

  try {
    const client = getSupabaseClient();

    if (await shouldPauseCloudAutosaveForConflict(client)) {
      return;
    }

    await syncPlannerToCloud({ source: "autosave" });
  } finally {
    cloudAutosaveInFlight = false;

    if (cloudAutosaveQueued) {
      cloudAutosaveQueued = false;
      queueCloudAutosave("queued update");
    }
  }
}

function queueCloudAutosave(reason = "planner update") {
  if (!canAutosaveToCloud() || cloudAutosaveBlocked) {
    return;
  }

  if (getCloudSyncSignature() === lastCloudSyncSignature) {
    return;
  }

  clearCloudAutosaveTimer();
  setAuthStatus(`Cloud autosave pending after ${reason}...`);
  cloudAutosaveTimer = window.setTimeout(flushCloudAutosave, CLOUD_AUTOSAVE_DELAY_MS);
}

function getCloudErrorMessage(error) {
  return error?.message ? `Cloud sync error: ${error.message}` : "Cloud sync failed. Try again after setup is complete.";
}

function canUseCloudStorage() {
  return Boolean(getSupabaseClient() && authSession?.user?.id);
}

function sanitizeStorageSegment(value) {
  return String(value || "file")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "file";
}

function getMaterialStoragePath(material, file) {
  const userId = authSession?.user?.id || "local-user";
  const fileName = sanitizeStorageSegment(file?.name || material.name || "material");

  return `${userId}/${getActiveCloudCourseClientId()}/${material.id}/${fileName}`;
}

async function uploadMaterialFileToCloud(file, material) {
  const client = getSupabaseClient();

  if (!client || !authSession?.user?.id) {
    return {
      ...material,
      storageBucket: MATERIAL_STORAGE_BUCKET,
      storagePath: "",
      cloudStatus: "Local only",
    };
  }

  const storagePath = getMaterialStoragePath(material, file);
  const { data, error } = await client.storage.from(MATERIAL_STORAGE_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });

  if (error) {
    console.warn("Supabase Storage upload failed", error);

    return {
      ...material,
      storageBucket: MATERIAL_STORAGE_BUCKET,
      storagePath: "",
      cloudStatus: "Cloud upload failed",
      cloudError: error.message || "Storage upload failed",
    };
  }

  return {
    ...material,
    storageBucket: MATERIAL_STORAGE_BUCKET,
    storagePath: data?.path || storagePath,
    cloudStatus: "Cloud file saved",
    cloudError: "",
    cloudUploadedAt: new Date().toISOString(),
  };
}

async function removeMaterialFileFromCloud(material) {
  const client = getSupabaseClient();

  if (!client || !authSession?.user?.id || !material?.storagePath) {
    return "skipped";
  }

  const { error } = await client.storage
    .from(material.storageBucket || MATERIAL_STORAGE_BUCKET)
    .remove([material.storagePath]);

  if (error) {
    console.warn("Supabase Storage delete failed", error);
    return "failed";
  }

  return "removed";
}

async function downloadMaterialFromCloud(material) {
  const client = getSupabaseClient();
  const uploadStatus = document.querySelector("#uploadStatus");

  if (!client || !authSession?.user?.id || !material?.storagePath) {
    uploadStatus.textContent = "Sign in and choose a cloud-stored material before downloading.";
    return;
  }

  uploadStatus.textContent = `Creating secure download link for ${material.name}...`;

  const { data, error } = await client.storage
    .from(material.storageBucket || MATERIAL_STORAGE_BUCKET)
    .createSignedUrl(material.storagePath, 120, {
      download: material.name,
    });

  if (error || !data?.signedUrl) {
    console.warn("Supabase Storage signed URL failed", error);
    uploadStatus.textContent = "Could not create a secure download link for this material.";
    return;
  }

  const link = document.createElement("a");
  link.href = data.signedUrl;
  link.download = material.name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  uploadStatus.textContent = `Download link created for ${material.name}.`;
}

function getMaterialStorageLabel(material) {
  if (material.storagePath) {
    const indexStatus = normalizeMaterialIndexStatus(material);
    const chunkCount = getMaterialChunkCount(material);

    if (indexStatus === "indexed") {
      return chunkCount ? `Cloud indexed: ${chunkCount} chunks` : "Cloud indexed";
    }

    if (indexStatus === "queued") {
      return "Cloud indexing queued";
    }

    if (indexStatus === "indexing") {
      return "Cloud indexing in progress";
    }

    if (indexStatus === "failed") {
      const attempts = Number(material.indexAttempts) || 0;
      return attempts > 1 ? `Cloud indexing failed after ${attempts} attempts` : "Cloud indexing failed";
    }

    return "Cloud file saved";
  }

  return material.cloudStatus || "Local only";
}

function toDateInputValue(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : formatDateKey(date);
}

function toScheduledAt(session) {
  const dateKey = session.dateKey || formatDateKey(new Date());
  const startTime = getPreferredStartTime();
  const date = new Date(`${dateKey}T${startTime}:00`);

  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function cloudCoursePayload(userId) {
  return {
    user_id: userId,
    client_id: getActiveCloudCourseClientId(),
    name: state.course.name || "Course",
    term: "Fall semester",
    exam_date: state.course.examDate || null,
    daily_minutes: Number(state.course.dailyMinutes) || defaultState.course.dailyMinutes,
    preferred_start_time: getPreferredStartTime(),
    study_days: getStudyDays(),
    updated_at: new Date().toISOString(),
  };
}

async function getCloudCourse(client, { create = false } = {}) {
  const userId = authSession?.user?.id;
  const { data: existingCourse, error: existingError } = await client
    .from("courses")
    .select("*")
    .eq("client_id", getActiveCloudCourseClientId())
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingCourse || !create) {
    return existingCourse;
  }

  const { data, error } = await client.from("courses").insert(cloudCoursePayload(userId)).select("*").single();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertCloudCourse(client) {
  const userId = authSession.user.id;
  const { data, error } = await client
    .from("courses")
    .upsert(cloudCoursePayload(userId), { onConflict: "user_id,client_id" })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function deleteStaleClientRows(client, table, courseId, currentClientIds) {
  const { data, error } = await client
    .from(table)
    .select("id, client_id")
    .eq("course_id", courseId)
    .not("client_id", "is", null);

  if (error) {
    throw error;
  }

  const staleRows = (data || []).filter((row) => !currentClientIds.has(row.client_id));

  for (const row of staleRows) {
    const { error: deleteError } = await client.from(table).delete().eq("id", row.id);

    if (deleteError) {
      throw deleteError;
    }
  }
}

async function upsertCloudRows(client, table, courseId, rows, conflict = "course_id,client_id") {
  await deleteStaleClientRows(
    client,
    table,
    courseId,
    new Set(rows.map((row) => row.client_id).filter(Boolean)),
  );

  if (!rows.length) {
    return [];
  }

  const { data, error } = await client.from(table).upsert(rows, { onConflict: conflict }).select("*");

  if (error) {
    throw error;
  }

  return data || [];
}

async function syncTopicProgressRows(client, courseId, rows) {
  const currentTopics = new Set(rows.map((row) => row.topic));
  const { data: existingRows, error: existingError } = await client
    .from("topic_progress")
    .select("id, topic")
    .eq("course_id", courseId);

  if (existingError) {
    throw existingError;
  }

  for (const row of existingRows || []) {
    if (!currentTopics.has(row.topic)) {
      const { error } = await client.from("topic_progress").delete().eq("id", row.id);

      if (error) {
        throw error;
      }
    }
  }

  if (!rows.length) {
    return [];
  }

  const { data, error } = await client.from("topic_progress").upsert(rows, { onConflict: "course_id,topic" });

  if (error) {
    throw error;
  }

  return data || [];
}

function materialCloudRows(courseId, userId) {
  return state.materials.map((material) => ({
    course_id: courseId,
    user_id: userId,
    client_id: material.id,
    file_name: material.name,
    file_type: material.type || "Material",
    storage_path: material.storagePath || null,
    status: material.status || "Saved",
    size_bytes: Number(material.size) || 0,
    page_count: Number(material.pageCount) || 0,
    indexed_pages: Number(material.indexedPages) || 0,
    index_status: normalizeMaterialIndexStatus(material),
    index_error: material.indexError || null,
    index_attempts: Number(material.indexAttempts) || 0,
    chunk_count: getMaterialChunkCount(material),
    index_started_at: material.indexStartedAt || null,
    indexed_at: material.indexedAt || null,
    topics: material.topics?.length ? material.topics : ["General review"],
    created_at: material.uploadedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function deadlineCloudRows(courseId, userId) {
  return state.deadlines.map((deadline) => ({
    course_id: courseId,
    user_id: userId,
    client_id: deadline.id,
    title: deadline.title,
    type: deadline.type || "Assignment",
    due_date: deadline.dueDate,
    topic: deadline.topic || "General review",
    completed: Boolean(deadline.completed),
    created_at: deadline.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

function studySessionCloudRows(courseId, userId) {
  return state.schedule.map((session) => ({
    course_id: courseId,
    user_id: userId,
    client_id: session.id,
    scheduled_for: toScheduledAt(session),
    duration_minutes: parseSessionMinutes(session.time),
    focus_topic: session.focus || "General review",
    task: session.task,
    reason: session.reason || "",
    status: isSessionComplete(session) ? "completed" : "planned",
    updated_at: new Date().toISOString(),
  }));
}

function studyLogCloudRows(courseId, userId, sessionIdByClientId) {
  return getCompletedSessions().map((session) => ({
    course_id: courseId,
    user_id: userId,
    client_id: session.id,
    study_session_id: sessionIdByClientId.get(session.id) || null,
    focus_topic: session.focus || "General review",
    minutes: Number(session.minutes) || 0,
    notes: session.notes || "",
    completed_at: session.completedAt || new Date().toISOString(),
  }));
}

function topicProgressCloudRows(courseId, userId) {
  return Object.entries(state.topicProgress || {}).map(([topic, progress]) => ({
    course_id: courseId,
    user_id: userId,
    topic,
    confidence_score: Math.round(Number(progress.confidence) || 0),
    study_sessions: Number(progress.studySessions) || 0,
    quiz_attempts: Number(progress.attempts) || 0,
    quiz_misses: Number(progress.misses) || 0,
    last_reviewed_at: progress.lastReviewedAt || null,
    updated_at: new Date().toISOString(),
  }));
}

function quizAttemptCloudRows(courseId, userId) {
  return (state.quizHistory || []).map((attempt) => ({
    course_id: courseId,
    user_id: userId,
    client_id: attempt.id,
    topic: attempt.topic || "General review",
    question: attempt.question || "Quiz attempt",
    source_material_name: attempt.source || "No source",
    result: attempt.result === "hit" ? "hit" : "miss",
    confidence_after: Number(attempt.confidenceAfter) || 0,
    answered_at: attempt.answeredAt || new Date().toISOString(),
  }));
}

function materialQuestionCloudRows(courseId, userId) {
  return (state.answerHistory || []).map((entry) => ({
    course_id: courseId,
    user_id: userId,
    client_id: entry.id,
    question: entry.question,
    answer: entry.answer || "",
    grounding: entry.grounding || "Grounding: none",
    created_at: entry.askedAt || new Date().toISOString(),
  }));
}

function answerCitationCloudRows(courseId, userId, questionIdByClientId) {
  return (state.answerHistory || []).flatMap((entry) => {
    const materialQuestionId = questionIdByClientId.get(entry.id);

    if (!materialQuestionId) {
      return [];
    }

    return (entry.citations || []).map((citation, index) => ({
      course_id: courseId,
      user_id: userId,
      client_id: `${entry.id}-citation-${index}`,
      material_question_id: materialQuestionId,
      question: entry.question,
      source_material_name: citation.source || "Uploaded material",
      topic: citation.topic || "General review",
      answer_excerpt: citation.snippet || "",
      match_score: Number(citation.score) || 0,
    }));
  });
}

async function syncPlannerToCloud(options = {}) {
  const source = options?.source === "autosave" ? "autosave" : "manual";
  const client = getAuthenticatedSupabaseClient();

  if (!client) {
    return false;
  }

  if (source === "manual") {
    clearCloudAutosaveTimer();
    cloudAutosaveBlocked = false;
  }

  if (source === "autosave" && (await shouldPauseCloudAutosaveForConflict(client))) {
    return false;
  }

  setAuthStatus(source === "autosave" ? "Autosaving planner to cloud..." : "Syncing planner to cloud...");

  try {
    const userId = authSession.user.id;
    const course = await upsertCloudCourse(client);
    const courseId = course.id;

    await upsertCloudRows(client, "materials", courseId, materialCloudRows(courseId, userId));
    await upsertCloudRows(client, "deadlines", courseId, deadlineCloudRows(courseId, userId));
    const studySessions = await upsertCloudRows(
      client,
      "study_sessions",
      courseId,
      studySessionCloudRows(courseId, userId),
    );
    const sessionIdByClientId = new Map(studySessions.map((session) => [session.client_id, session.id]));

    await upsertCloudRows(client, "study_session_logs", courseId, studyLogCloudRows(courseId, userId, sessionIdByClientId));
    await syncTopicProgressRows(client, courseId, topicProgressCloudRows(courseId, userId));
    await upsertCloudRows(client, "quiz_attempts", courseId, quizAttemptCloudRows(courseId, userId));
    const materialQuestions = await upsertCloudRows(
      client,
      "material_questions",
      courseId,
      materialQuestionCloudRows(courseId, userId),
    );
    const questionIdByClientId = new Map(materialQuestions.map((question) => [question.client_id, question.id]));
    await upsertCloudRows(
      client,
      "answer_citations",
      courseId,
      answerCitationCloudRows(courseId, userId, questionIdByClientId),
    );

    markCloudSyncBaseline(course);
    setAuthStatus(
      source === "autosave"
        ? `Autosaved ${state.materials.length} materials, ${state.deadlines.length} deadlines, and ${state.schedule.length} sessions.`
        : `Synced ${state.materials.length} materials, ${state.deadlines.length} deadlines, and ${state.schedule.length} sessions.`,
    );
    return true;
  } catch (error) {
    console.error(error);
    if (cloudConflict) {
      cloudAutosaveBlocked = true;
    }
    setAuthStatus(getCloudErrorMessage(error));
    return false;
  } finally {
    renderAuthPanel();
  }
}

async function indexMaterialInCloud(material) {
  const client = getAuthenticatedSupabaseClient();

  if (!client) {
    return;
  }

  if (!material?.storagePath) {
    setAuthStatus("Upload this material to cloud storage before indexing.");
    return;
  }

  const uploadStatus = document.querySelector("#uploadStatus");
  updateMaterialIndexState(material.id, {
    status: "Queued for indexing",
    cloudStatus: "Cloud indexing queued",
    indexStatus: "queued",
    indexError: "",
    indexStartedAt: null,
  });
  saveState();
  renderMaterials();
  uploadStatus.textContent = `Preparing ${material.name} for indexing...`;

  const synced = await syncPlannerToCloud({ source: "autosave" });

  if (!synced) {
    updateMaterialIndexState(material.id, {
      status: "Indexing failed",
      cloudStatus: "Cloud indexing failed",
      indexStatus: "failed",
      indexError: "Could not sync material metadata before indexing.",
    });
    saveState();
    renderMaterials();
    uploadStatus.textContent = "Could not sync material metadata before indexing.";
    return;
  }

  updateMaterialIndexState(material.id, {
    status: "Indexing...",
    cloudStatus: "Cloud indexing in progress",
    indexStatus: "indexing",
    indexError: "",
    indexStartedAt: new Date().toISOString(),
  });
  saveState();
  renderMaterials();
  uploadStatus.textContent = `Indexing ${material.name}...`;

  try {
    const { data, error } = await client.functions.invoke("index-material", {
      body: {
        courseClientId: getActiveCloudCourseClientId(),
        materialClientId: material.id,
      },
    });

    if (error) {
      throw error;
    }

    const status = data?.status || `Indexed ${data?.chunkCount || 0} chunks`;
    const currentMaterial = state.materials.find((item) => item.id === material.id) || material;
    updateMaterialIndexState(material.id, {
      status,
      cloudStatus: status,
      indexStatus: data?.indexStatus || "indexed",
      indexError: "",
      indexAttempts: Number(data?.indexAttempts) || Number(currentMaterial.indexAttempts) || 0,
      chunkCount: Number(data?.chunkCount) || 0,
      pageCount: Number(data?.pageCount) || currentMaterial.pageCount || 0,
      indexedPages: Number(data?.indexedPages) || Number(data?.pageCount) || currentMaterial.indexedPages || 0,
      indexStartedAt: data?.indexStartedAt || currentMaterial.indexStartedAt || null,
      indexedAt: data?.indexedAt || new Date().toISOString(),
    });
    renderAll({ autosave: false });
    markCloudSyncBaseline();
    uploadStatus.textContent = `${material.name} indexed into ${data?.chunkCount || 0} searchable chunks.`;
  } catch (error) {
    console.error(error);
    const message = error?.message || "Could not index this material.";
    const currentMaterial = state.materials.find((item) => item.id === material.id) || material;
    updateMaterialIndexState(material.id, {
      status: "Indexing failed",
      cloudStatus: "Cloud indexing failed",
      indexStatus: "failed",
      indexError: message,
      indexAttempts: (Number(currentMaterial.indexAttempts) || 0) + 1,
    });
    renderAll();
    setAuthStatus(message);
    uploadStatus.textContent = "Cloud indexing failed. Check Supabase function deployment and secrets.";
    renderAuthPanel();
  }
}

function canUseCloudAnswers() {
  return Boolean(getSupabaseClient() && authSession?.user?.id);
}

function renderAnswerResult(result) {
  const sourceList = document.querySelector("#sourceList");

  document.querySelector("#answerBox").textContent = result.answer;
  document.querySelector("#answerConfidence").textContent = result.grounding;
  sourceList.innerHTML = result.citations
    .map(
      (citation) => `
        <article class="citation-card">
          <strong>${escapeHTML(citation.source)}</strong>
          <span>${escapeHTML(citation.topic)} - match ${citation.score}</span>
          <p>${escapeHTML(citation.snippet)}</p>
        </article>
      `,
    )
    .join("");
}

async function answerFromCloudMaterials(question) {
  const client = getSupabaseClient();

  if (!client || !authSession?.user?.id) {
    return null;
  }

  setAuthStatus("Searching indexed cloud materials...");
  const synced = await syncPlannerToCloud({ source: "autosave" });

  if (!synced) {
    throw new Error("Could not sync planner metadata before cloud Q&A.");
  }

  const course = await getCloudCourse(client);

  if (!course?.id) {
    throw new Error("Cloud course was not found. Sync the planner first.");
  }

  const { data, error } = await client.functions.invoke("ask-materials", {
    body: {
      courseId: course.id,
      question,
    },
  });

  if (error) {
    throw error;
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return {
    answer: data?.answer || "I could not generate a grounded answer from indexed cloud material.",
    grounding: data?.grounding || "Grounding: none",
    citations: Array.isArray(data?.citations) ? data.citations.map(normalizeAnswerCitation) : [],
  };
}

async function answerStudyQuestion() {
  const question = document.querySelector("#studyQuestion").value.trim();
  const answerButton = document.querySelector("#answerQuestion");
  const canUseCloud = canUseCloudAnswers();
  let result = null;

  if (!question) {
    renderAnswerResult(answerFromMaterials(question));
    return;
  }

  answerButton.disabled = true;
  document.querySelector("#answerBox").textContent = canUseCloud
    ? "Searching indexed cloud materials..."
    : "Searching local materials...";
  document.querySelector("#answerConfidence").textContent = canUseCloud
    ? "Grounding: cloud retrieval pending"
    : "Grounding: local retrieval pending";
  document.querySelector("#sourceList").innerHTML = "";

  try {
    result = canUseCloud ? await answerFromCloudMaterials(question) : null;

    if (result) {
      setAuthStatus("Answered from indexed cloud materials.");
    }
  } catch (error) {
    console.error(error);
    setAuthStatus(error?.message || "Cloud answer failed; using local materials.");
    result = null;
  } finally {
    answerButton.disabled = false;
  }

  if (!result) {
    result = answerFromMaterials(question);
  }

  renderAnswerResult(result);
  recordAnswerHistory(question, result);
  renderAnswerHistory();
  saveState();
  queueCloudAutosave("answer history");
}

function getCloudQuizTopic() {
  const reviewTopic = getSpacedReviewItems()[0]?.name;
  const weakTopic = buildTopics().find((topic) => topic.name !== "Upload materials")?.name;

  return reviewTopic || weakTopic || state.course.name || "General review";
}

async function generateQuizFromCloud() {
  const client = getSupabaseClient();
  const generateButton = document.querySelector("#generateCloudQuiz");
  const feedback = document.querySelector("#quizFeedback");

  if (!client || !authSession?.user?.id) {
    feedback.textContent = "Sign in and configure Supabase to generate quizzes from indexed cloud materials.";
    return;
  }

  generateButton.disabled = true;
  feedback.textContent = "Generating quiz cards from indexed cloud materials...";

  try {
    const synced = await syncPlannerToCloud({ source: "autosave" });

    if (!synced) {
      throw new Error("Cloud sync is paused. Resolve cloud state before generating quiz cards.");
    }

    const course = await getCloudCourse(client);

    if (!course?.id) {
      throw new Error("Cloud course was not found. Sync the planner first.");
    }

    const topic = getCloudQuizTopic();
    const { data, error } = await client.functions.invoke("generate-quiz", {
      body: {
        courseId: course.id,
        topic,
        count: 5,
      },
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    const quizItems = Array.isArray(data?.quizItems) ? data.quizItems.map(normalizeQuizItem) : [];

    if (!quizItems.length) {
      throw new Error("No quiz cards were generated from indexed material yet.");
    }

    mergeQuizItems(quizItems);
    quizAnswerVisible = false;
    state.questionIndex = 0;
    renderAll();
    feedback.textContent = `Generated ${quizItems.length} cloud quiz card${quizItems.length === 1 ? "" : "s"} for ${topic}.`;
  } catch (error) {
    console.error(error);
    feedback.textContent = error?.message || "Cloud quiz generation failed. Index materials first, then try again.";
  } finally {
    generateButton.disabled = false;
  }
}

async function readCourseRows(client, table, courseId, orderColumn = "created_at") {
  const { data, error } = await client.from(table).select("*").eq("course_id", courseId).order(orderColumn);

  if (error) {
    throw error;
  }

  return data || [];
}

function cloudSessionToLocal(session) {
  const scheduledDate = new Date(session.scheduled_for);
  const safeDate = Number.isNaN(scheduledDate.getTime()) ? new Date() : scheduledDate;

  return withSessionId({
    day: formatSessionDate(safeDate),
    dateKey: formatDateKey(safeDate),
    task: session.task,
    time: `${Number(session.duration_minutes) || defaultState.course.dailyMinutes} min`,
    focus: session.focus_topic || "General review",
    reason: session.reason || "Synced from cloud",
  });
}

function buildLoadedAnswerHistory(questions, citations) {
  const citationsByQuestionId = new Map();

  citations.forEach((citation) => {
    const items = citationsByQuestionId.get(citation.material_question_id) || [];
    items.push(citation);
    citationsByQuestionId.set(citation.material_question_id, items);
  });

  return questions.map((question) => ({
    id: question.client_id || question.id,
    question: question.question,
    answer: question.answer,
    grounding: question.grounding,
    askedAt: question.created_at,
    citations: (citationsByQuestionId.get(question.id) || []).map((citation) => ({
      source: citation.source_material_name || "Uploaded material",
      topic: citation.topic || "General review",
      snippet: citation.answer_excerpt || "",
      score: Number(citation.match_score) || 0,
    })),
  }));
}

async function loadPlannerFromCloud(options = {}) {
  const force = Boolean(options.force);
  const client = getAuthenticatedSupabaseClient();

  if (!client) {
    return;
  }

  clearCloudAutosaveTimer();
  setAuthStatus("Checking cloud planner...");

  try {
    const course = await getCloudCourse(client);

    if (!course) {
      setAuthStatus("No cloud planner found yet. Sync this planner first.");
      renderAuthPanel();
      return;
    }

    if (
      !force &&
      hasCloudLoadConflictRisk() &&
      !window.confirm("Loading cloud planner data will replace local planner data. Continue?")
    ) {
      setAuthStatus("Cloud load canceled. Use Sync now to save local changes first.");
      renderAuthPanel();
      return;
    }

    cloudAutosaveBlocked = false;
    clearCloudConflict();
    setAuthStatus("Loading cloud planner...");

    const courseId = course.id;
    const [
      materials,
      deadlines,
      studySessions,
      studyLogs,
      quizItems,
      topicProgressRows,
      quizAttempts,
      materialQuestions,
      answerCitations,
    ] = await Promise.all([
      readCourseRows(client, "materials", courseId),
      readCourseRows(client, "deadlines", courseId),
      readCourseRows(client, "study_sessions", courseId, "scheduled_for"),
      readCourseRows(client, "study_session_logs", courseId, "completed_at"),
      readCourseRows(client, "quiz_items", courseId),
      readCourseRows(client, "topic_progress", courseId, "topic"),
      readCourseRows(client, "quiz_attempts", courseId, "answered_at"),
      readCourseRows(client, "material_questions", courseId),
      readCourseRows(client, "answer_citations", courseId),
    ]);
    const localSchedule = studySessions.map(cloudSessionToLocal);
    const localSessionIdByDatabaseId = new Map(
      studySessions.map((session, index) => [session.id, localSchedule[index].id]),
    );
    const completedSessions = {};

    studySessions.forEach((session, index) => {
      if (session.status !== "completed") {
        return;
      }

      const localSession = localSchedule[index];
      completedSessions[localSession.id] = {
        id: localSession.id,
        task: localSession.task,
        focus: localSession.focus,
        minutes: Number(session.duration_minutes) || defaultState.course.dailyMinutes,
        completedAt: session.updated_at || session.scheduled_for,
        notes: "",
      };
    });

    studyLogs.forEach((log) => {
      const localId = localSessionIdByDatabaseId.get(log.study_session_id) || log.client_id || log.id;
      completedSessions[localId] = {
        id: localId,
        task: completedSessions[localId]?.task || "Logged study session",
        focus: log.focus_topic || completedSessions[localId]?.focus || "General review",
        minutes: Number(log.minutes) || completedSessions[localId]?.minutes || 0,
        completedAt: log.completed_at,
        notes: log.notes || "",
      };
    });

    state = normalizeState({
      course: {
        name: course.name,
        examDate: toDateInputValue(course.exam_date),
        dailyMinutes: Number(course.daily_minutes) || defaultState.course.dailyMinutes,
        preferredStartTime: String(course.preferred_start_time || defaultState.course.preferredStartTime).slice(0, 5),
        studyDays: course.study_days || defaultState.course.studyDays,
      },
      materials: materials.map((material) => ({
        id: material.client_id || material.id,
        name: material.file_name,
        type: material.file_type,
        status: material.status,
        size: Number(material.size_bytes) || 0,
        uploadedAt: material.created_at,
        text: "",
        pageCount: Number(material.page_count) || 0,
        indexedPages: Number(material.indexed_pages) || 0,
        indexStatus: material.index_status || "not_started",
        indexError: material.index_error || "",
        indexAttempts: Number(material.index_attempts) || 0,
        chunkCount: Number(material.chunk_count) || 0,
        indexStartedAt: material.index_started_at || null,
        indexedAt: material.indexed_at || null,
        topics: material.topics?.length ? material.topics : ["General review"],
        storageBucket: MATERIAL_STORAGE_BUCKET,
        storagePath: material.storage_path || "",
        cloudStatus: material.status || (material.storage_path ? "Cloud file saved" : "Local only"),
      })),
      deadlines: deadlines.map((deadline) => ({
        id: deadline.client_id || deadline.id,
        title: deadline.title,
        type: deadline.type,
        dueDate: toDateInputValue(deadline.due_date),
        topic: deadline.topic,
        completed: Boolean(deadline.completed),
        createdAt: deadline.created_at,
      })),
      suggestedDeadlines: [],
      schedule: localSchedule,
      completedSessions,
      quizItems: quizItems.map(normalizeQuizItem),
      topicProgress: Object.fromEntries(
        topicProgressRows.map((progress) => [
          progress.topic,
          {
            confidence: Number(progress.confidence_score) || 0,
            attempts: Number(progress.quiz_attempts) || 0,
            misses: Number(progress.quiz_misses) || 0,
            studySessions: Number(progress.study_sessions) || 0,
            lastReviewedAt: progress.last_reviewed_at,
          },
        ]),
      ),
      quizHistory: quizAttempts.map((attempt) => ({
        id: attempt.client_id || attempt.id,
        topic: attempt.topic,
        question: attempt.question || "Quiz attempt",
        source: attempt.source_material_name || "No source",
        result: attempt.result,
        confidenceAfter: Number(attempt.confidence_after) || 0,
        answeredAt: attempt.answered_at,
      })),
      answerHistory: buildLoadedAnswerHistory(materialQuestions, answerCitations),
      materialSearchQuery: "",
      focusSession: structuredClone(defaultState.focusSession),
      questionIndex: 0,
    });

    markCloudSyncBaseline(course);
    renderAll({ autosave: false });
    document.querySelector("#uploadStatus").textContent =
      "Loaded cloud planner metadata. Re-upload source files to restore local text search until server parsing is connected.";
    setAuthStatus(`Loaded ${state.materials.length} materials and ${state.deadlines.length} deadlines from cloud.`);
  } catch (error) {
    console.error(error);
    setAuthStatus(getCloudErrorMessage(error));
  } finally {
    renderAuthPanel();
  }
}

function makeId() {
  if (window.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "No exam date";
  }

  const date = new Date(`${dateValue}T09:00:00`);

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSessionDate(date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isValidStudyTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
}

function getPreferredStartTime() {
  return isValidStudyTime(state.course.preferredStartTime)
    ? state.course.preferredStartTime
    : defaultState.course.preferredStartTime;
}

function getStudyDays() {
  const studyDays = Array.isArray(state.course.studyDays)
    ? [...new Set(state.course.studyDays.map(Number).filter((day) => day >= 0 && day <= 6))]
    : defaultState.course.studyDays;

  return studyDays.length ? studyDays : defaultState.course.studyDays;
}

function formatStudyDays(days = getStudyDays()) {
  const displayOrder = [1, 2, 3, 4, 5, 6, 0];

  return displayOrder
    .filter((day) => days.includes(day))
    .map((day) => dayLabels[day])
    .join(", ");
}

function getStudyDateForIndex(index) {
  const studyDays = getStudyDays();
  const cursor = new Date();
  cursor.setHours(9, 0, 0, 0);
  let studySessionIndex = 0;

  for (let guard = 0; guard < 90; guard += 1) {
    if (studyDays.includes(cursor.getDay())) {
      if (studySessionIndex === index) {
        return new Date(cursor);
      }

      studySessionIndex += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  const fallback = new Date();
  fallback.setDate(fallback.getDate() + index);
  fallback.setHours(9, 0, 0, 0);

  return fallback;
}

function parseExamDate() {
  if (!state.course.examDate) {
    return null;
  }

  return new Date(`${state.course.examDate}T09:00:00`);
}

function getDaysUntilExam() {
  const examDate = parseExamDate();

  if (!examDate) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.ceil((examDate - today) / 86400000);
}

function parseDeadlineDate(dateValue) {
  if (!dateValue) {
    return null;
  }

  return new Date(`${dateValue}T23:59:00`);
}

function getDaysUntil(dateValue) {
  const dueDate = parseDeadlineDate(dateValue);

  if (!dueDate) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.ceil((dueDate - today) / 86400000);
}

function formatDueDate(dateValue) {
  const dueDate = parseDeadlineDate(dateValue);

  if (!dueDate) {
    return "No due date";
  }

  return dueDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getPlanningYear() {
  const examDate = parseExamDate();

  if (examDate) {
    return examDate.getFullYear();
  }

  return new Date().getFullYear();
}

function toDateKey(year, monthIndex, day) {
  const date = new Date(year, monthIndex, day);

  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return "";
  }

  return formatDateKey(date);
}

function parseMaterialDate(text) {
  const monthDateMatch = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i,
  );

  if (monthDateMatch) {
    const monthIndex = monthLookup[monthDateMatch[1].toLowerCase().replace(".", "")];
    const day = Number(monthDateMatch[2]);
    const year = Number(monthDateMatch[3]) || getPlanningYear();

    return toDateKey(year, monthIndex, day);
  }

  const numericDateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);

  if (numericDateMatch) {
    const monthIndex = Number(numericDateMatch[1]) - 1;
    const day = Number(numericDateMatch[2]);
    const yearPart = numericDateMatch[3];
    const year = yearPart
      ? Number(yearPart.length === 2 ? `20${yearPart}` : yearPart)
      : getPlanningYear();

    return toDateKey(year, monthIndex, day);
  }

  return "";
}

function inferDeadlineType(text) {
  const lower = text.toLowerCase();

  if (lower.includes("midterm") || lower.includes("final") || lower.includes("exam")) return "Exam";
  if (lower.includes("quiz")) return "Quiz";
  if (lower.includes("project")) return "Project";
  return "Assignment";
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function inferDeadlineTitle(text, type) {
  const titleMatch = text.match(
    /\b((?:assignment|homework|problem set|project|quiz|midterm|final|exam)(?:\s+(?:exam|quiz|project|assignment))?(?:\s*(?:#|no\.?)?\s*[a-z0-9-]+)?)\b/i,
  );

  if (titleMatch) {
    return titleCase(titleMatch[1].replace(/\s+/g, " ").trim());
  }

  return `${type} deadline`;
}

function getSuggestionKey(item) {
  return `${item.type}|${item.dueDate}|${item.title}`.toLowerCase();
}

function isDuplicateDeadlineSuggestion(suggestion, suggestions = state.suggestedDeadlines) {
  const suggestionKey = getSuggestionKey(suggestion);
  const existingDeadline = state.deadlines.some((deadline) => getSuggestionKey(deadline) === suggestionKey);
  const existingSuggestion = suggestions.some((item) => getSuggestionKey(item) === suggestionKey);

  return existingDeadline || existingSuggestion;
}

function extractDeadlineSuggestions(material) {
  if (!material.text) {
    return [];
  }

  const lines = material.text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length >= 12 && line.length <= 220)
    .filter((line) => /(assignment|homework|problem set|project|quiz|exam|midterm|final|deadline|due)/i.test(line))
    .slice(0, 80);
  const suggestions = [];

  lines.forEach((line) => {
    const dueDate = parseMaterialDate(line);

    if (!dueDate) {
      return;
    }

    const type = inferDeadlineType(line);
    const title = inferDeadlineTitle(line, type);
    const suggestion = {
      id: makeId(),
      title,
      type,
      dueDate,
      topic: inferTopics(`${line} ${material.name}`)[0],
      confidence: /\b(due|deadline|exam|quiz|final|midterm)\b/i.test(line) ? "High" : "Medium",
      excerpt: line,
      sourceMaterialId: material.id,
      sourceMaterialName: material.name,
      createdAt: new Date().toISOString(),
    };

    if (!isDuplicateDeadlineSuggestion(suggestion, [...state.suggestedDeadlines, ...suggestions])) {
      suggestions.push(suggestion);
    }
  });

  return suggestions.slice(0, 5);
}

function getOpenDeadlines() {
  return [...state.deadlines]
    .filter((deadline) => !deadline.completed)
    .sort((a, b) => {
      const aDate = parseDeadlineDate(a.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      const bDate = parseDeadlineDate(b.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;

      return aDate - bDate || a.title.localeCompare(b.title);
    });
}

function getNextDeadline() {
  return getOpenDeadlines()[0] || null;
}

function inferType(fileName) {
  const lower = fileName.toLowerCase();

  if (lower.includes("syllabus")) return "Syllabus";
  if (lower.includes("assignment") || lower.includes("homework") || lower.includes("project")) return "Assignment";
  if (lower.includes("exam") || lower.includes("midterm") || lower.includes("final") || lower.includes("quiz")) return "Exam prep";
  if (lower.includes("lecture") || lower.includes("note")) return "Notes";

  return "Material";
}

function extractExtension(fileName) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function isTextFile(fileName) {
  return ["txt", "md", "csv"].includes(extractExtension(fileName));
}

function isPdfFile(fileName) {
  return extractExtension(fileName) === "pdf";
}

function inferTopics(text) {
  const haystack = text.toLowerCase();
  const matchedTopics = topicPatterns
    .filter((topic) => topic.terms.some((term) => haystack.includes(term)))
    .map((topic) => topic.name);

  return matchedTopics.length ? matchedTopics : ["General review"];
}

function collectTopicCounts() {
  const topicCounts = new Map();

  state.materials.forEach((material) => {
    material.topics.forEach((topic) => {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    });
  });

  getOpenDeadlines().forEach((deadline) => {
    topicCounts.set(deadline.topic, (topicCounts.get(deadline.topic) || 0) + 1);
  });

  return topicCounts;
}

function getInitialConfidence(topic, count) {
  const knownTopicPenalty = topic === "General review" ? 8 : 0;

  return Math.max(35, 72 - count * 6 - knownTopicPenalty);
}

function ensureTopicProgress(topic, count = 1) {
  state.topicProgress ||= {};

  if (!state.topicProgress[topic]) {
    state.topicProgress[topic] = {
      confidence: getInitialConfidence(topic, count),
      attempts: 0,
      misses: 0,
      studySessions: 0,
      lastReviewedAt: null,
    };
  }

  state.topicProgress[topic].studySessions ||= 0;

  return state.topicProgress[topic];
}

function getTopicStats() {
  const topicCounts = collectTopicCounts();

  if (!topicCounts.size) {
    return [
      {
        name: "Upload materials",
        count: 0,
        score: 30,
        priority: "Start",
        attempts: 0,
        misses: 0,
      },
    ];
  }

  return [...topicCounts.entries()]
    .map(([name, count]) => {
      const progress = ensureTopicProgress(name, count);
      const score = Math.round(progress.confidence);

      return {
        name,
        count,
        score,
        priority: score < 48 ? "High" : score < 70 ? "Medium" : "Watch",
        attempts: progress.attempts,
        misses: progress.misses,
        studySessions: progress.studySessions || 0,
        lastReviewedAt: progress.lastReviewedAt,
      };
    })
    .sort((a, b) => a.score - b.score || b.count - a.count || a.name.localeCompare(b.name));
}

function findMaterialForTopic(topic) {
  return (
    state.materials.find((material) => material.topics.includes(topic) && material.text) ||
    state.materials.find((material) => material.topics.includes(topic)) ||
    state.materials[0]
  );
}

function getSessionId(session) {
  return `${session.day}|${session.task}|${session.focus}`;
}

function withSessionId(session) {
  return {
    ...session,
    id: getSessionId(session),
  };
}

function parseSessionMinutes(time) {
  return Number.parseInt(time, 10) || Number(state.course.dailyMinutes) || 45;
}

function getFocusSessionState() {
  state.focusSession ||= structuredClone(defaultState.focusSession);
  return state.focusSession;
}

function formatTimer(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isSessionComplete(session) {
  return Boolean(state.completedSessions?.[session.id]);
}

function completeStudySession(session, minutes = parseSessionMinutes(session.time), notes = "") {
  const progress = ensureTopicProgress(session.focus);
  const completedAt = new Date().toISOString();

  state.completedSessions[session.id] = {
    id: session.id,
    task: session.task,
    focus: session.focus,
    minutes,
    completedAt,
    notes: notes.trim(),
  };
  progress.studySessions = (progress.studySessions || 0) + 1;
  progress.confidence = Math.min(100, progress.confidence + 4);
  progress.lastReviewedAt = completedAt;
}

function reopenStudySession(session) {
  if (!state.completedSessions[session.id]) {
    return;
  }

  const progress = ensureTopicProgress(session.focus);
  delete state.completedSessions[session.id];
  progress.studySessions = Math.max(0, (progress.studySessions || 0) - 1);
  progress.confidence = Math.max(5, progress.confidence - 4);
}

function getCompletedSessions() {
  return Object.values(state.completedSessions || {});
}

function getCompletedStudyMinutes() {
  return getCompletedSessions().reduce((total, session) => total + (Number(session.minutes) || 0), 0);
}

function getDateKey(dateValue) {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatDateKey(date);
}

function getDateLabel(date) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
  });
}

function getRecentActivityTrend(dayCount = 7) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const completedSessions = getCompletedSessions();
  const quizHistory = getQuizHistory();
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (dayCount - index - 1));
    const dateKey = getDateKey(date);
    const minutes = completedSessions
      .filter((session) => getDateKey(session.completedAt) === dateKey)
      .reduce((total, session) => total + (Number(session.minutes) || 0), 0);
    const quizAttempts = quizHistory.filter((attempt) => getDateKey(attempt.answeredAt) === dateKey).length;

    return {
      dateKey,
      label: getDateLabel(date),
      minutes,
      quizAttempts,
      totalActivity: minutes + quizAttempts * 10,
    };
  });
  const maxActivity = Math.max(1, ...days.map((day) => day.totalActivity));

  return days.map((day) => ({
    ...day,
    intensity: Math.max(6, Math.round((day.totalActivity / maxActivity) * 100)),
  }));
}

function getStudyStreak() {
  const completedDates = new Set(getCompletedSessions().map((session) => getDateKey(session.completedAt)));

  if (!completedDates.size) {
    return 0;
  }

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (completedDates.has(getDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function getAverageConfidence() {
  const topics = getTopicStats().filter((topic) => topic.name !== "Upload materials");

  if (!topics.length) {
    return 0;
  }

  const total = topics.reduce((sum, topic) => sum + topic.score, 0);

  return Math.round(total / topics.length);
}

function getQuizHistory() {
  return [...(state.quizHistory || [])].sort(
    (a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime(),
  );
}

function getQuizAccuracy(history = getQuizHistory()) {
  if (!history.length) {
    return 0;
  }

  const hits = history.filter((attempt) => attempt.result === "hit").length;

  return Math.round((hits / history.length) * 100);
}

function getQuizStreak(history = getQuizHistory()) {
  let streak = 0;

  for (const attempt of history) {
    if (attempt.result !== "hit") {
      break;
    }

    streak += 1;
  }

  return streak;
}

function normalizeQuizItem(item = {}) {
  return {
    id: item.id || item.client_id || makeId(),
    topic: item.topic || "General review",
    question: item.question || "",
    answer: item.answer || "",
    source: item.source || item.source_material_name || "Indexed material",
    sourceExcerpt: item.sourceExcerpt || item.source_excerpt || "",
    materialChunkId: item.materialChunkId || item.material_chunk_id || "",
    generatedAt: item.generatedAt || item.created_at || new Date().toISOString(),
    cloudGenerated: Boolean(item.cloudGenerated || item.materialChunkId || item.material_chunk_id),
  };
}

function mergeQuizItems(incomingItems) {
  const byQuestion = new Map((state.quizItems || []).map((item) => [item.question.toLowerCase(), item]));

  incomingItems.map(normalizeQuizItem).forEach((item) => {
    if (!item.question || !item.answer) {
      return;
    }

    byQuestion.set(item.question.toLowerCase(), item);
  });

  state.quizItems = [...byQuestion.values()]
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, 40);
}

function normalizeAnswerCitation(citation = {}) {
  return {
    source: citation.source || "Uploaded material",
    topic: citation.topic || "General review",
    snippet: citation.snippet || "",
    score: Number(citation.score) || 0,
  };
}

function getAnswerHistory() {
  return [...(state.answerHistory || [])].sort(
    (a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime(),
  );
}

function recordAnswerHistory(question, result) {
  if (!question) {
    return;
  }

  const citations = Array.isArray(result.citations) ? result.citations : [];

  state.answerHistory = [
    {
      id: makeId(),
      question,
      answer: result.answer,
      grounding: result.grounding,
      citations: citations.slice(0, 3).map(normalizeAnswerCitation),
      askedAt: new Date().toISOString(),
    },
    ...(state.answerHistory || []),
  ].slice(0, 20);
}

function recordQuizAttempt(question, wasHit, confidenceAfter) {
  state.quizHistory = [
    {
      id: makeId(),
      topic: question.topic,
      question: question.question,
      source: question.source,
      result: wasHit ? "hit" : "miss",
      confidenceAfter: Math.round(confidenceAfter),
      answeredAt: new Date().toISOString(),
    },
    ...(state.quizHistory || []),
  ].slice(0, 50);
}

function getReviewIntervalDays(topic) {
  if (topic.score < 45) return 1;
  if (topic.score < 65) return 2;
  if (topic.score < 80) return 4;
  return 7;
}

function getSpacedReviewItems() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return getTopicStats()
    .filter((topic) => topic.name !== "Upload materials")
    .map((topic) => {
      const progress = ensureTopicProgress(topic.name, topic.count);
      const lastReviewed = progress.lastReviewedAt ? new Date(progress.lastReviewedAt) : null;
      const interval = getReviewIntervalDays(topic);
      const dueDate = lastReviewed ? new Date(lastReviewed) : new Date(today);
      dueDate.setHours(0, 0, 0, 0);

      if (lastReviewed) {
        dueDate.setDate(dueDate.getDate() + interval);
      }

      const daysUntilDue = Math.ceil((dueDate - today) / 86400000);
      const status = daysUntilDue <= 0 ? "Due" : daysUntilDue <= 2 ? "Soon" : "Scheduled";

      return {
        ...topic,
        interval,
        dueDate,
        daysUntilDue,
        status,
      };
    })
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.score - b.score);
}

function getReadinessLabel(score) {
  if (score >= 82) return "Ready";
  if (score >= 66) return "On track";
  if (score >= 48) return "Needs focus";
  return "At risk";
}

function getDeadlineReadiness(daysUntilDeadline) {
  if (daysUntilDeadline === null) return 45;
  if (daysUntilDeadline < 0) return 10;
  if (daysUntilDeadline <= 2) return 35;
  if (daysUntilDeadline <= 7) return 55;
  if (daysUntilDeadline <= 14) return 72;
  return 86;
}

function buildReadinessSnapshot() {
  const schedule = state.schedule.length ? state.schedule : buildSchedule();
  const topics = getTopicStats().filter((topic) => topic.name !== "Upload materials");
  const openDeadlines = getOpenDeadlines();
  const nextDeadline = openDeadlines[0] || null;
  const nextDueDays = nextDeadline ? getDaysUntil(nextDeadline.dueDate) : getDaysUntilExam();
  const completedSessions = schedule.filter(isSessionComplete).length;
  const planCompletion = schedule.length ? Math.round((completedSessions / schedule.length) * 100) : 0;
  const avgConfidence = getAverageConfidence();
  const dueReviews = getSpacedReviewItems().filter((item) => item.status !== "Scheduled");
  const weakTopics = topics.filter((topic) => topic.score < 60);
  const urgentWeakTopics = topics.filter((topic) => topic.score < 48);
  const materialScore = state.materials.length ? clamp(state.materials.length * 22, 45, 100) : 12;
  const reviewScore = clamp(100 - dueReviews.length * 16 - urgentWeakTopics.length * 8, 10, 100);
  const score = Math.round(
    clamp(
      avgConfidence * 0.38 +
        planCompletion * 0.22 +
        getDeadlineReadiness(nextDueDays) * 0.18 +
        reviewScore * 0.12 +
        materialScore * 0.1,
      0,
      100,
    ),
  );
  const readinessLabel = getReadinessLabel(score);
  const deadlineText = nextDeadline
    ? `${nextDeadline.title} due ${formatDueDate(nextDeadline.dueDate)}`
    : state.course.examDate
      ? `Exam on ${formatDueDate(state.course.examDate)}`
      : "Add a deadline";
  const recommendations = [];

  if (!state.materials.length) {
    recommendations.push("Upload a syllabus, notes, or assignment so the planner can ground quizzes and answers.");
  }

  if (!openDeadlines.length && !state.course.examDate) {
    recommendations.push("Add the next exam or assignment date to make the schedule deadline-aware.");
  }

  if (urgentWeakTopics.length) {
    recommendations.push(`Run active recall on ${urgentWeakTopics[0].name}; it is below 48% confidence.`);
  } else if (weakTopics.length) {
    recommendations.push(`Review ${weakTopics[0].name} before moving to lower-priority topics.`);
  }

  if (dueReviews.length) {
    recommendations.push(`Clear the spaced-review item for ${dueReviews[0].name}.`);
  }

  const nextSession = schedule.find((session) => !isSessionComplete(session));

  if (nextSession) {
    recommendations.push(`Start the focus timer for ${nextSession.task}.`);
  }

  if (!recommendations.length) {
    recommendations.push("Keep the plan warm with one short recall session today.");
  }

  return {
    score,
    readinessLabel,
    deadlineText,
    factors: [
      { label: "Confidence", value: `${avgConfidence}%`, detail: `${weakTopics.length} weak topic${weakTopics.length === 1 ? "" : "s"}` },
      { label: "Plan", value: `${planCompletion}%`, detail: `${completedSessions} of ${schedule.length} sessions done` },
      {
        label: "Deadline",
        value: nextDueDays === null ? "Unset" : nextDueDays < 0 ? "Past due" : `${nextDueDays}d`,
        detail: deadlineText,
      },
      {
        label: "Reviews",
        value: dueReviews.length,
        detail: dueReviews.length ? "Due or soon" : "No urgent reviews",
      },
    ],
    recommendations: recommendations.slice(0, 4),
  };
}

function formatCompletedAt(dateValue) {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function getPdfJs() {
  if (!pdfjsLoadingPromise) {
    pdfjsLoadingPromise = import(PDFJS_MODULE_URL).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjsLib;
    });
  }

  return pdfjsLoadingPromise;
}

async function extractPdfText(file) {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageLimit = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    pages.push(pageText);

    if (pages.join(" ").length >= MAX_TEXT_CHARS) {
      break;
    }
  }

  return {
    text: pages.join("\n\n").slice(0, MAX_TEXT_CHARS),
    pageCount: pdf.numPages,
    indexedPages: pageLimit,
  };
}

async function materialFromFile(file) {
  const canIndex = isTextFile(file.name);
  const canParsePdf = isPdfFile(file.name);
  let text = "";
  let pageCount = 0;
  let indexedPages = 0;
  let status = `${extractExtension(file.name).toUpperCase()} saved`;

  if (canIndex) {
    text = (await file.text()).slice(0, MAX_TEXT_CHARS);
    status = "Text indexed";
  }

  if (canParsePdf) {
    try {
      const result = await extractPdfText(file);
      text = result.text;
      pageCount = result.pageCount;
      indexedPages = result.indexedPages;
      status = text ? "PDF indexed" : "PDF saved";
    } catch (error) {
      console.warn("PDF extraction failed", error);
      status = "PDF saved";
    }
  }

  const topicSource = `${file.name} ${text}`;

  return {
    id: makeId(),
    name: file.name,
    type: inferType(file.name),
    status,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    text,
    pageCount,
    indexedPages,
    topics: inferTopics(topicSource),
  };
}

async function materialFromFileWithStorage(file) {
  const material = await materialFromFile(file);

  return uploadMaterialFileToCloud(file, material);
}

function buildSchedule() {
  const minutes = Number(state.course.dailyMinutes) || 45;
  const topics = getTopicStats();
  const openDeadlines = getOpenDeadlines();
  const sessionCount = Math.min(7, Math.max(3, topics.length + Math.min(openDeadlines.length, 3)));

  return Array.from({ length: sessionCount }, (_, index) => {
    const deadline = openDeadlines[index % Math.max(openDeadlines.length, 1)];
    const shouldPlanDeadline =
      Boolean(deadline) && (index % 2 === 0 || getDaysUntil(deadline.dueDate) <= 7 || topics.length === 1);

    if (shouldPlanDeadline) {
      const daysLeft = getDaysUntil(deadline.dueDate);
      const topicName = deadline.topic || "General review";
      const sessionDate = getStudyDateForIndex(index);
      const action = deadline.type === "Exam" || deadline.type === "Quiz" ? "Prep for" : "Make progress on";

      return withSessionId({
        day: formatSessionDate(sessionDate),
        dateKey: formatDateKey(sessionDate),
        task: `${action}: ${deadline.title}`,
        time: `${Math.max(25, minutes)} min`,
        focus: topicName,
        reason: `${deadline.type} due ${formatDueDate(deadline.dueDate)} - ${
          daysLeft < 0 ? "past due" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
        }`,
      });
    }

    const topic = topics[index % topics.length];
    const material = findMaterialForTopic(topic.name);
    const sessionDate = getStudyDateForIndex(index);
    const isFinalReview = Boolean(openDeadlines.length) && index === sessionCount - 1;
    const verb = topic.score < 48 ? "Repair weak spot" : index % 2 === 0 ? "Active recall" : "Review source";
    const task = isFinalReview
      ? `Mixed review before ${openDeadlines[0].title}`
      : `${verb}: ${topic.name}`;
    const source = material ? material.name : "uploaded materials";

    return withSessionId({
      day: formatSessionDate(sessionDate),
      dateKey: formatDateKey(sessionDate),
      task,
      time: `${Math.max(20, minutes - (index % 3) * 5)} min`,
      focus: topic.name,
      reason: `${topic.score}% confidence - ${source}`,
    });
  });
}

function getFocusCandidateSessions() {
  if (!state.schedule.length) {
    state.schedule = buildSchedule();
  }

  return state.schedule;
}

function resetFocusSessionForSession(session, keepNotes = false) {
  const focus = getFocusSessionState();

  focus.selectedSessionId = session?.id || "";
  focus.secondsRemaining = session ? parseSessionMinutes(session.time) * 60 : 0;
  focus.isRunning = false;
  focus.startedAt = null;

  if (!keepNotes) {
    focus.notes = "";
  }
}

function getCurrentFocusSession() {
  const sessions = getFocusCandidateSessions();
  const focus = getFocusSessionState();

  if (!sessions.length) {
    resetFocusSessionForSession(null);
    return null;
  }

  const incompleteSessions = sessions.filter((session) => !isSessionComplete(session));
  const selectableSessions = incompleteSessions.length ? incompleteSessions : sessions;
  const selectedSession = selectableSessions.find((session) => session.id === focus.selectedSessionId);
  const currentSession = selectedSession || selectableSessions[0];

  if (focus.selectedSessionId !== currentSession.id) {
    resetFocusSessionForSession(currentSession);
  }

  if (focus.secondsRemaining === null) {
    focus.secondsRemaining = parseSessionMinutes(currentSession.time) * 60;
  }

  return currentSession;
}

function getFocusSeconds(session) {
  if (!session) {
    return 0;
  }

  const focus = getFocusSessionState();

  if (focus.secondsRemaining === null) {
    focus.secondsRemaining = parseSessionMinutes(session.time) * 60;
  }

  return Math.max(0, Number(focus.secondsRemaining) || 0);
}

function getCompletedFocusMinutes(session) {
  const plannedSeconds = parseSessionMinutes(session.time) * 60;
  const elapsedSeconds = plannedSeconds - getFocusSeconds(session);

  if (elapsedSeconds <= 0) {
    return parseSessionMinutes(session.time);
  }

  return Math.max(1, Math.round(elapsedSeconds / 60));
}

function stopFocusTicker() {
  if (focusTimerId) {
    window.clearInterval(focusTimerId);
    focusTimerId = null;
  }
}

function syncFocusTicker() {
  stopFocusTicker();

  if (getFocusSessionState().isRunning) {
    focusTimerId = window.setInterval(tickFocusTimer, 1000);
  }
}

function tickFocusTimer() {
  const session = getCurrentFocusSession();
  const focus = getFocusSessionState();

  if (!session || !focus.isRunning) {
    stopFocusTicker();
    return;
  }

  const now = Date.now();
  const lastTick = new Date(focus.startedAt).getTime();
  const elapsedSeconds = Number.isFinite(lastTick) ? Math.max(1, Math.floor((now - lastTick) / 1000)) : 1;

  focus.secondsRemaining = Math.max(0, getFocusSeconds(session) - elapsedSeconds);
  focus.startedAt = new Date(now).toISOString();

  if (focus.secondsRemaining <= 0) {
    focus.isRunning = false;
    focus.startedAt = null;
    stopFocusTicker();
  }

  updateFocusTimerDisplay();
  saveState();
}

function startFocusTimer() {
  const session = getCurrentFocusSession();

  if (!session || isSessionComplete(session)) {
    return;
  }

  const focus = getFocusSessionState();

  if (getFocusSeconds(session) <= 0) {
    focus.secondsRemaining = parseSessionMinutes(session.time) * 60;
  }

  focus.isRunning = true;
  focus.startedAt = new Date().toISOString();
  syncFocusTicker();
  renderFocusSession();
  saveState();
}

function pauseFocusTimer() {
  const focus = getFocusSessionState();
  focus.isRunning = false;
  focus.startedAt = null;
  syncFocusTicker();
  renderFocusSession();
  saveState();
}

function resetFocusTimer() {
  const session = getCurrentFocusSession();

  if (!session) {
    return;
  }

  const focus = getFocusSessionState();
  focus.secondsRemaining = parseSessionMinutes(session.time) * 60;
  focus.isRunning = false;
  focus.startedAt = null;
  syncFocusTicker();
  renderFocusSession();
  saveState();
}

function completeFocusSession() {
  const session = getCurrentFocusSession();

  if (!session) {
    return;
  }

  const focus = getFocusSessionState();
  const minutes = getCompletedFocusMinutes(session);

  focus.isRunning = false;
  focus.startedAt = null;
  completeStudySession(session, minutes, focus.notes);

  const nextSession = getFocusCandidateSessions().find((item) => item.id !== session.id && !isSessionComplete(item));
  resetFocusSessionForSession(nextSession || session);
  syncFocusTicker();
  renderAll();
  document.querySelector("#focusStatusText").textContent = `Completed ${session.task}.`;
}

function buildTopics() {
  return getTopicStats().slice(0, 5);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function splitIntoSentences(text) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 60 && sentence.length <= 260);
}

function scoreSentence(sentence, material) {
  const lowerSentence = sentence.toLowerCase();
  const topicHits = material.topics.reduce((total, topic) => {
    const pattern = topicPatterns.find((item) => item.name === topic);
    const hits = pattern?.terms.filter((term) => lowerSentence.includes(term)).length || 0;

    return total + hits;
  }, 0);
  const studyWordHits = ["because", "therefore", "used", "preferred", "important", "requires", "compare"].filter(
    (term) => lowerSentence.includes(term),
  ).length;

  return topicHits * 3 + studyWordHits + Math.min(sentence.length / 90, 2);
}

function createQuestionFromSentence(sentence, material) {
  const topic = material.topics[0] || material.type;
  const pattern = topicPatterns.find((item) => item.name === topic);
  const lowerSentence = sentence.toLowerCase();
  const matchedTerm = pattern?.terms.find((term) => lowerSentence.includes(term));
  const prompt = matchedTerm
    ? `Explain how "${matchedTerm}" is used in this source.`
    : `What is the key idea in this passage from ${material.name}?`;

  return {
    topic,
    question: prompt,
    answer: sentence,
    source: material.name,
  };
}

function buildQuestions() {
  const cloudQuestions = (state.quizItems || []).map(normalizeQuizItem).filter((item) => item.question && item.answer);
  const sourceBackedQuestions = state.materials
    .filter((material) => material.text)
    .flatMap((material) =>
      splitIntoSentences(material.text)
        .sort((a, b) => scoreSentence(b, material) - scoreSentence(a, material))
        .slice(0, 3)
        .map((sentence) => createQuestionFromSentence(sentence, material)),
    )
    .slice(0, 12);

  if (cloudQuestions.length) {
    return [...cloudQuestions, ...sourceBackedQuestions].slice(0, 12);
  }

  if (sourceBackedQuestions.length) {
    return sourceBackedQuestions;
  }

  const materialQuestions = state.materials.slice(0, 8).map((material) => {
    const topic = material.topics[0] || material.type;
    return {
      topic,
      question: `From ${material.name}, what are the three ideas you should be able to explain without looking?`,
      answer: material.text
        ? normalizeWhitespace(material.text).slice(0, 260)
        : "This material has been saved, but it does not have searchable text yet. Use the file name and topic tags as the review anchor.",
      source: material.name,
    };
  });

  if (materialQuestions.length) {
    return materialQuestions;
  }

  return [
    {
      topic: "Materials",
      question: "Upload a syllabus or notes file to generate the first active-recall question.",
      answer: "Add course materials first. Text files and PDFs with extractable text can become source-backed quiz cards.",
      source: "No source yet",
    },
  ];
}

function getMaterialSearchTerms(query) {
  const terms = getSearchTerms(query);

  if (terms.length) {
    return terms;
  }

  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
}

function buildMaterialSearchResults(query) {
  const terms = getMaterialSearchTerms(query);

  if (!terms.length) {
    return [];
  }

  return state.materials
    .flatMap((material) => {
      const sourceText = `${material.name} ${material.type} ${material.status} ${material.topics.join(" ")}`.toLowerCase();
      const sourceScore = terms.reduce((total, term) => total + (sourceText.includes(term) ? 2 : 0), 0);
      const sourceMatch = sourceScore
        ? [
            {
              material,
              topic: material.topics[0] || material.type,
              text: `${material.type} - ${material.status} - topics: ${material.topics.join(", ")}`,
              score: sourceScore,
            },
          ]
        : [];
      const passageMatches = material.text
        ? buildPassages(material)
            .map((passage) => ({
              ...passage,
              score: scorePassage(passage, terms),
            }))
            .filter((passage) => passage.score > 0)
            .slice(0, 3)
        : [];

      return [...sourceMatch, ...passageMatches];
    })
    .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name))
    .slice(0, 6);
}

function renderMaterialSearch() {
  const panel = document.querySelector("#materialSearchPanel");
  const input = document.querySelector("#materialSearch");
  const results = document.querySelector("#materialSearchResults");
  const query = state.materialSearchQuery || "";
  const trimmedQuery = query.trim();
  const matches = buildMaterialSearchResults(trimmedQuery);

  panel.hidden = !state.materials.length;

  if (document.activeElement !== input) {
    input.value = query;
  }

  if (!state.materials.length) {
    results.innerHTML = "";
    return;
  }

  if (!trimmedQuery) {
    results.innerHTML = state.materials
      .slice(0, 3)
      .map(
        (material) => `
          <article class="material-result-card">
            <strong>${escapeHTML(material.name)}</strong>
            <span>${escapeHTML(material.status)} - ${escapeHTML(material.topics.join(", "))}</span>
          </article>
        `,
      )
      .join("");
    return;
  }

  results.innerHTML = matches.length
    ? matches
        .map(
          (match) => `
            <article class="material-result-card">
              <strong>${escapeHTML(match.material.name)}</strong>
              <span>${escapeHTML(match.topic)} - match ${match.score}</span>
              <p>${escapeHTML(match.text)}</p>
            </article>
          `,
        )
        .join("")
    : `<p class="empty-state">No matching source passages.</p>`;
}

function renderMaterials() {
  const list = document.querySelector("#fileList");
  const empty = document.querySelector("#emptyMaterials");
  empty.hidden = state.materials.length > 0;
  renderMaterialSearch();

  list.innerHTML = state.materials
    .map((item) => {
      const storageLabel = getMaterialStorageLabel(item);
      const canUseCloudFile = item.storagePath && canUseCloudStorage();
      const indexStatus = normalizeMaterialIndexStatus(item);
      const indexLabel = indexStatus === "indexed" ? "Reprocess" : indexStatus === "failed" ? "Retry" : "Index";
      const isIndexing = indexStatus === "indexing";
      const indexError = indexStatus === "failed" && item.indexError ? item.indexError : "";

      return `
        <li>
          <div>
            <strong>${escapeHTML(item.name)}</strong>
            <span>${escapeHTML(item.type)} - ${formatBytes(item.size)} - ${escapeHTML(item.topics.join(", "))}</span>
            <span class="storage-meta${indexStatus === "failed" ? " storage-meta-error" : ""}">${escapeHTML(storageLabel)}</span>
            ${indexError ? `<span class="storage-meta storage-meta-error">${escapeHTML(indexError)}</span>` : ""}
          </div>
          <div class="file-actions">
            <em>${escapeHTML(item.status)}</em>
            ${
              canUseCloudFile
                ? `
                  <button class="download-material-button" type="button" data-download-id="${escapeHTML(item.id)}">Download</button>
                  <button class="index-material-button" type="button" data-index-id="${escapeHTML(item.id)}"${isIndexing ? " disabled" : ""}>${indexLabel}</button>
                `
                : ""
            }
            <button type="button" data-remove-id="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.name)}">Remove</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderDeadlines() {
  const list = document.querySelector("#deadlineList");
  const empty = document.querySelector("#emptyDeadlines");
  const suggestionPanel = document.querySelector("#suggestionPanel");
  const suggestionList = document.querySelector("#suggestionList");
  const sortedDeadlines = [...state.deadlines].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }

    const aDate = parseDeadlineDate(a.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bDate = parseDeadlineDate(b.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;

    return aDate - bDate || a.title.localeCompare(b.title);
  });

  empty.hidden = sortedDeadlines.length > 0 || state.suggestedDeadlines.length > 0;
  suggestionPanel.hidden = !state.suggestedDeadlines.length;
  document.querySelector("#suggestionCount").textContent =
    `${state.suggestedDeadlines.length} suggestion${state.suggestedDeadlines.length === 1 ? "" : "s"}`;
  suggestionList.innerHTML = state.suggestedDeadlines
    .map(
      (suggestion) => `
        <div class="suggestion-item">
          <div>
            <strong>${escapeHTML(suggestion.title)}</strong>
            <span>${escapeHTML(suggestion.type)} - ${formatDueDate(suggestion.dueDate)} - ${escapeHTML(suggestion.topic)}</span>
            <p>${escapeHTML(suggestion.excerpt || suggestion.sourceMaterialName)}</p>
          </div>
          <div class="suggestion-actions">
            <em>${escapeHTML(suggestion.confidence)} match</em>
            <button type="button" data-accept-suggestion="${escapeHTML(suggestion.id)}">Add</button>
            <button type="button" data-dismiss-suggestion="${escapeHTML(suggestion.id)}">Dismiss</button>
          </div>
        </div>
      `,
    )
    .join("");
  list.innerHTML = sortedDeadlines
    .map((deadline) => {
      const daysLeft = getDaysUntil(deadline.dueDate);
      const dueLabel =
        daysLeft === null
          ? "No date"
          : daysLeft < 0
            ? "Past due"
            : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;

      return `
        <div class="deadline-item${deadline.completed ? " is-complete" : ""}">
          <div>
            <strong>${escapeHTML(deadline.title)}</strong>
            <span>${escapeHTML(deadline.type)} - ${formatDueDate(deadline.dueDate)} - ${escapeHTML(deadline.topic)}</span>
          </div>
          <div class="deadline-actions">
            <em>${dueLabel}</em>
            <button type="button" data-toggle-deadline="${escapeHTML(deadline.id)}">
              ${deadline.completed ? "Reopen" : "Done"}
            </button>
            <button type="button" data-remove-deadline="${escapeHTML(deadline.id)}">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderSchedule() {
  const list = document.querySelector("#scheduleList");
  state.schedule = buildSchedule();

  list.innerHTML = state.schedule
    .map(
      (item) => {
        const completed = isSessionComplete(item);

        return `
        <div class="schedule-item${completed ? " is-complete" : ""}">
          <span>${escapeHTML(item.day)}</span>
          <div>
            <strong>${escapeHTML(item.task)}</strong>
            <p>${escapeHTML(item.reason || item.focus)}</p>
          </div>
          <div class="schedule-actions">
            <em>${escapeHTML(item.time)}</em>
            <button type="button" data-session-id="${escapeHTML(item.id)}">
              ${completed ? "Reopen" : "Done"}
            </button>
          </div>
        </div>
      `;
      },
    )
    .join("");
}

function updateFocusTimerDisplay() {
  const session = getCurrentFocusSession();
  const focus = getFocusSessionState();
  const remainingSeconds = getFocusSeconds(session);
  const isComplete = session ? isSessionComplete(session) : false;

  document.querySelector("#focusTimer").textContent = formatTimer(remainingSeconds);
  document.querySelector("#focusStatus").textContent = isComplete ? "Done" : focus.isRunning ? "Running" : "Ready";
  document.querySelector("#focusStart").disabled = !session || focus.isRunning || isComplete || remainingSeconds <= 0;
  document.querySelector("#focusPause").disabled = !session || !focus.isRunning;
  document.querySelector("#focusReset").disabled = !session || isComplete;
  document.querySelector("#focusComplete").disabled = !session || isComplete;
}

function renderFocusSession() {
  const select = document.querySelector("#focusSessionSelect");
  const task = document.querySelector("#focusTask");
  const meta = document.querySelector("#focusMeta");
  const notes = document.querySelector("#focusNotes");
  const statusText = document.querySelector("#focusStatusText");
  const sessions = getFocusCandidateSessions();
  const incompleteSessions = sessions.filter((session) => !isSessionComplete(session));
  const selectableSessions = incompleteSessions.length ? incompleteSessions : sessions;
  const session = getCurrentFocusSession();
  const focus = getFocusSessionState();

  select.innerHTML = selectableSessions
    .map(
      (item) => `
        <option value="${escapeHTML(item.id)}">${escapeHTML(item.day)} - ${escapeHTML(item.task)}</option>
      `,
    )
    .join("");
  select.disabled = !selectableSessions.length || focus.isRunning;

  if (!session) {
    task.textContent = "Generate a plan";
    meta.textContent = "No session selected";
    notes.value = "";
    statusText.textContent = "";
    updateFocusTimerDisplay();
    return;
  }

  select.value = session.id;
  task.textContent = session.task;
  meta.textContent = `${session.day} - ${session.focus} - ${session.time}`;

  if (document.activeElement !== notes) {
    notes.value = focus.notes || "";
  }

  statusText.textContent = isSessionComplete(session)
    ? "Session already completed."
    : focus.isRunning
      ? "Timer running."
      : "";
  updateFocusTimerDisplay();
}

function renderTopics() {
  const list = document.querySelector("#topicList");
  const topics = buildTopics();

  list.innerHTML = topics
    .map(
      (topic) => `
        <div class="topic-item">
          <div>
            <strong>${escapeHTML(topic.name)}</strong>
            <span>${escapeHTML(topic.priority)} - ${topic.attempts} quiz - ${topic.studySessions} sessions</span>
          </div>
          <meter min="0" max="100" value="${topic.score}"></meter>
        </div>
      `,
    )
    .join("");

  document.querySelector("#weakTopicCount").textContent = topics.length;
}

function renderProgressInsights() {
  const topics = buildTopics();
  const nextTopic = topics[0];
  const spacedReviewItems = getSpacedReviewItems();
  const nextReview = spacedReviewItems.find((item) => item.status !== "Scheduled") || spacedReviewItems[0];
  const completedSessions = getCompletedSessions().sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  const reviewNext = document.querySelector("#reviewNext");
  const spacedReviewList = document.querySelector("#spacedReviewList");
  const sessionLog = document.querySelector("#sessionLog");
  const activityTrend = document.querySelector("#activityTrend");
  const trendDays = getRecentActivityTrend();

  document.querySelector("#avgConfidence").textContent = `${getAverageConfidence()}%`;
  document.querySelector("#studyStreak").textContent = getStudyStreak();
  document.querySelector("#completedSessionCount").textContent = completedSessions.length;

  activityTrend.innerHTML = `
    <div class="activity-trend-header">
      <strong>7-day activity</strong>
      <span>${trendDays.reduce((total, day) => total + day.minutes, 0)} min - ${trendDays.reduce(
        (total, day) => total + day.quizAttempts,
        0,
      )} quiz</span>
    </div>
    <div class="activity-bars">
      ${trendDays
        .map(
          (day) => `
            <div class="activity-day">
              <span>${escapeHTML(day.label)}</span>
              <div class="activity-bar" title="${day.minutes} min, ${day.quizAttempts} quiz">
                <i style="height: ${day.intensity}%"></i>
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;

  reviewNext.innerHTML = nextReview
    ? `
      <strong>${escapeHTML(nextReview.name)}</strong>
      <span>${nextReview.status} for spaced review - ${nextReview.score}% confidence</span>
    `
    : nextTopic
    ? `
      <strong>${escapeHTML(nextTopic.name)}</strong>
      <span>${escapeHTML(nextTopic.priority)} priority - ${nextTopic.score}% confidence</span>
    `
    : "<strong>Add materials</strong><span>Progress appears after study activity</span>";

  spacedReviewList.innerHTML = spacedReviewItems.length
    ? spacedReviewItems
        .slice(0, 4)
        .map(
          (item) => `
            <div class="spaced-review-item">
              <div>
                <strong>${escapeHTML(item.name)}</strong>
                <span>${item.status} - review every ${item.interval} day${item.interval === 1 ? "" : "s"}</span>
              </div>
              <button type="button" data-review-topic="${escapeHTML(item.name)}">Reviewed</button>
            </div>
          `,
        )
        .join("")
    : `<p class="empty-state">Upload materials to build a spaced-review queue.</p>`;

  sessionLog.innerHTML = completedSessions.length
    ? completedSessions
        .slice(0, 5)
        .map(
          (session) => `
            <div class="session-log-item">
              <div>
                <strong>${escapeHTML(session.task)}</strong>
                <span>${escapeHTML(session.focus)} - ${formatCompletedAt(session.completedAt)}</span>
                ${session.notes ? `<p>${escapeHTML(session.notes)}</p>` : ""}
              </div>
              <em>${Number(session.minutes) || 0} min</em>
            </div>
          `,
        )
        .join("")
    : `<p class="empty-state">No completed sessions yet.</p>`;
}

function renderReadinessInsights() {
  const snapshot = buildReadinessSnapshot();
  const meter = document.querySelector("#readinessMeter");
  const meterBar = meter.querySelector("span");

  document.querySelector("#readinessScore").textContent = `${snapshot.score}%`;
  document.querySelector("#readinessStatus").textContent = snapshot.readinessLabel;
  document.querySelector("#readinessDeadline").textContent = snapshot.deadlineText;
  meter.setAttribute("aria-valuenow", snapshot.score);
  meterBar.style.width = `${snapshot.score}%`;
  document.querySelector("#readinessFactors").innerHTML = snapshot.factors
    .map(
      (factor) => `
        <div class="readiness-factor">
          <span>${escapeHTML(factor.label)}</span>
          <strong>${escapeHTML(factor.value)}</strong>
          <em>${escapeHTML(factor.detail)}</em>
        </div>
      `,
    )
    .join("");
  document.querySelector("#readinessActions").innerHTML = snapshot.recommendations
    .map((recommendation) => `<li>${escapeHTML(recommendation)}</li>`)
    .join("");
}

function renderQuestion() {
  const questions = buildQuestions();
  state.questionIndex %= questions.length;
  const current = questions[state.questionIndex];
  const answer = document.querySelector("#quizAnswer");

  document.querySelector("#quizTopic").textContent = current.topic;
  document.querySelector("#quizQuestion").textContent = current.question;
  document.querySelector("#quizSource").textContent = `Source: ${current.source}`;
  answer.textContent = current.answer;
  answer.hidden = !quizAnswerVisible;
  document.querySelector("#showAnswer").textContent = quizAnswerVisible ? "Hide answer" : "Show answer";
  document.querySelector("#quizItemCount").textContent = questions.length;
}

function renderQuizInsights() {
  const history = getQuizHistory();

  document.querySelector("#quizAccuracy").textContent = `${getQuizAccuracy(history)}%`;
  document.querySelector("#quizAttemptCount").textContent = history.length;
  document.querySelector("#quizStreak").textContent = getQuizStreak(history);
  document.querySelector("#quizHistory").innerHTML = history.length
    ? history
        .slice(0, 5)
        .map(
          (attempt) => `
            <div class="quiz-history-item ${attempt.result === "hit" ? "is-hit" : "is-miss"}">
              <div>
                <strong>${escapeHTML(attempt.topic)}</strong>
                <span>${escapeHTML(attempt.source)} - ${formatCompletedAt(attempt.answeredAt)}</span>
                <p>${escapeHTML(attempt.question)}</p>
              </div>
              <em>${attempt.result === "hit" ? "Got it" : "Review"}</em>
            </div>
          `,
        )
        .join("")
    : `<p class="empty-state">No quiz attempts yet.</p>`;
}

function renderAnswerHistory() {
  const history = getAnswerHistory();
  const historyList = document.querySelector("#answerHistory");
  const historyCount = document.querySelector("#answerHistoryCount");

  historyCount.textContent = `${history.length} saved`;
  historyList.innerHTML = history.length
    ? history
        .slice(0, 4)
        .map((entry) => {
          const sourceNames = [
            ...new Set(entry.citations.map((citation) => citation.source).filter(Boolean)),
          ].slice(0, 2);
          const sourceLabel = sourceNames.length ? sourceNames.join(", ") : "No cited sources";
          const normalizedAnswer = normalizeWhitespace(entry.answer);
          const preview = normalizedAnswer.slice(0, 170);

          return `
            <article class="answer-history-item">
              <div>
                <strong>${escapeHTML(entry.question)}</strong>
                <span>${escapeHTML(entry.grounding)} - ${formatCompletedAt(entry.askedAt)}</span>
              </div>
              <p>${escapeHTML(preview)}${normalizedAnswer.length > 170 ? "..." : ""}</p>
              <small>${escapeHTML(sourceLabel)}</small>
            </article>
          `;
        })
        .join("")
    : `<p class="empty-state">No material questions yet.</p>`;
}

function renderCourse() {
  document.querySelector("#courseName").value = state.course.name;
  document.querySelector("#examDate").value = state.course.examDate;
  document.querySelector("#dailyMinutes").value = state.course.dailyMinutes;
  document.querySelector("#preferredStartTime").value = getPreferredStartTime();
  const selectedStudyDays = new Set(getStudyDays().map(String));
  document.querySelectorAll("[name='studyDay']").forEach((input) => {
    input.checked = selectedStudyDays.has(input.value);
  });
  const nextDeadline = getNextDeadline();

  document.querySelector("#nextExamCourse").textContent = nextDeadline?.title || state.course.name || "Course";
  document.querySelector("#nextExamDate").textContent = nextDeadline
    ? `${nextDeadline.type} - ${formatDueDate(nextDeadline.dueDate)}`
    : formatDate(state.course.examDate);
  const daysUntilExam = nextDeadline ? getDaysUntil(nextDeadline.dueDate) : getDaysUntilExam();
  document.querySelector("#examCountdown").textContent =
    daysUntilExam === null
      ? "Add a due date"
      : daysUntilExam < 0
        ? "Deadline has passed"
        : `${daysUntilExam} day${daysUntilExam === 1 ? "" : "s"} to prepare`;
}

function renderMetrics() {
  document.querySelector("#materialCount").textContent = state.materials.length;
  const completedInPlan = state.schedule.filter(isSessionComplete).length;
  document.querySelector("#todaySummary").textContent = `${completedInPlan} of ${state.schedule.length} sessions done`;
  document.querySelector("#deadlineCount").textContent = getOpenDeadlines().length;
  document.querySelector("#studyMinutes").textContent = getCompletedStudyMinutes();
  const weakestTopic = buildTopics()[0];
  document.querySelector("#planStatus").textContent =
    state.schedule.length && completedInPlan === state.schedule.length
      ? "On track"
      : weakestTopic && weakestTopic.score < 48
        ? "Needs focus"
        : "Balanced";
}

function renderAuthPanel() {
  const signedOut = document.querySelector("#authSignedOut");
  const signedIn = document.querySelector("#authSignedIn");
  const userEmail = document.querySelector("#authUserEmail");
  const signIn = document.querySelector("#signIn");
  const signUp = document.querySelector("#signUp");
  const syncCloud = document.querySelector("#syncCloud");
  const loadCloud = document.querySelector("#loadCloud");
  const courseSelect = document.querySelector("#cloudCourseSelect");
  const createCloudCourse = document.querySelector("#createCloudCourse");
  const conflictPanel = document.querySelector("#cloudConflictPanel");
  const conflictSummary = document.querySelector("#cloudConflictSummary");
  const resolveLoadCloud = document.querySelector("#resolveLoadCloud");
  const resolveKeepLocal = document.querySelector("#resolveKeepLocal");
  const resolveOverwriteCloud = document.querySelector("#resolveOverwriteCloud");
  const hasConfig = hasSupabaseConfig() && Boolean(window.supabase?.createClient);
  const signedInUser = Boolean(authSession?.user);
  const conflictVisible = signedInUser && Boolean(cloudConflict);

  signIn.disabled = !hasConfig;
  signUp.disabled = !hasConfig;
  syncCloud.disabled = !hasConfig || !signedInUser || cloudCoursesLoading;
  loadCloud.disabled = !hasConfig || !signedInUser || cloudCoursesLoading;
  courseSelect.disabled = !hasConfig || !signedInUser || cloudCoursesLoading;
  createCloudCourse.disabled = !hasConfig || !signedInUser || cloudCoursesLoading;
  resolveLoadCloud.disabled = !hasConfig || !signedInUser || cloudCoursesLoading;
  resolveKeepLocal.disabled = !hasConfig || !signedInUser || cloudCoursesLoading;
  resolveOverwriteCloud.disabled = !hasConfig || !signedInUser || cloudCoursesLoading;
  conflictPanel.hidden = !conflictVisible;

  if (conflictVisible) {
    conflictSummary.textContent =
      `${cloudConflict.courseName} changed in cloud ${formatCloudDateTime(cloudConflict.remoteUpdatedAt)}. ` +
      `Local planner has ${cloudConflict.localSummary}.`;
  } else {
    conflictSummary.textContent = "";
  }

  if (!hasConfig) {
    signedOut.hidden = false;
    signedIn.hidden = true;
    document.querySelector("#authStatus").textContent =
      authStatusMessage || "Add Supabase config to enable accounts and autosave.";
    return;
  }

  if (authSession?.user?.email) {
    signedOut.hidden = true;
    signedIn.hidden = false;
    userEmail.textContent = authSession.user.email;
    renderCloudCourseSelect();
    document.querySelector("#authStatus").textContent =
      authStatusMessage || (cloudCoursesLoading ? "Loading cloud courses..." : "Account connected. Autosave ready.");
    return;
  }

  signedOut.hidden = false;
  signedIn.hidden = true;
  document.querySelector("#authStatus").textContent = authStatusMessage || "Sign in to sync and autosave planner data.";
}

function renderAll({ autosave = true } = {}) {
  renderAuthPanel();
  renderCourse();
  renderMaterials();
  renderDeadlines();
  renderSchedule();
  renderFocusSession();
  renderTopics();
  renderProgressInsights();
  renderReadinessInsights();
  renderQuestion();
  renderQuizInsights();
  renderAnswerHistory();
  renderMetrics();
  syncFocusTicker();
  saveState();

  if (autosave) {
    queueCloudAutosave("planner update");
  }
}

async function handleAuthAction(mode) {
  const client = getSupabaseClient();

  if (!client) {
    setAuthStatus("Add Supabase config to enable accounts.");
    return;
  }

  const email = document.querySelector("#authEmail").value.trim();
  const password = document.querySelector("#authPassword").value;

  if (!email || !password) {
    setAuthStatus("Email and password are required.");
    return;
  }

  setAuthStatus(mode === "sign-up" ? "Creating account..." : "Signing in...");

  const result =
    mode === "sign-up"
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });

  if (result.error) {
    setAuthStatus(result.error.message);
    return;
  }

  clearAuthStatus();
  await refreshAuthSession();
  resetCloudSyncTracking();
  markCloudSyncBaseline();
  renderAuthPanel();
}

async function addFiles(files) {
  const incoming = [...files];

  if (!incoming.length) {
    return;
  }

  const uploadStatus = document.querySelector("#uploadStatus");
  const shouldUploadToCloud = canUseCloudStorage();

  try {
    uploadStatus.textContent = shouldUploadToCloud
      ? `Indexing and uploading ${incoming.length} file${incoming.length === 1 ? "" : "s"}...`
      : `Indexing ${incoming.length} file${incoming.length === 1 ? "" : "s"}...`;
    const newMaterials = await Promise.all(incoming.map(materialFromFileWithStorage));
    const newSuggestions = newMaterials.flatMap(extractDeadlineSuggestions);
    const cloudSavedCount = newMaterials.filter((material) => material.storagePath).length;
    const cloudFailedCount = newMaterials.filter((material) => material.cloudStatus === "Cloud upload failed").length;
    state.materials = [...newMaterials, ...state.materials];
    state.suggestedDeadlines = [...newSuggestions, ...state.suggestedDeadlines];
    uploadStatus.textContent =
      `Added ${newMaterials.length} material${newMaterials.length === 1 ? "" : "s"}.` +
      (cloudSavedCount
        ? ` Uploaded ${cloudSavedCount} file${cloudSavedCount === 1 ? "" : "s"} to cloud storage.`
        : shouldUploadToCloud
          ? " Cloud storage upload is pending setup."
          : "") +
      (cloudFailedCount
        ? ` ${cloudFailedCount} cloud upload${cloudFailedCount === 1 ? "" : "s"} failed; local indexing was kept.`
        : "") +
      (newSuggestions.length
        ? ` Found ${newSuggestions.length} deadline suggestion${newSuggestions.length === 1 ? "" : "s"}.`
        : "");
    renderAll();

    if (cloudSavedCount) {
      const synced = await syncPlannerToCloud({ source: "autosave" });

      if (synced) {
        uploadStatus.textContent += " Cloud metadata synced.";
      }
    }
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = "One or more files could not be processed. Try a smaller PDF or a text export.";
  }
}

function getSearchTerms(question) {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3 && !stopWords.has(term));
}

function buildPassages(material) {
  const sentences = splitIntoSentences(material.text);
  const chunks = sentences.length
    ? sentences.reduce((groups, sentence, index) => {
        if (index % 2 === 0) {
          groups.push(sentence);
        } else {
          groups[groups.length - 1] = `${groups[groups.length - 1]} ${sentence}`;
        }

        return groups;
      }, [])
    : normalizeWhitespace(material.text)
        .match(/.{1,360}(\s|$)/g)
        ?.map((chunk) => chunk.trim()) || [];

  return chunks
    .filter(Boolean)
    .slice(0, 24)
    .map((text, index) => ({
      material,
      text,
      index,
      topic: material.topics[0] || material.type,
    }));
}

function scorePassage(passage, terms) {
  const lowerText = passage.text.toLowerCase();
  const sourceText = `${passage.material.name} ${passage.material.topics.join(" ")}`.toLowerCase();
  const exactHits = terms.reduce((total, term) => total + (lowerText.includes(term) ? 2 : 0), 0);
  const sourceHits = terms.reduce((total, term) => total + (sourceText.includes(term) ? 1 : 0), 0);
  const topicHits = passage.material.topics.reduce((total, topic) => {
    const pattern = topicPatterns.find((item) => item.name === topic);
    const hits = pattern?.terms.filter((term) => lowerText.includes(term)).length || 0;

    return total + hits;
  }, 0);

  return exactHits + sourceHits + topicHits;
}

function findRelevantPassages(question) {
  const terms = getSearchTerms(question);

  if (!terms.length) {
    return [];
  }

  return state.materials
    .filter((material) => material.text)
    .flatMap(buildPassages)
    .map((passage) => ({
      ...passage,
      score: scorePassage(passage, terms),
    }))
    .filter((passage) => passage.score > 0)
    .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name))
    .slice(0, 4);
}

function summarizeAnswer(question, passages) {
  const strongest = passages[0];
  const sourceNames = [...new Set(passages.map((passage) => passage.material.name))];
  const topics = [...new Set(passages.flatMap((passage) => passage.material.topics))].slice(0, 3);
  const evidence = passages
    .slice(0, 2)
    .map((passage) => passage.text)
    .join(" ");
  const nextAction = topics.length
    ? `Use this to make an active-recall check on ${topics.join(", ")}.`
    : "Use this section for a short active-recall check.";

  return `Based on ${sourceNames.join(" and ")}, the best grounded answer is: ${evidence} ${nextAction} Strongest source: ${strongest.material.name}.`;
}

function getGroundingLabel(passages) {
  if (!passages.length) {
    return "Grounding: none";
  }

  const topScore = passages[0].score;
  const sourceCount = new Set(passages.map((passage) => passage.material.name)).size;

  if (topScore >= 5 && sourceCount >= 2) {
    return "Grounding: strong";
  }

  if (topScore >= 3) {
    return "Grounding: moderate";
  }

  return "Grounding: light";
}

function answerFromMaterials(question) {
  if (!question) {
    return {
      answer: "Ask a study question to get an answer grounded in indexed course materials.",
      grounding: "Grounding: none",
      citations: [],
    };
  }

  const passages = findRelevantPassages(question);

  if (passages.length) {
    return {
      answer: summarizeAnswer(question, passages),
      grounding: getGroundingLabel(passages),
      citations: passages.map((passage) => ({
        source: passage.material.name,
        topic: passage.topic,
        snippet: passage.text,
        score: passage.score,
      })),
    };
  }

  if (state.materials.length) {
    return {
      answer:
        "I saved your materials, but I could not ground this answer in indexed text. Try asking with a phrase or topic that appears in an indexed PDF or text file.",
      grounding: "Grounding: none",
      citations: state.materials.slice(0, 3).map((material) => ({
        source: material.name,
        topic: material.topics[0] || material.type,
        snippet: material.text
          ? normalizeWhitespace(material.text).slice(0, 180)
          : "This file is saved but does not have searchable extracted text.",
        score: 0,
      })),
    };
  }

  return {
    answer: "Upload course materials first, then ask a question about the indexed content.",
    grounding: "Grounding: none",
    citations: [],
  };
}

function formatReportLineItems(items, formatter, emptyText) {
  if (!items.length) {
    return [`- ${emptyText}`];
  }

  return items.map(formatter);
}

function makeReportFileName() {
  const courseSlug = (state.course.name || "study-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${courseSlug || "study-plan"}-${dateStamp}-report.md`;
}

function buildStudyReport() {
  const schedule = state.schedule.length ? state.schedule : buildSchedule();
  const openDeadlines = getOpenDeadlines();
  const suggestedDeadlines = state.suggestedDeadlines || [];
  const topics = getTopicStats().filter((topic) => topic.name !== "Upload materials");
  const spacedReviews = getSpacedReviewItems();
  const quizHistory = getQuizHistory();
  const answerHistory = getAnswerHistory();
  const completedSessions = getCompletedSessions().sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  const activityTrend = getRecentActivityTrend();
  const readiness = buildReadinessSnapshot();
  const generatedAt = new Date().toLocaleString();

  return [
    "# AI Study Planner Report",
    "",
    `Generated: ${generatedAt}`,
    `Course: ${state.course.name || "Course"}`,
    `Exam date: ${state.course.examDate || "Not set"}`,
    `Daily study target: ${state.course.dailyMinutes || 45} minutes`,
    `Preferred start time: ${getPreferredStartTime()}`,
    `Study days: ${formatStudyDays()}`,
    "",
    "## Snapshot",
    "",
    `- Materials: ${state.materials.length}`,
    `- Open deadlines: ${openDeadlines.length}`,
    `- Quiz cards: ${buildQuestions().length}`,
    `- Completed study minutes: ${getCompletedStudyMinutes()}`,
    `- Average confidence: ${getAverageConfidence()}%`,
    `- Quiz accuracy: ${getQuizAccuracy(quizHistory)}% across ${quizHistory.length} attempt(s)`,
    `- Study streak: ${getStudyStreak()} day(s)`,
    `- Readiness: ${readiness.score}% (${readiness.readinessLabel})`,
    "",
    "## 7-Day Activity",
    "",
    ...activityTrend.map((day) => `- ${day.label}: ${day.minutes} study min, ${day.quizAttempts} quiz attempt(s)`),
    "",
    "## Readiness",
    "",
    `Next deadline: ${readiness.deadlineText}`,
    "",
    ...readiness.factors.map((factor) => `- ${factor.label}: ${factor.value} - ${factor.detail}`),
    "",
    "### Next Best Moves",
    "",
    ...readiness.recommendations.map((recommendation) => `- ${recommendation}`),
    "",
    "## Current Study Plan",
    "",
    ...formatReportLineItems(
      schedule,
      (session) =>
        `- ${session.day}: ${session.task} (${session.time}) - ${session.reason || session.focus}${
          isSessionComplete(session) ? " [done]" : ""
        }`,
      "No study sessions generated yet.",
    ),
    "",
    "## Upcoming Deadlines",
    "",
    ...formatReportLineItems(
      openDeadlines,
      (deadline) =>
        `- ${deadline.title} (${deadline.type}) - due ${formatDueDate(deadline.dueDate)} - ${deadline.topic}`,
      "No open deadlines.",
    ),
    "",
    "## Suggested Deadlines",
    "",
    ...formatReportLineItems(
      suggestedDeadlines,
      (suggestion) =>
        `- ${suggestion.title} (${suggestion.type}) - ${formatDueDate(suggestion.dueDate)} - ${suggestion.topic} - ${suggestion.confidence} match from ${suggestion.sourceMaterialName}`,
      "No pending suggestions.",
    ),
    "",
    "## Weak Topics",
    "",
    ...formatReportLineItems(
      topics.slice(0, 6),
      (topic) =>
        `- ${topic.name}: ${topic.score}% confidence, ${topic.priority} priority, ${topic.attempts} quiz attempt(s), ${topic.studySessions} study session(s)`,
      "No topic progress yet.",
    ),
    "",
    "## Recent Quiz Attempts",
    "",
    ...formatReportLineItems(
      quizHistory.slice(0, 8),
      (attempt) =>
        `- ${attempt.topic}: ${attempt.result === "hit" ? "Got it" : "Needs review"} - ${attempt.source} - ${formatCompletedAt(attempt.answeredAt)}`,
      "No quiz attempts yet.",
    ),
    "",
    "## Recent Material Questions",
    "",
    ...formatReportLineItems(
      answerHistory.slice(0, 6),
      (entry) => {
        const sources = [...new Set(entry.citations.map((citation) => citation.source).filter(Boolean))].join(", ");
        return `- ${entry.question} - ${entry.grounding} - ${sources || "No citations"} - ${formatCompletedAt(entry.askedAt)}`;
      },
      "No material questions yet.",
    ),
    "",
    "## Spaced Review Queue",
    "",
    ...formatReportLineItems(
      spacedReviews.slice(0, 6),
      (item) =>
        `- ${item.name}: ${item.status}, review every ${item.interval} day(s), ${item.score}% confidence`,
      "No spaced-review items yet.",
    ),
    "",
    "## Recent Completed Sessions",
    "",
    ...formatReportLineItems(
      completedSessions.slice(0, 6),
      (session) => {
        const noteText = session.notes ? ` - note: ${session.notes}` : "";
        return `- ${session.task} - ${session.focus} - ${session.minutes} min - completed ${formatCompletedAt(session.completedAt)}${noteText}`;
      },
      "No completed sessions yet.",
    ),
    "",
    "## Materials",
    "",
    ...formatReportLineItems(
      state.materials,
      (material) =>
        `- ${material.name} - ${material.type} - ${material.status} - topics: ${material.topics.join(", ")}`,
      "No materials uploaded.",
    ),
    "",
    "_Generated locally by AI Study Planner._",
    "",
  ].join("\n");
}

function downloadStudyReport() {
  const report = buildStudyReport();
  const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = makeReportFileName();
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return link.download;
}

function makeCalendarFileName() {
  const courseSlug = (state.course.name || "study-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${courseSlug || "study-plan"}-${dateStamp}-calendar.ics`;
}

function escapeCalendarText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function formatIcsDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function formatIcsTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line) {
  const limit = 74;

  if (line.length <= limit) {
    return line;
  }

  const chunks = [];
  let cursor = line;

  while (cursor.length > limit) {
    chunks.push(cursor.slice(0, limit));
    cursor = ` ${cursor.slice(limit)}`;
  }

  chunks.push(cursor);

  return chunks.join("\r\n");
}

function getSessionStartDate(session, index) {
  const dateKey = session.dateKey || formatDateKey(new Date(Date.now() + index * 86400000));
  const start = new Date(`${dateKey}T${getPreferredStartTime()}:00`);

  if (Number.isNaN(start.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + index);
    const [hours, minutes] = getPreferredStartTime().split(":").map(Number);
    fallback.setHours(hours, minutes, 0, 0);
    return fallback;
  }

  return start;
}

function makeCalendarUid(session, index) {
  const slug = `${session.id}-${session.dateKey || index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `${slug || `study-session-${index + 1}`}@ai-study-planner.local`;
}

function buildCalendarFile() {
  const schedule = buildSchedule();
  const stamp = formatIcsTimestamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "PRODID:-//AI Study Planner//Study Schedule//EN",
    `X-WR-CALNAME:${escapeCalendarText(`${state.course.name || "Course"} Study Plan`)}`,
    `X-WR-CALDESC:${escapeCalendarText("Generated locally by AI Study Planner")}`,
  ];

  schedule.forEach((session, index) => {
    const start = getSessionStartDate(session, index);
    const end = new Date(start);
    end.setMinutes(start.getMinutes() + parseSessionMinutes(session.time));

    lines.push(
      "BEGIN:VEVENT",
      `UID:${makeCalendarUid(session, index)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcsDateTime(start)}`,
      `DTEND:${formatIcsDateTime(end)}`,
      `SUMMARY:${escapeCalendarText(session.task)}`,
      `DESCRIPTION:${escapeCalendarText(`${session.reason || session.focus}\nFocus: ${session.focus}\nDuration: ${session.time}`)}`,
      `CATEGORIES:Study,${escapeCalendarText(session.focus)}`,
      "END:VEVENT",
    );
  });

  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join("\r\n");
}

function downloadCalendarFile() {
  const calendar = buildCalendarFile();
  const blob = new Blob([calendar], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = makeCalendarFileName();
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return link.download;
}

function makeSeededDemoState() {
  const previousState = state;
  const demoState = normalizeState(structuredClone(defaultState));

  try {
    state = demoState;
    state.topicProgress = {
      "Graph traversal": {
        confidence: 58,
        attempts: 3,
        misses: 1,
        studySessions: 2,
        lastReviewedAt: "2026-09-15T18:45:00.000Z",
      },
      Assignments: {
        confidence: 66,
        attempts: 1,
        misses: 0,
        studySessions: 1,
        lastReviewedAt: "2026-09-14T20:10:00.000Z",
      },
      "Exam logistics": {
        confidence: 74,
        attempts: 0,
        misses: 0,
        studySessions: 1,
        lastReviewedAt: "2026-09-13T17:30:00.000Z",
      },
    };
    state.schedule = buildSchedule();

    const firstSession = state.schedule[0];
    const secondSession = state.schedule[1] || firstSession;

    state.completedSessions = firstSession
      ? {
          [firstSession.id]: {
            id: firstSession.id,
            task: firstSession.task,
            focus: firstSession.focus,
            minutes: parseSessionMinutes(firstSession.time),
            completedAt: "2026-09-15T19:05:00.000Z",
            notes: "Reworked BFS queue examples and marked DFS recursion questions for another pass.",
          },
        }
      : {};
    state.quizHistory = [
      {
        id: "sample-quiz-graph-hit",
        topic: "Graph traversal",
        question: 'Explain how "bfs" is used in this source.',
        source: "Lecture 7 - Graph Traversal.txt",
        result: "hit",
        confidenceAfter: 67,
        answeredAt: "2026-09-15T19:12:00.000Z",
      },
      {
        id: "sample-quiz-graph-miss",
        topic: "Graph traversal",
        question: 'Explain how "dfs" is used in this source.',
        source: "Lecture 7 - Graph Traversal.txt",
        result: "miss",
        confidenceAfter: 58,
        answeredAt: "2026-09-14T18:40:00.000Z",
      },
    ];
    state.answerHistory = [
      {
        id: "sample-answer-graph-review",
        question: "What should I review before the graph traversal quiz?",
        answer:
          "Based on Lecture 7 - Graph Traversal.txt, focus on BFS queue behavior, DFS recursion or stack order, and when each traversal is preferred.",
        grounding: "Grounding: strong",
        citations: [
          {
            source: "Lecture 7 - Graph Traversal.txt",
            topic: "Graph traversal",
            snippet:
              "BFS uses a queue and is preferred when exploring by distance from a start node. DFS uses recursion or a stack.",
            score: 6,
          },
        ],
        askedAt: "2026-09-15T19:18:00.000Z",
      },
    ];
    state.materialSearchQuery = "graph traversal";
    state.focusSession = {
      ...structuredClone(defaultState.focusSession),
      selectedSessionId: secondSession?.id || "",
      secondsRemaining: secondSession ? parseSessionMinutes(secondSession.time) * 60 : null,
      notes: "Compare queue vs stack behavior before starting.",
    };

    return normalizeState(state);
  } finally {
    state = previousState;
  }
}

function makeBackupFileName(backupState = state, label = "backup") {
  const courseSlug = ((backupState.course && backupState.course.name) || "study-planner")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${courseSlug || "study-planner"}-${dateStamp}-${label}.json`;
}

function downloadPlannerBackup(backupState = state, label = "backup") {
  const normalizedState = normalizeState(backupState);
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: "AI Study Planner",
    state: normalizedState,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = makeBackupFileName(normalizedState, label);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return link.download;
}

async function importPlannerBackup(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const importedState = parsed.state || parsed;

  state = normalizeState(importedState);
  quizAnswerVisible = false;
  renderAll();

  return parsed.exportedAt || "backup file";
}

document.querySelector("#browseFiles").addEventListener("click", () => {
  document.querySelector("#fileInput").click();
});

document.querySelector("#chooseFiles").addEventListener("click", () => {
  document.querySelector("#fileInput").click();
});

document.querySelector("#exportData").addEventListener("click", () => {
  const fileName = downloadPlannerBackup();
  document.querySelector("#uploadStatus").textContent = `Exported ${fileName}`;
});

document.querySelector("#sampleBackup").addEventListener("click", () => {
  const fileName = downloadPlannerBackup(makeSeededDemoState(), "sample-backup");
  document.querySelector("#uploadStatus").textContent = `Exported sample backup ${fileName}`;
});

document.querySelector("#importData").addEventListener("click", () => {
  document.querySelector("#backupInput").click();
});

document.querySelector("#fileInput").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});

document.querySelector("#backupInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const uploadStatus = document.querySelector("#uploadStatus");

  try {
    uploadStatus.textContent = "Importing planner backup...";
    const importedFrom = await importPlannerBackup(file);
    uploadStatus.textContent = `Imported planner backup from ${importedFrom}.`;
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = "Could not import that backup. Choose a valid AI Study Planner JSON file.";
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#dropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  event.currentTarget.classList.add("is-dragging");
});

document.querySelector("#dropZone").addEventListener("dragleave", (event) => {
  event.currentTarget.classList.remove("is-dragging");
});

document.querySelector("#dropZone").addEventListener("drop", (event) => {
  event.preventDefault();
  event.currentTarget.classList.remove("is-dragging");
  addFiles(event.dataTransfer.files);
});

document.querySelector("#dropZone").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    document.querySelector("#fileInput").click();
  }
});

document.querySelector("#fileList").addEventListener("click", async (event) => {
  const downloadButton = event.target.closest("[data-download-id]");
  const indexButton = event.target.closest("[data-index-id]");
  const removeButton = event.target.closest("[data-remove-id]");

  if (downloadButton) {
    const material = state.materials.find((item) => item.id === downloadButton.dataset.downloadId);

    if (material) {
      await downloadMaterialFromCloud(material);
    }

    return;
  }

  if (indexButton) {
    const material = state.materials.find((item) => item.id === indexButton.dataset.indexId);

    if (material) {
      await indexMaterialInCloud(material);
    }

    return;
  }

  if (!removeButton) {
    return;
  }

  const material = state.materials.find((item) => item.id === removeButton.dataset.removeId);
  const uploadStatus = document.querySelector("#uploadStatus");

  if (material?.storagePath && canUseCloudStorage()) {
    uploadStatus.textContent = "Removing cloud file...";
  }

  const storageResult = await removeMaterialFileFromCloud(material);

  state.materials = state.materials.filter((item) => item.id !== removeButton.dataset.removeId);
  state.suggestedDeadlines = state.suggestedDeadlines.filter(
    (suggestion) => suggestion.sourceMaterialId !== removeButton.dataset.removeId,
  );
  renderAll();

  if (canUseCloudStorage()) {
    await syncPlannerToCloud({ source: "autosave" });
  }

  if (storageResult === "removed") {
    uploadStatus.textContent = "Removed material and cloud file.";
  } else if (storageResult === "failed") {
    uploadStatus.textContent = "Removed local material, but the cloud file could not be deleted.";
  } else if (canUseCloudStorage()) {
    uploadStatus.textContent = "Removed material and synced cloud metadata.";
  }
});

document.querySelector("#materialSearch").addEventListener("input", (event) => {
  state.materialSearchQuery = event.target.value;
  renderMaterials();
  saveState();
});

document.querySelector("#studySetup").addEventListener("input", () => {
  const selectedStudyDays = [...document.querySelectorAll("[name='studyDay']:checked")].map((input) =>
    Number(input.value),
  );

  state.course = {
    name: document.querySelector("#courseName").value.trim() || "Course",
    examDate: document.querySelector("#examDate").value,
    dailyMinutes: Number(document.querySelector("#dailyMinutes").value) || 45,
    preferredStartTime: document.querySelector("#preferredStartTime").value || defaultState.course.preferredStartTime,
    studyDays: selectedStudyDays.length ? selectedStudyDays : defaultState.course.studyDays,
  };
  renderAll();
});

document.querySelector("#deadlineForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const titleInput = document.querySelector("#deadlineTitle");
  const typeInput = document.querySelector("#deadlineType");
  const dueDateInput = document.querySelector("#deadlineDate");
  const topicInput = document.querySelector("#deadlineTopic");
  const title = titleInput.value.trim();
  const topic = topicInput.value.trim() || inferTopics(title)[0];

  if (!title || !dueDateInput.value) {
    return;
  }

  const deadline = {
    id: makeId(),
    title,
    type: typeInput.value,
    dueDate: dueDateInput.value,
    topic,
    completed: false,
    createdAt: new Date().toISOString(),
  };

  state.deadlines = [...state.deadlines, deadline];
  state.suggestedDeadlines = state.suggestedDeadlines.filter(
    (suggestion) => getSuggestionKey(suggestion) !== getSuggestionKey(deadline),
  );

  titleInput.value = "";
  topicInput.value = "";
  renderAll();
});

document.querySelector("#deadlineList").addEventListener("click", (event) => {
  const toggleButton = event.target.closest("[data-toggle-deadline]");
  const removeButton = event.target.closest("[data-remove-deadline]");

  if (toggleButton) {
    state.deadlines = state.deadlines.map((deadline) =>
      deadline.id === toggleButton.dataset.toggleDeadline
        ? { ...deadline, completed: !deadline.completed }
        : deadline,
    );
    renderAll();
  }

  if (removeButton) {
    state.deadlines = state.deadlines.filter((deadline) => deadline.id !== removeButton.dataset.removeDeadline);
    renderAll();
  }
});

document.querySelector("#suggestionList").addEventListener("click", (event) => {
  const acceptButton = event.target.closest("[data-accept-suggestion]");
  const dismissButton = event.target.closest("[data-dismiss-suggestion]");

  if (!acceptButton && !dismissButton) {
    return;
  }

  const suggestionId = acceptButton?.dataset.acceptSuggestion || dismissButton?.dataset.dismissSuggestion;
  const suggestion = state.suggestedDeadlines.find((item) => item.id === suggestionId);

  if (!suggestion) {
    return;
  }

  if (acceptButton) {
    state.deadlines = [
      ...state.deadlines,
      {
        id: makeId(),
        title: suggestion.title,
        type: suggestion.type,
        dueDate: suggestion.dueDate,
        topic: suggestion.topic,
        completed: false,
        createdAt: new Date().toISOString(),
        sourceMaterialName: suggestion.sourceMaterialName,
      },
    ];
  }

  state.suggestedDeadlines = state.suggestedDeadlines.filter((item) => item.id !== suggestionId);
  renderAll();
});

document.querySelector("#scheduleList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");

  if (!button) {
    return;
  }

  const session = state.schedule.find((item) => item.id === button.dataset.sessionId);

  if (!session) {
    return;
  }

  if (state.completedSessions[session.id]) {
    reopenStudySession(session);
  } else {
    completeStudySession(session);
  }

  renderAll();
});

document.querySelector("#focusSessionSelect").addEventListener("change", (event) => {
  const session = getFocusCandidateSessions().find((item) => item.id === event.target.value);

  if (!session) {
    return;
  }

  resetFocusSessionForSession(session);
  renderFocusSession();
  saveState();
});

document.querySelector("#focusStart").addEventListener("click", startFocusTimer);
document.querySelector("#focusPause").addEventListener("click", pauseFocusTimer);
document.querySelector("#focusReset").addEventListener("click", resetFocusTimer);
document.querySelector("#focusComplete").addEventListener("click", completeFocusSession);

document.querySelector("#focusNotes").addEventListener("input", (event) => {
  getFocusSessionState().notes = event.target.value;
  saveState();
});

document.querySelector("#spacedReviewList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-review-topic]");

  if (!button) {
    return;
  }

  const topic = button.dataset.reviewTopic;
  const progress = ensureTopicProgress(topic);
  progress.studySessions = (progress.studySessions || 0) + 1;
  progress.confidence = Math.min(100, progress.confidence + 3);
  progress.lastReviewedAt = new Date().toISOString();

  renderAll();
});

document.querySelector("#loadDemo").addEventListener("click", () => {
  state = makeSeededDemoState();
  quizAnswerVisible = false;
  document.querySelector("#uploadStatus").textContent = "Loaded seeded demo with schedule, progress, and answer history.";
  renderAll();
});

document.querySelector("#clearMaterials").addEventListener("click", () => {
  state = {
    ...structuredClone(defaultState),
    materials: [],
    deadlines: [],
    suggestedDeadlines: [],
    schedule: [],
    topicProgress: {},
    completedSessions: {},
    quizItems: [],
    quizHistory: [],
    answerHistory: [],
    materialSearchQuery: "",
    questionIndex: 0,
  };
  quizAnswerVisible = false;
  document.querySelector("#uploadStatus").textContent = "Cleared local planner data.";
  renderAll();
});

document.querySelector("#nextQuestion").addEventListener("click", () => {
  state.questionIndex += 1;
  quizAnswerVisible = false;
  document.querySelector("#quizFeedback").textContent = "";
  renderQuestion();
  saveState();
});

document.querySelector("#generateCloudQuiz").addEventListener("click", generateQuizFromCloud);

document.querySelector("#showAnswer").addEventListener("click", () => {
  quizAnswerVisible = !quizAnswerVisible;
  renderQuestion();
});

document.querySelector(".answer-row").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quiz-result]");

  if (!button) {
    return;
  }

  const questions = buildQuestions();
  const current = questions[state.questionIndex % questions.length];
  const progress = ensureTopicProgress(current.topic);
  const wasHit = button.dataset.quizResult === "hit";

  progress.attempts += 1;
  progress.misses += wasHit ? 0 : 1;
  progress.confidence = Math.max(5, Math.min(100, progress.confidence + (wasHit ? 9 : -14)));
  progress.lastReviewedAt = new Date().toISOString();
  recordQuizAttempt(current, wasHit, progress.confidence);
  state.questionIndex += 1;
  quizAnswerVisible = false;

  renderAll();

  document.querySelector("#quizFeedback").textContent = wasHit
    ? `${current.topic} moved up to ${Math.round(progress.confidence)}% confidence.`
    : `${current.topic} dropped to ${Math.round(progress.confidence)}%, so it moved higher in the plan.`;
});

document.querySelector("#generatePlan").addEventListener("click", () => {
  state.schedule = buildSchedule();
  renderAll();
});

document.querySelector("#exportCalendar").addEventListener("click", () => {
  const fileName = downloadCalendarFile();
  document.querySelector("#exportStatus").textContent = `Exported ${fileName}`;
});

document.querySelector("#exportReport").addEventListener("click", () => {
  const fileName = downloadStudyReport();
  document.querySelector("#exportStatus").textContent = `Exported ${fileName}`;
});

document.querySelector("#signIn").addEventListener("click", () => {
  handleAuthAction("sign-in");
});

document.querySelector("#signUp").addEventListener("click", () => {
  handleAuthAction("sign-up");
});

document.querySelector("#syncCloud").addEventListener("click", syncPlannerToCloud);
document.querySelector("#loadCloud").addEventListener("click", loadPlannerFromCloud);
document.querySelector("#cloudCourseSelect").addEventListener("change", (event) => {
  handleCloudCourseSelection(event.target.value);
});
document.querySelector("#createCloudCourse").addEventListener("click", createCloudCourseFromCurrentPlanner);
document.querySelector("#resolveLoadCloud").addEventListener("click", loadCloudConflictVersion);
document.querySelector("#resolveKeepLocal").addEventListener("click", keepLocalConflictVersion);
document.querySelector("#resolveOverwriteCloud").addEventListener("click", overwriteCloudConflictVersion);

document.querySelector("#signOut").addEventListener("click", async () => {
  const client = getSupabaseClient();

  if (!client) {
    return;
  }

  const { error } = await client.auth.signOut();

  if (error) {
    setAuthStatus(error.message);
    return;
  }

  authSession = null;
  cloudCourses = [];
  clearAuthStatus();
  resetCloudSyncTracking();
  renderAuthPanel();
});

document.querySelector("#answerQuestion").addEventListener("click", answerStudyQuestion);

refreshAuthSession().then(async () => {
  setActiveCloudCourseClientId(loadStoredCloudCourseClientId());
  markCloudSyncBaseline();
  await refreshCloudCourses();
  renderAuthPanel();
});
getSupabaseClient()?.auth.onAuthStateChange(async (_event, session) => {
  const previousUserId = authSession?.user?.id || "";
  authSession = session;
  clearAuthStatus();

  if (session?.user?.id) {
    if (session.user.id !== previousUserId) {
      resetCloudSyncTracking();
      setActiveCloudCourseClientId(loadStoredCloudCourseClientId());
    }

    markCloudSyncBaseline();
    await refreshCloudCourses();
  } else {
    cloudCourses = [];
    resetCloudSyncTracking();
  }

  renderAuthPanel();
});
renderAll({ autosave: false });
