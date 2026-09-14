const STORAGE_KEY = "ai-study-planner-state-v1";
const MAX_TEXT_CHARS = 18000;
const MAX_PDF_PAGES = 35;
const PDFJS_VERSION = "6.3.289";
const PDFJS_MODULE_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

let pdfjsLoadingPromise;

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
  questionIndex: 0,
};

let state = loadState();

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return structuredClone(defaultState);
  }

  try {
    const parsed = JSON.parse(stored);
    const merged = { ...structuredClone(defaultState), ...parsed };

    merged.materials = merged.materials.map((material) => ({
      ...material,
      topics: material.topics?.length ? material.topics : inferTopics(`${material.name} ${material.text || ""}`),
      text: material.text || "",
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
    merged.topicProgress = merged.topicProgress || {};

    return merged;
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
      lastReviewedAt: null,
    };
  }

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

      return {
        day: formatSessionDate(sessionDate),
        task: `${action}: ${deadline.title}`,
        time: `${Math.max(25, minutes)} min`,
        focus: topicName,
        reason: `${deadline.type} due ${formatDueDate(deadline.dueDate)} - ${
          daysLeft < 0 ? "past due" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
        }`,
      };
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

    return {
      day: formatSessionDate(sessionDate),
      task,
      time: `${Math.max(20, minutes - (index % 3) * 5)} min`,
      focus: topic.name,
      reason: `${topic.score}% confidence - ${source}`,
    };
  });
}

function buildTopics() {
  return getTopicStats().slice(0, 5);
}

function buildQuestions() {
  const questions = state.materials.slice(0, 8).map((material) => {
    const topic = material.topics[0] || material.type;

    return {
      topic,
      question: `From ${material.name}, what are the three ideas you should be able to explain without looking?`,
    };
  });

  if (questions.length) {
    return questions;
  }

  return [
    {
      topic: "Materials",
      question: "Upload a syllabus or notes file to generate the first active-recall question.",
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
      (item) => `
        <div class="schedule-item">
          <span>${escapeHTML(item.day)}</span>
          <div>
            <strong>${escapeHTML(item.task)}</strong>
            <p>${escapeHTML(item.reason || item.focus)}</p>
          </div>
          <em>${escapeHTML(item.time)}</em>
        </div>
      `,
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
            <span>${escapeHTML(topic.priority)} - ${topic.attempts} attempts</span>
          </div>
          <meter min="0" max="100" value="${topic.score}"></meter>
        </div>
      `,
    )
    .join("");

  document.querySelector("#weakTopicCount").textContent = topics.length;
}

function renderQuestion() {
  const questions = buildQuestions();
  state.questionIndex %= questions.length;
  const current = questions[state.questionIndex];

  document.querySelector("#quizTopic").textContent = current.topic;
  document.querySelector("#quizQuestion").textContent = current.question;
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
  document.querySelector("#todaySummary").textContent = `${Math.min(3, Math.max(1, state.schedule.length))} focused sessions`;
  document.querySelector("#deadlineCount").textContent = getOpenDeadlines().length;
  const weakestTopic = buildTopics()[0];
  document.querySelector("#planStatus").textContent =
    weakestTopic && weakestTopic.score < 48 ? "Needs focus" : "Balanced";
}

function renderAll() {
  renderCourse();
  renderMaterials();
  renderDeadlines();
  renderSchedule();
  renderTopics();
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

function answerFromMaterials(question) {
  if (!question) {
    return {
      answer: "Ask a study question to get an answer grounded in indexed course materials.",
      sources: [],
    };
  }

  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3);

  const matches = state.materials
    .filter((material) => material.text)
    .map((material) => {
      const lowerText = material.text.toLowerCase();
      const score = terms.reduce((total, term) => total + (lowerText.includes(term) ? 1 : 0), 0);

      return { material, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length) {
    const best = matches[0].material;
    const lowerText = best.text.toLowerCase();
    const firstTerm = terms.find((term) => lowerText.includes(term)) || "";
    const index = Math.max(0, lowerText.indexOf(firstTerm));
    const snippet = best.text.slice(Math.max(0, index - 80), index + 220).trim();

    return {
      answer: `I found a relevant section in ${best.name}. Start there, then turn the section into active-recall questions: ${snippet}`,
      sources: matches.slice(0, 3).map((match) => match.material.name),
    };
  }

  if (state.materials.length) {
    return {
      answer:
        "I saved your materials, but I could not find indexed text that matches the question yet. Try asking about a phrase from a PDF/text file that has been indexed.",
      sources: state.materials.slice(0, 3).map((material) => material.name),
    };
  }

  return {
    answer: "Upload course materials first, then ask a question about the indexed content.",
    sources: [],
  };
}

document.querySelector("#browseFiles").addEventListener("click", () => {
  document.querySelector("#fileInput").click();
});

document.querySelector("#chooseFiles").addEventListener("click", () => {
  document.querySelector("#fileInput").click();
});

document.querySelector("#fileInput").addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
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

document.querySelector("#clearMaterials").addEventListener("click", () => {
  state = {
    ...structuredClone(defaultState),
    materials: [],
    deadlines: [],
    topicProgress: {},
  };
  renderAll();
});

document.querySelector("#nextQuestion").addEventListener("click", () => {
  state.questionIndex += 1;
  renderQuestion();
  saveState();
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

  document.querySelector("#quizFeedback").textContent = wasHit
    ? `${current.topic} moved up to ${Math.round(progress.confidence)}% confidence.`
    : `${current.topic} dropped to ${Math.round(progress.confidence)}%, so it moved higher in the plan.`;

  renderAll();
});

document.querySelector("#generatePlan").addEventListener("click", () => {
  state.schedule = buildSchedule();
  renderAll();
});

document.querySelector("#answerQuestion").addEventListener("click", () => {
  const question = document.querySelector("#studyQuestion").value.trim();
  const result = answerFromMaterials(question);
  const sourceList = document.querySelector("#sourceList");

  document.querySelector("#answerBox").textContent = result.answer;
  sourceList.innerHTML = result.sources
    .map((source) => `<span>${escapeHTML(source)}</span>`)
    .join("");
});

renderAll();
