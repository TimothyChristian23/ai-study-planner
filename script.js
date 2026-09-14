const materials = [
  { name: "CS 241 Syllabus.pdf", type: "Syllabus", status: "Parsed" },
  { name: "Lecture 7 - Graph Traversal.pdf", type: "Notes", status: "Indexed" },
  { name: "Assignment 3 Brief.pdf", type: "Assignment", status: "Due soon" },
];

const schedule = [
  { day: "Mon", task: "Review BFS and DFS notes", time: "45 min", focus: "Graphs" },
  { day: "Wed", task: "Practice recurrence relations", time: "30 min", focus: "Algorithms" },
  { day: "Fri", task: "Quiz missed flashcards", time: "25 min", focus: "Weak topics" },
  { day: "Sun", task: "Mock exam review block", time: "60 min", focus: "Exam prep" },
];

const topics = [
  { name: "Graph traversal", score: 42, priority: "High" },
  { name: "Recurrence relations", score: 58, priority: "Medium" },
  { name: "Hash collisions", score: 64, priority: "Medium" },
  { name: "Tree rotations", score: 71, priority: "Watch" },
];

const questions = [
  {
    topic: "Graph traversal",
    question: "When would BFS be preferred over DFS for a shortest-path style problem?",
  },
  {
    topic: "Recurrence relations",
    question: "How does the Master Theorem classify T(n) = 2T(n / 2) + n?",
  },
  {
    topic: "Hash tables",
    question: "What tradeoff does separate chaining make when collisions increase?",
  },
];

let questionIndex = 0;

function renderMaterials() {
  const list = document.querySelector("#fileList");
  list.innerHTML = materials
    .map(
      (item) => `
        <li>
          <div>
            <strong>${item.name}</strong>
            <span>${item.type}</span>
          </div>
          <em>${item.status}</em>
        </li>
      `,
    )
    .join("");
}

function renderSchedule() {
  const list = document.querySelector("#scheduleList");
  list.innerHTML = schedule
    .map(
      (item) => `
        <div class="schedule-item">
          <span>${item.day}</span>
          <div>
            <strong>${item.task}</strong>
            <p>${item.focus}</p>
          </div>
          <em>${item.time}</em>
        </div>
      `,
    )
    .join("");
}

function renderTopics() {
  const list = document.querySelector("#topicList");
  list.innerHTML = topics
    .map(
      (topic) => `
        <div class="topic-item">
          <div>
            <strong>${topic.name}</strong>
            <span>${topic.priority}</span>
          </div>
          <meter min="0" max="100" value="${topic.score}"></meter>
        </div>
      `,
    )
    .join("");
}

function renderQuestion() {
  const current = questions[questionIndex];
  document.querySelector("#quizTopic").textContent = current.topic;
  document.querySelector("#quizQuestion").textContent = current.question;
}

document.querySelector("#addMaterial").addEventListener("click", () => {
  materials.push({
    name: "Midterm Study Guide.pdf",
    type: "Study guide",
    status: "Queued",
  });
  renderMaterials();
});

document.querySelector("#nextQuestion").addEventListener("click", () => {
  questionIndex = (questionIndex + 1) % questions.length;
  renderQuestion();
});

document.querySelector("#generatePlan").addEventListener("click", () => {
  schedule.unshift({
    day: "Tue",
    task: "Target graph traversal mistakes",
    time: "35 min",
    focus: "Adaptive review",
  });
  renderSchedule();
});

document.querySelector("#answerQuestion").addEventListener("click", () => {
  const question = document.querySelector("#studyQuestion").value.trim();
  const answerBox = document.querySelector("#answerBox");

  answerBox.textContent = question
    ? "Suggested review: focus on the passages tagged Graph traversal, then complete two active-recall questions before moving to the next topic. Sources: Lecture 7 notes, Assignment 3 brief."
    : "Ask a study question to get an answer grounded in uploaded course materials.";
});

renderMaterials();
renderSchedule();
renderTopics();
renderQuestion();
