const $ = (id) => document.getElementById(id);

// ====== 設定 ======
const PUBLISHED_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSvJwQsQYJXks0k6hBCP-pMlAZVXFlAnCRuX6q3KxKW5k0aZ0dHY1S3M8Myx1jy4AwdpVPRkLBhsIjM";

const MAX_QUESTIONS = 25;

const CATEGORIES = [
  { key: "eiken4", title: "英検4級", gid: "1582643347", enabled: true },
  { key: "eiken3", title: "英検3級", gid: "174274981", enabled: true },
  { key: "eiken2-", title: "英検準2級", gid: "1090561184", enabled: true },
  { key: "rails", title: "Rails", gid: "1983224616", enabled: false },
];
// ===================

function publishedTsvUrl(gid) {
  return `${PUBLISHED_BASE}/pub?output=tsv&gid=${gid}`;
}

// DOM
const appHeaderEl = $("appHeader");

const topEl = $("top");
const quizEl = $("quiz");
const resultEl = $("result");

const categoryListEl = $("categoryList");
const topMessageEl = $("topMessage");

const statusHintEl = $("statusHint");

const toTopBtn = $("toTopBtn");
const toTopBtn2 = $("toTopBtn2");

const categoryTitleEl = $("categoryTitle");
const qNoEl = $("qNo");

const qTextEl = $("qText");
const choicesEl = $("choices");
const feedbackEl = $("feedback");
const navEl = $("nav");

const prevBtn = $("prevBtn");
const nextBtn = $("nextBtn");
const nextWrongBtn = $("nextWrongBtn");

const summaryEl = $("summary");
const reviewEl = $("review");
const restartBtn = $("restartBtn");

// Screen
function showScreen(which) {
  topEl.hidden = which !== "top";
  quizEl.hidden = which !== "quiz";
  resultEl.hidden = which !== "result";
  if (appHeaderEl) appHeaderEl.hidden = (which === "top");
}

// Utils
function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanCell(v) {
  return (v ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^[\s　]+|[\s　]+$/g, "");
}

function parseTSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const header = lines.shift().split("\t").map((h) => cleanCell(h));
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { idx, lines };
}

function normalizeAnswer(v) {
  if (v == null) return NaN;
  let s = String(v);

  // 全角→半角
  s = s.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );

  s = cleanCell(s);
  s = s.replace(/^"(.*)"$/, "$1").trim();

  const m = s.match(/[1-4]/);
  return m ? Number(m[0]) : NaN;
}

function parseQuestionsTSV(text) {
  const { idx, lines } = parseTSV(text);
  const required = [
    "id",
    "category",
    "question",
    "choice1",
    "choice2",
    "choice3",
    "choice4",
    "answer",
    "explanation",
  ];

  for (const k of required) {
    if (!(k in idx)) throw new Error(`問題シートのヘッダーに "${k}" がありません`);
  }

  return lines.map((line, lineNo) => {
    const cols = line.split("\t");

    const ans = normalizeAnswer(cols[idx.answer]);
    if (![1, 2, 3, 4].includes(ans)) {
      throw new Error(
        `answer は 1〜4（行: ${lineNo + 2} / raw=${JSON.stringify(cols[idx.answer])}）`
      );
    }

    return {
      id: cleanCell(cols[idx.id]) || `row-${lineNo + 2}`,
      category: cleanCell(cols[idx.category]),
      question: cleanCell(cols[idx.question]),
      choices: [
        cleanCell(cols[idx.choice1]),
        cleanCell(cols[idx.choice2]),
        cleanCell(cols[idx.choice3]),
        cleanCell(cols[idx.choice4]),
      ],
      answer: ans,
      explanation: cleanCell(cols[idx.explanation]),
    };
  });
}

