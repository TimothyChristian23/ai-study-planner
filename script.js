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

const defaultState = {
  course: {
    name: "Data Structures",
    examDate: "2026-10-18",
    dailyMinutes: 45,
  },
  materials: sampleMaterials,
  schedule: [],
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
  const materials = state.materials.length ? state.materials : sampleMaterials;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return materials.slice(0, 5).map((material, index) => {
    const topic = material.topics[0] || material.type;
    const verb = material.text ? "Review indexed notes from" : "Preview and tag";

    return {
      day: days[index % days.length],
      task: `${verb} ${material.name}`,
      time: `${Math.max(20, minutes - index * 5)} min`,
      focus: topic,
    };
  });
}

function buildTopics() {
  const topicCounts = new Map();

  state.materials.forEach((material) => {
    material.topics.forEach((topic) => {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    });
  });

  if (!topicCounts.size) {
    return [{ name: "Upload materials", score: 30, priority: "Start" }];
  }

  return [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count], index) => {
      const score = Math.max(34, 78 - count * 8 - index * 7);

      return {
        name,
        score,
        priority: score < 50 ? "High" : score < 68 ? "Medium" : "Watch",
      };
    });
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
            <span>${escapeHTML(item.type)} · ${formatBytes(item.size)} · ${escapeHTML(item.topics.join(", "))}</span>
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
            <p>${escapeHTML(item.focus)}</p>
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
            <span>${escapeHTML(topic.priority)}</span>
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
  document.querySelector("#nextExamCourse").textContent = state.course.name || "Course";
  document.querySelector("#nextExamDate").textContent = formatDate(state.course.examDate);
}

function renderMetrics() {
  document.querySelector("#materialCount").textContent = state.materials.length;
  document.querySelector("#todaySummary").textContent = `${Math.min(3, Math.max(1, state.schedule.length))} focused sessions`;
}

function renderAll() {
  renderCourse();
  renderMaterials();
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

document.querySelector("#clearMaterials").addEventListener("click", () => {
  state = {
    ...structuredClone(defaultState),
    materials: [],
  };
  renderAll();
});

document.querySelector("#nextQuestion").addEventListener("click", () => {
  state.questionIndex += 1;
  renderQuestion();
  saveState();
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
