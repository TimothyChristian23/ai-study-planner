const STORAGE_KEY = "ai-study-planner-state-v1";
const MAX_TEXT_CHARS = 18000;
const MAX_PDF_PAGES = 35;
const PDFJS_VERSION = "6.3.289";
const PDFJS_MODULE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

let pdfjsLoadingPromise;
let quizAnswerVisible = false;

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
  },
  materials: sampleMaterials,
  deadlines: sampleDeadlines,
  schedule: [],
  topicProgress: {},
  completedSessions: {},
  questionIndex: 0,
};

let state = loadState();

function normalizeState(rawState = {}) {
  const merged = { ...structuredClone(defaultState), ...rawState };

  merged.course = { ...structuredClone(defaultState.course), ...(rawState.course || {}) };
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
  merged.schedule = Array.isArray(merged.schedule) ? merged.schedule.map(withSessionId) : [];
  merged.topicProgress = merged.topicProgress || {};
  merged.completedSessions = merged.completedSessions || {};
  merged.questionIndex = Number(merged.questionIndex) || 0;

  return merged;
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

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function isSessionComplete(session) {
  return Boolean(state.completedSessions?.[session.id]);
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

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

function buildSchedule() {
  const minutes = Number(state.course.dailyMinutes) || 45;
  const topics = getTopicStats();
  const openDeadlines = getOpenDeadlines();
  const sessionCount = Math.min(7, Math.max(3, topics.length + Math.min(openDeadlines.length, 3)));
  const today = new Date();

  return Array.from({ length: sessionCount }, (_, index) => {
    const deadline = openDeadlines[index % Math.max(openDeadlines.length, 1)];
    const shouldPlanDeadline =
      Boolean(deadline) && (index % 2 === 0 || getDaysUntil(deadline.dueDate) <= 7 || topics.length === 1);

    if (shouldPlanDeadline) {
      const daysLeft = getDaysUntil(deadline.dueDate);
      const topicName = deadline.topic || "General review";
      const sessionDate = new Date(today);
      sessionDate.setDate(today.getDate() + index);
      const action = deadline.type === "Exam" || deadline.type === "Quiz" ? "Prep for" : "Make progress on";

      return withSessionId({
        day: formatSessionDate(sessionDate),
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
    const sessionDate = new Date(today);
    sessionDate.setDate(today.getDate() + index);
    const isFinalReview = Boolean(openDeadlines.length) && index === sessionCount - 1;
    const verb = topic.score < 48 ? "Repair weak spot" : index % 2 === 0 ? "Active recall" : "Review source";
    const task = isFinalReview
      ? `Mixed review before ${openDeadlines[0].title}`
      : `${verb}: ${topic.name}`;
    const source = material ? material.name : "uploaded materials";

    return withSessionId({
      day: formatSessionDate(sessionDate),
      task,
      time: `${Math.max(20, minutes - (index % 3) * 5)} min`,
      focus: topic.name,
      reason: `${topic.score}% confidence - ${source}`,
    });
  });
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
  const sourceBackedQuestions = state.materials
    .filter((material) => material.text)
    .flatMap((material) =>
      splitIntoSentences(material.text)
        .sort((a, b) => scoreSentence(b, material) - scoreSentence(a, material))
        .slice(0, 3)
        .map((sentence) => createQuestionFromSentence(sentence, material)),
    )
    .slice(0, 12);

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

function renderMaterials() {
  const list = document.querySelector("#fileList");
  const empty = document.querySelector("#emptyMaterials");
  empty.hidden = state.materials.length > 0;

  list.innerHTML = state.materials
    .map(
      (item) => `
        <li>
          <div>
            <strong>${escapeHTML(item.name)}</strong>
            <span>${escapeHTML(item.type)} - ${formatBytes(item.size)} - ${escapeHTML(item.topics.join(", "))}</span>
          </div>
          <div class="file-actions">
            <em>${escapeHTML(item.status)}</em>
            <button type="button" data-remove-id="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.name)}">Remove</button>
          </div>
        </li>
      `,
    )
    .join("");
}

function renderDeadlines() {
  const list = document.querySelector("#deadlineList");
  const empty = document.querySelector("#emptyDeadlines");
  const sortedDeadlines = [...state.deadlines].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }

    const aDate = parseDeadlineDate(a.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bDate = parseDeadlineDate(b.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;

    return aDate - bDate || a.title.localeCompare(b.title);
  });

  empty.hidden = sortedDeadlines.length > 0;
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

  document.querySelector("#avgConfidence").textContent = `${getAverageConfidence()}%`;
  document.querySelector("#studyStreak").textContent = getStudyStreak();
  document.querySelector("#completedSessionCount").textContent = completedSessions.length;

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
              </div>
              <em>${Number(session.minutes) || 0} min</em>
            </div>
          `,
        )
        .join("")
    : `<p class="empty-state">No completed sessions yet.</p>`;
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

function renderCourse() {
  document.querySelector("#courseName").value = state.course.name;
  document.querySelector("#examDate").value = state.course.examDate;
  document.querySelector("#dailyMinutes").value = state.course.dailyMinutes;
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

function renderAll() {
  renderCourse();
  renderMaterials();
  renderDeadlines();
  renderSchedule();
  renderTopics();
  renderProgressInsights();
  renderQuestion();
  renderMetrics();
  saveState();
}

async function addFiles(files) {
  const incoming = [...files];

  if (!incoming.length) {
    return;
  }

  const uploadStatus = document.querySelector("#uploadStatus");

  try {
    uploadStatus.textContent = `Indexing ${incoming.length} file${incoming.length === 1 ? "" : "s"}...`;
    const newMaterials = await Promise.all(incoming.map(materialFromFile));
    state.materials = [...newMaterials, ...state.materials];
    uploadStatus.textContent = `Added ${newMaterials.length} material${newMaterials.length === 1 ? "" : "s"}.`;
    renderAll();
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
  const topics = getTopicStats().filter((topic) => topic.name !== "Upload materials");
  const spacedReviews = getSpacedReviewItems();
  const completedSessions = getCompletedSessions().sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  const generatedAt = new Date().toLocaleString();

  return [
    "# AI Study Planner Report",
    "",
    `Generated: ${generatedAt}`,
    `Course: ${state.course.name || "Course"}`,
    `Exam date: ${state.course.examDate || "Not set"}`,
    `Daily study target: ${state.course.dailyMinutes || 45} minutes`,
    "",
    "## Snapshot",
    "",
    `- Materials: ${state.materials.length}`,
    `- Open deadlines: ${openDeadlines.length}`,
    `- Quiz cards: ${buildQuestions().length}`,
    `- Completed study minutes: ${getCompletedStudyMinutes()}`,
    `- Average confidence: ${getAverageConfidence()}%`,
    `- Study streak: ${getStudyStreak()} day(s)`,
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
    "## Weak Topics",
    "",
    ...formatReportLineItems(
      topics.slice(0, 6),
      (topic) =>
        `- ${topic.name}: ${topic.score}% confidence, ${topic.priority} priority, ${topic.attempts} quiz attempt(s), ${topic.studySessions} study session(s)`,
      "No topic progress yet.",
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
      (session) =>
        `- ${session.task} - ${session.focus} - ${session.minutes} min - completed ${formatCompletedAt(session.completedAt)}`,
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

function makeBackupFileName() {
  const courseSlug = (state.course.name || "study-planner")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${courseSlug || "study-planner"}-${dateStamp}-backup.json`;
}

function downloadPlannerBackup() {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: "AI Study Planner",
    state: normalizeState(state),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = makeBackupFileName();
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

document.querySelector("#fileList").addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-id]");

  if (!removeButton) {
    return;
  }

  state.materials = state.materials.filter((material) => material.id !== removeButton.dataset.removeId);
  renderAll();
});

document.querySelector("#studySetup").addEventListener("input", () => {
  state.course = {
    name: document.querySelector("#courseName").value.trim() || "Course",
    examDate: document.querySelector("#examDate").value,
    dailyMinutes: Number(document.querySelector("#dailyMinutes").value) || 45,
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

  state.deadlines = [
    ...state.deadlines,
    {
      id: makeId(),
      title,
      type: typeInput.value,
      dueDate: dueDateInput.value,
      topic,
      completed: false,
      createdAt: new Date().toISOString(),
    },
  ];

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

document.querySelector("#scheduleList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");

  if (!button) {
    return;
  }

  const session = state.schedule.find((item) => item.id === button.dataset.sessionId);

  if (!session) {
    return;
  }

  const progress = ensureTopicProgress(session.focus);

  if (state.completedSessions[session.id]) {
    delete state.completedSessions[session.id];
    progress.studySessions = Math.max(0, (progress.studySessions || 0) - 1);
    progress.confidence = Math.max(5, progress.confidence - 4);
  } else {
    state.completedSessions[session.id] = {
      id: session.id,
      task: session.task,
      focus: session.focus,
      minutes: parseSessionMinutes(session.time),
      completedAt: new Date().toISOString(),
    };
    progress.studySessions = (progress.studySessions || 0) + 1;
    progress.confidence = Math.min(100, progress.confidence + 4);
    progress.lastReviewedAt = new Date().toISOString();
  }

  renderAll();
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
  state = normalizeState(structuredClone(defaultState));
  quizAnswerVisible = false;
  document.querySelector("#uploadStatus").textContent = "Loaded seeded demo data.";
  renderAll();
});

document.querySelector("#clearMaterials").addEventListener("click", () => {
  state = {
    ...structuredClone(defaultState),
    materials: [],
    deadlines: [],
    schedule: [],
    topicProgress: {},
    completedSessions: {},
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

document.querySelector("#exportReport").addEventListener("click", () => {
  const fileName = downloadStudyReport();
  document.querySelector("#exportStatus").textContent = `Exported ${fileName}`;
});

document.querySelector("#answerQuestion").addEventListener("click", () => {
  const question = document.querySelector("#studyQuestion").value.trim();
  const result = answerFromMaterials(question);
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
});

renderAll();