async function fetchQuestionsByGid(gid) {
  const url = publishedTsvUrl(gid);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`取得失敗: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return parseQuestionsTSV(text);
}

// ====== Stats (per-device) ======
function statsKey(categoryKey) {
  return `stats:${categoryKey}`;
}

function loadStats(categoryKey) {
  try {
    return JSON.parse(localStorage.getItem(statsKey(categoryKey))) || {};
  } catch {
    return {};
  }
}

function saveStats(categoryKey, stats) {
  localStorage.setItem(statsKey(categoryKey), JSON.stringify(stats));
}

function updateStats(categoryKey, qId, isCorrect) {
  const stats = loadStats(categoryKey);
  const s = stats[qId] || { attempts: 0, correct: 0 };
  s.attempts += 1;
  if (isCorrect) s.correct += 1;
  stats[qId] = s;
  saveStats(categoryKey, stats);
}

// 苦手ほど出やすい（重み付き・重複なし抽選）
function pickWeightedUnique(questions, stats, k, gamma = 2.0, eps = 0.05) {
  const pool = questions.map((q) => {
    const s = stats[q.id] || { attempts: 0, correct: 0 };
    let w;
    if (s.attempts === 0) {
      w = 1.5; // 未出題を少し優先
    } else {
      const p = s.correct / s.attempts; // 正答率
      w = Math.pow(1 - p, gamma) + eps;
    }
    return { q, w };
  });

  const picked = [];
  const n = Math.min(k, pool.length);

  for (let t = 0; t < n; t++) {
    const total = pool.reduce((sum, x) => sum + x.w, 0);
    let r = Math.random() * total;

    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    const [item] = pool.splice(Math.min(idx, pool.length - 1), 1);
    picked.push(item.q);
  }

  return picked;
}

// ====== State ======
let currentCat = null;
let deck = [];
let i = 0;
// answers[idx] = { choiceIndex(1..4), isCorrect(bool) }
let answers = [];

function ensureShuffledChoices(q) {
  if (!q._shuffled) {
    const pairs = q.choices.map((t, idx) => ({ t, idx: idx + 1 }));
    q._shuffled = shuffle(pairs);
  }
}

function buildNav() {
  navEl.innerHTML = "";
  deck.forEach((_, idx) => {
    const b = document.createElement("button");
    b.className = "navbtn";
    b.type = "button";
    b.textContent = String(idx + 1);
    b.addEventListener("click", () => {
      i = idx;
      render();
    });
    navEl.appendChild(b);
  });
}

function updateNavState() {
  const buttons = [...navEl.querySelectorAll("button")];
  buttons.forEach((b, idx) => {
    b.classList.toggle("current", idx === i);
    b.classList.toggle("answered", answers[idx] != null);

    const a = answers[idx];
    const wrong = a && !a.isCorrect;
    b.classList.toggle("wrong", !!wrong);
  });
}

function scoreNow() {
  return answers.filter((a) => a && a.isCorrect).length;
}

function updateStatus() {
  if (!deck.length) {
    statusHintEl.textContent = "";
    if (nextWrongBtn) nextWrongBtn.disabled = true;
    return;
  }

  const correct = answers.filter((a) => a && a.isCorrect).length;
  const wrong = answers.filter((a) => a && !a.isCorrect).length;
  const unanswered = answers.filter((a) => a == null).length;

  statusHintEl.textContent = `正解:${correct} | 未回答:${unanswered} | 不正解:${wrong}`;

  if (nextWrongBtn) {
    nextWrongBtn.disabled = (wrong === 0);
  }
}

function setFeedbackForCurrent() {
  const q = deck[i];
  const a = answers[i];

  if (!a) {
    feedbackEl.innerHTML = "";
    feedbackEl.classList.remove("is-open");
    nextBtn.disabled = true;
    nextBtn.textContent = "次へ";
    return;
  }

  const ok = a.isCorrect;
  const ansText = q.choices[q.answer - 1];
  const exp = q.explanation ? q.explanation : "（解説なし）";

  feedbackEl.innerHTML = `
    <div class="fbResult">${ok ? "✅ 正解" : "❌ 不正解"}</div>
    <div class="fbAnswer">正解：${ansText}</div>
    <div class="hint">解説：${exp}</div>
  `;

  feedbackEl.classList.add("is-open");

  nextBtn.disabled = false;
  nextBtn.textContent = (i === deck.length - 1) ? "結果へ" : "次へ";
}

function formatQuestion(text) {
  let s = String(text || "");

  // 話者ラベル（A: / B: / Woman 1: / Wife: 等）を見やすく改行
  s = s.replace(
    /(^| )((?:[A-Z][a-z]+(?:\s\d+)?)|(?:[A-D])):\s*/g,
    (m, p1, label) => {
      const head = (p1 === "" ? "" : "\n");
      return `${head}${label}: `;
    }
  );

  // ( ) を少し広げる
  s = s.replace(/\(\s*\)/g, "(　　　)");

  return s;
}

function render() {
  if (!deck.length) return;

  const q = deck[i];

  categoryTitleEl.textContent = currentCat?.title ?? "";
  qNoEl.textContent = `Q${i + 1}`;

  qTextEl.textContent = formatQuestion(q.question);

  ensureShuffledChoices(q);

  const a = answers[i];
  const answered = !!a;

  choicesEl.innerHTML = "";
  q._shuffled.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.type = "button";
    btn.textContent = c.t;

    if (a && a.choiceIndex === c.idx) btn.classList.add("selected");

    if (answered) {
      btn.disabled = true;
      if (c.idx === q.answer) btn.classList.add("correct");
      if (a.choiceIndex === c.idx && !a.isCorrect) btn.classList.add("wrong");
    } else {
      btn.addEventListener("click", () => {
        const isCorrect = (c.idx === q.answer);
        answers[i] = { choiceIndex: c.idx, isCorrect };

        if (currentCat?.key) updateStats(currentCat.key, q.id, isCorrect);

        render();
      });
    }

    choicesEl.appendChild(btn);
  });

  choicesEl.classList.toggle("is-dim", answered);

  updateNavState();
  updateStatus();
  setFeedbackForCurrent();

  prevBtn.disabled = (i === 0);
}

function jumpNext(predicate) {
  for (let k = 1; k <= deck.length; k++) {
    const idx = (i + k) % deck.length;
    if (predicate(idx)) {
      i = idx;
      render();
      return;
    }
  }
}

function finishToResult() {
  const total = deck.length;
  const answeredCount = answers.filter(Boolean).length;
  const correct = scoreNow();
  const wrong = answers.filter((a) => a && !a.isCorrect).length;
  const unanswered = total - answeredCount;

  summaryEl.innerHTML = `
    <p>カテゴリ：${currentCat?.title ?? ""}</p>
    <p>得点：${correct} / ${total}</p>
    <p>未回答：${unanswered}　不正解：${wrong}</p>
  `;

  // 結果は番号順
  const items = deck.map((q, idx) => ({ q, idx, a: answers[idx] }));

  reviewEl.innerHTML = items.map(({ q, idx, a }) => {
    const your = a ? a.choiceIndex : null;
    const ok = a ? a.isCorrect : false;
    const yourText = your ? q.choices[your - 1] : "未回答";
    const ansText = q.choices[q.answer - 1];
    const exp = q.explanation ? `<div class="exp">解説：${q.explanation}</div>` : "";
    const badge = !a ? "⏳" : (ok ? "✅" : "❌");

    return `
      <div class="reviewItem">
        <div class="rHead">Q${idx + 1} ${badge}</div>
        <div class="rQ">${cleanCell(q.question)}</div>
        <div>あなた：${yourText}</div>
        <div>正解：${ansText}</div>
        ${exp}
      </div>
    `;
  }).join("");

  showScreen("result");
}

function backToTop(confirmIfDirty = true) {
  if (confirmIfDirty && deck.length) {
    const answeredCount = answers.filter(Boolean).length;
    if (answeredCount > 0) {
      if (!confirm("トップに戻ると、現在の回答状態は破棄されます。戻りますか？")) return;
    }
  }

  currentCat = null;
  deck = [];
  i = 0;
  answers = [];

  navEl.innerHTML = "";
  qTextEl.textContent = "";
  choicesEl.innerHTML = "";
  feedbackEl.innerHTML = "";
  feedbackEl.classList.remove("is-open");
  summaryEl.innerHTML = "";
  reviewEl.innerHTML = "";

  updateStatus();
  showScreen("top");
}

async function startCategory(cat) {
  currentCat = cat;
  topMessageEl.textContent = "読み込み中...";

  try {
    if (String(cat.gid).includes("PUT_")) throw new Error(`${cat.title} の gid を設定してください`);

    const questions = await fetchQuestionsByGid(cat.gid);
    if (questions.length === 0) throw new Error("このシートに問題がありません。");

    const stats = loadStats(cat.key);
    deck = pickWeightedUnique(questions, stats, MAX_QUESTIONS);
    deck.forEach((q) => ensureShuffledChoices(q));

    i = 0;
    answers = Array(deck.length).fill(null);

    buildNav();
    showScreen("quiz");
    topMessageEl.textContent = "";
    render();
  } catch (e) {
    topMessageEl.textContent = `エラー: ${e.message}`;
  }
}

function renderTop() {
  const list = CATEGORIES.filter((c) => c.enabled);
  categoryListEl.innerHTML = "";

  if (list.length === 0) {
    topMessageEl.textContent = "公開カテゴリが設定されていません（app.js の enabled を確認）";
    return;
  }

  list.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "categoryBtn";
    btn.type = "button";
    btn.textContent = cat.title;
    btn.addEventListener("click", () => startCategory(cat));
    categoryListEl.appendChild(btn);
  });
}

function autoStartFromQuery() {
  const params = new URLSearchParams(location.search);
  const key = params.get("category");
  if (!key) return;

  const cat = CATEGORIES.find((c) => c.enabled && c.key === key);
  if (!cat) return;

  // URL をきれいに（/ ?category=... を残したくない場合は置換）
  // history.replaceState(null, "", "/");

  startCategory(cat);
}

// Events
toTopBtn.addEventListener("click", () => backToTop(true));
toTopBtn2.addEventListener("click", () => backToTop(false));

prevBtn.addEventListener("click", () => {
  if (i > 0) {
    i -= 1;
    render();
  }
});

nextBtn.addEventListener("click", () => {
  if (!answers[i]) return; // 未回答は進めない
  if (i < deck.length - 1) {
    i += 1;
    render();
  } else {
    finishToResult();
  }
});

if (nextWrongBtn) {
  nextWrongBtn.addEventListener("click", () => {
    jumpNext((idx) => answers[idx] && !answers[idx].isCorrect);
  });
}

restartBtn.addEventListener("click", () => {
  if (!currentCat) return backToTop(false);
  startCategory(currentCat);
});

// init
showScreen("top");
renderTop();
updateStatus();
autoStartFromQuery();
