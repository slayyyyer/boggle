import {
  MIN_WORD_LENGTH,
  buildTrie,
  scoreWord,
  solveBoard,
  trieHasWord,
} from "./solver.js";
import {
  DICE_4X4,
  SIDE_4X4,
  cellLabel,
  cellPosition,
  dailyLabel,
  generateBoard,
  mulberry32,
  randomSeed,
  seedForDate,
} from "./boards.js";
import { CPU_PRESETS, chooseCpuAttempt } from "./cpu.js";

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(pointer: fine)");
const OPTIONS_KEY = "boggle-lab:options";
const SOUND_KEY = "boggle-lab:sound";
const LAB_SEED = 0xb0661e;
const PREVIEW_BOARD = [
  "r", "y", "a", "qu",
  "e", "l", "f", "n",
  "c", "w", "o", "r",
  "o", "s", "t", "s",
];

const state = {
  words: null,
  trie: null,
  wordCount: 0,
  trieBuildMs: 0,
  loadError: null,
  screen: "home",
  running: false,
  paused: false,
  pausedAt: 0,
  roundToken: 0,
  timerId: 0,
  seconds: 180,
  endsAt: 0,
  timeLeft: 180,
  cells: [],
  side: SIDE_4X4,
  solution: null,
  solveMs: 0,
  seed: 0,
  mode: "daily",
  daily: false,
  label: "",
  config: null,
  opponent: null,
  cpu: null,
  found: new Map(),
  score: 0,
  selection: [],
  previewPath: null,
  resultPath: null,
  lastMilestone: 999,
  lab: { samples: null, best: null, busy: false },
};

const screens = {
  home: $("screenHome"),
  game: $("screenGame"),
  results: $("screenResults"),
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatTime(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function entrySort(a, b) {
  return (
    b.score - a.score ||
    b.word.length - a.word.length ||
    a.word.localeCompare(b.word)
  );
}

function readStorage(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable on file URLs or in private windows.
  }
}

function announce(message) {
  const live = $("liveMessage");
  if (live) live.textContent = message;
}

function setMessage(text, tone = "") {
  const live = $("liveMessage");
  live.textContent = text;
  live.className = `live-message${tone ? ` is-${tone}` : ""}`;
}

function pathText(entry) {
  return entry.path
    .map((index) => `${cellLabel(state.cells[index])} (${cellPosition(index, state.side)})`)
    .join(" → ");
}

function scoreLabel(score) {
  return `${score} pt${score === 1 ? "" : "s"}`;
}

/* ---------- tiny synthesized sound ---------- */

const sound = {
  enabled: false,
  context: null,

  init() {
    this.enabled = readStorage(SOUND_KEY, "off") === "on";
    this.updateButton();
  },

  updateButton() {
    const button = $("soundBtn");
    button.setAttribute("aria-pressed", String(this.enabled));
    button.setAttribute("aria-label", this.enabled ? "Mute sound" : "Enable sound");
    button.title = this.enabled ? "Sound on" : "Sound off";
    document.body.classList.toggle("is-muted", !this.enabled);
  },

  ensure() {
    if (!this.enabled) return null;
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return null;
        this.context = new Context();
      }
      if (this.context.state === "suspended") this.context.resume();
      return this.context;
    } catch {
      return null;
    }
  },

  unlock() {
    if (this.enabled) this.ensure();
  },

  toggle() {
    this.enabled = !this.enabled;
    writeStorage(SOUND_KEY, this.enabled ? "on" : "off");
    this.updateButton();
    if (this.enabled) {
      this.ensure();
      this.blip(720, 0.08, "sine", 0.025);
    }
  },

  blip(frequency, duration, type = "sine", volume = 0.03) {
    const context = this.ensure();
    if (!context) return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch {
      // Audio is a garnish; never let it break the round.
    }
  },

  found() {
    this.blip(660, 0.08, "sine", 0.028);
    window.setTimeout(() => this.blip(990, 0.12, "sine", 0.024), 65);
  },

  error() {
    this.blip(190, 0.12, "triangle", 0.022);
  },

  cpu() {
    this.blip(520, 0.06, "sine", 0.014);
  },

  end() {
    this.blip(523, 0.12, "sine", 0.026);
    window.setTimeout(() => this.blip(392, 0.18, "sine", 0.022), 110);
  },
};

/* ---------- board view ---------- */

class BoardView {
  constructor(container, svg, { interactive = false } = {}) {
    this.container = container;
    this.svg = svg;
    this.interactive = interactive;
    this.cells = [];
    this.side = SIDE_4X4;
    this.tiles = [];
    this.selection = [];
    this.preview = [];
    this.pointerId = null;
    this.dragging = false;
    this.moved = false;
    this.onChange = null;
    this.onSubmit = null;
    this.onInvalid = null;

    container.addEventListener("pointerdown", (event) => this.pointerDown(event));
    container.addEventListener("pointermove", (event) => this.pointerMove(event), { passive: false });
    container.addEventListener("pointerup", (event) => this.pointerUp(event));
    container.addEventListener("pointercancel", (event) => this.pointerUp(event));
    window.addEventListener("resize", () => this.draw());

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(container);
    }
  }

  render(cells, side) {
    this.cells = cells;
    this.side = side;
    this.selection = [];
    this.preview = [];
    this.dragging = false;
    this.pointerId = null;
    this.container.style.setProperty("--side", String(side));
    this.container.textContent = "";
    this.tiles = cells.map((cell, index) => {
      const tile = document.createElement(this.interactive ? "button" : "div");
      if (this.interactive) {
        tile.type = "button";
        tile.addEventListener("click", (event) => {
          if (event.detail !== 0) return;
          this.addTile(index);
        });
      } else {
        tile.setAttribute("role", "img");
      }
      tile.className = "tile";
      tile.dataset.index = String(index);
      const label = document.createElement("span");
      label.className = `tile-letter${cell === "qu" ? " is-qu" : ""}`;
      label.textContent = cellLabel(cell);
      const order = document.createElement("span");
      order.className = "tile-order";
      order.setAttribute("aria-hidden", "true");
      tile.append(label, order);
      tile.setAttribute(
        "aria-label",
        `${cellLabel(cell)}, row ${Math.floor(index / side) + 1}, column ${(index % side) + 1}`
      );
      this.container.append(tile);
      return tile;
    });
    this.sync();
    this.draw();
  }

  isEmpty() {
    return this.selection.length === 0;
  }

  currentWord() {
    return this.selection.map((index) => this.cells[index]).join("");
  }

  setSelection(indices) {
    this.selection = indices.slice();
    this.preview = [];
    this.sync();
    this.draw();
    if (this.onChange) this.onChange(this.selection.slice());
  }

  setPreview(path) {
    this.preview = path ? path.slice() : [];
    this.sync();
    this.draw();
  }

  popSelection() {
    if (!this.selection.length) return;
    this.setSelection(this.selection.slice(0, -1));
  }

  areAdjacent(a, b) {
    const rowA = Math.floor(a / this.side);
    const colA = a % this.side;
    const rowB = Math.floor(b / this.side);
    const colB = b % this.side;
    return Math.max(Math.abs(rowA - rowB), Math.abs(colA - colB)) === 1;
  }

  addTile(index) {
    if (!this.interactive) return;
    if (!this.selection.length) {
      this.setSelection([index]);
      return;
    }
    const last = this.selection[this.selection.length - 1];
    if (this.selection.includes(index)) {
      const position = this.selection.indexOf(index);
      if (position < this.selection.length - 1) {
        this.setSelection(this.selection.slice(0, position + 1));
      }
      return;
    }
    if (!this.areAdjacent(last, index)) {
      if (this.onInvalid) this.onInvalid("Tiles must touch.");
      return;
    }
    this.setSelection([...this.selection, index]);
  }

  pointerDown(event) {
    if (!this.interactive || event.button > 0) return;
    const tile = event.target.closest(".tile");
    if (!tile || !this.container.contains(tile)) return;
    event.preventDefault();
    try {
      tile.focus({ preventScroll: true });
    } catch {
      // Older browsers may not accept focus options.
    }
    this.pointerId = event.pointerId;
    this.dragging = true;
    this.moved = false;
    try {
      this.container.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement, not a requirement.
    }
    this.setSelection([Number(tile.dataset.index)]);
  }

  pointerMove(event) {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const tile = element && element.closest ? element.closest(".tile") : null;
    if (!tile || !this.container.contains(tile)) return;
    const index = Number(tile.dataset.index);
    const last = this.selection[this.selection.length - 1];
    if (index === last) return;
    const existing = this.selection.indexOf(index);
    if (existing >= 0) {
      if (existing < this.selection.length - 1) {
        this.moved = true;
        this.setSelection(this.selection.slice(0, existing + 1));
      }
      return;
    }
    if (!this.areAdjacent(last, index)) return;
    this.moved = true;
    this.setSelection([...this.selection, index]);
  }

  pointerUp(event) {
    if (!this.dragging) return;
    if (event.pointerId !== undefined && event.pointerId !== this.pointerId) return;
    const submit = this.moved && this.selection.length > 0;
    this.dragging = false;
    this.pointerId = null;
    this.moved = false;
    try {
      this.container.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be released.
    }
    if (submit && this.onSubmit) this.onSubmit();
  }

  sync() {
    const active = this.selection.length ? this.selection : this.preview;
    const previewing = this.selection.length === 0 && this.preview.length > 0;
    this.tiles.forEach((tile, index) => {
      const position = active.indexOf(index);
      const selected = this.selection.includes(index);
      tile.classList.toggle("is-selected", selected);
      tile.classList.toggle("is-preview", previewing && position >= 0);
      tile.classList.toggle("is-path", previewing && position >= 0);
      tile.classList.toggle("is-start", active.length > 0 && active[0] === index);
      tile.classList.toggle("is-end", active.length > 1 && active[active.length - 1] === index);
      if (this.interactive) tile.setAttribute("aria-pressed", String(selected));
      const order = tile.querySelector(".tile-order");
      if (order) order.textContent = position >= 0 ? String(position + 1) : "";
      const cell = this.cells[index];
      const base = `${cellLabel(cell)}, row ${Math.floor(index / this.side) + 1}, column ${(index % this.side) + 1}`;
      tile.setAttribute("aria-label", selected ? `${base}, selected` : base);
    });
  }

  draw() {
    if (!this.svg) return;
    this.svg.textContent = "";
    if (!this.selection.length && !this.preview.length) return;
    const boardRect = this.container.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height || !this.tiles.length) return;
    this.svg.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);
    const path = this.selection.length ? this.selection : this.preview;
    if (path.length < 2) return;

    const points = path.map((index) => {
      const rect = this.tiles[index].getBoundingClientRect();
      return `${rect.left + rect.width / 2 - boardRect.left},${rect.top + rect.height / 2 - boardRect.top}`;
    });
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points.join(" "));
    line.setAttribute("class", `path-line${this.selection.length ? "" : " is-preview"}`);
    this.svg.append(line);

    const start = path[0];
    const end = path[path.length - 1];
    [start, end].forEach((index, position) => {
      const rect = this.tiles[index].getBoundingClientRect();
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(rect.left + rect.width / 2 - boardRect.left));
      circle.setAttribute("cy", String(rect.top + rect.height / 2 - boardRect.top));
      circle.setAttribute("r", "5");
      circle.setAttribute("class", `path-dot${this.selection.length ? "" : " is-preview"}${position === 1 ? " is-end" : ""}`);
      this.svg.append(circle);
    });
  }
}

const previewView = new BoardView($("previewBoard"), null, { interactive: false });
const playView = new BoardView($("board"), $("pathLayer"), { interactive: true });
const resultView = new BoardView($("resultBoard"), $("resultPathLayer"), { interactive: false });
const hillView = new BoardView($("hillBoard"), null, { interactive: false });

/* ---------- dictionary ---------- */

async function loadDictionary() {
  try {
    const response = await fetch("data/enable1-3-16.txt", { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const words = text.trim().split(/\r?\n/).filter(Boolean);
    if (words.length < 1000) throw new Error("The word list looks truncated.");

    const start = performance.now();
    const trie = buildTrie(words);
    const buildMs = performance.now() - start;

    state.words = words;
    state.trie = trie;
    state.wordCount = words.length;
    state.trieBuildMs = buildMs;
    $("heroWordCount").textContent = words.length.toLocaleString();
    $("loadStatus").textContent = `${words.length.toLocaleString()} words loaded · trie built in ${buildMs.toFixed(0)} ms`;
    $("loadStatus").className = "load-status is-ready";
    $("startDaily").disabled = false;
    $("startRandom").disabled = false;
    $("sampleBtn").disabled = false;
    $("climbBtn").disabled = false;
    $("labStatus").textContent = "Ready. Sample the board distribution or run the hill climb.";
    renderPreview();

    window.BoggleLab = {
      get ready() {
        return Boolean(state.trie);
      },
      get wordCount() {
        return state.wordCount;
      },
      get trieBuildMs() {
        return state.trieBuildMs;
      },
      benchmark,
      solve(cells) {
        return solveBoard(cells, state.trie, { side: Math.round(Math.sqrt(cells.length)) });
      },
    };
  } catch (error) {
    state.loadError = error;
    $("loadStatus").textContent = "Could not load data/enable1-3-16.txt. Serve the folder over HTTP (node tools/serve.mjs) and reload.";
    $("loadStatus").className = "load-status is-error";
    $("labStatus").textContent = "The dictionary did not load.";
  }
}

function renderPreview() {
  if (!state.trie) return;
  const start = performance.now();
  const result = solveBoard(PREVIEW_BOARD, state.trie, { side: 4 });
  const solveMs = performance.now() - start;
  previewView.render(PREVIEW_BOARD, 4);
  $("previewMax").textContent = String(result.maxScore);
  $("previewWords").textContent = String(result.wordCount);
  $("previewMs").textContent = solveMs.toFixed(1);
}

/* ---------- screen and clock ---------- */

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => {
    element.hidden = key !== name;
  });
  state.screen = name;
  document.body.dataset.screen = name;
}

function pauseClock() {
  if (!state.running || state.paused) return;
  state.paused = true;
  state.pausedAt = performance.now();
}

function resumeClock() {
  if (!state.running || !state.paused) return;
  const delta = performance.now() - state.pausedAt;
  state.endsAt += delta;
  if (state.cpu) state.cpu.nextAt += delta;
  state.paused = false;
  state.pausedAt = 0;
}

function stopRound() {
  state.running = false;
  state.paused = false;
  state.pausedAt = 0;
  state.roundToken += 1;
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = 0;
  }
  state.cpu = null;
}

function goHome() {
  if (state.running) {
    const leave = window.confirm("End this round and go home?");
    if (!leave) return;
    stopRound();
  }
  showScreen("home");
}

/* ---------- round flow ---------- */

function selectedOpponent() {
  const value = $("opponentSelect").value;
  return value === "solo" ? null : CPU_PRESETS[value] || null;
}

function beginDaily() {
  if (!state.trie) return;
  const today = new Date();
  startRound({
    mode: "daily",
    daily: true,
    seed: seedForDate(today),
    label: `UTC ${dailyLabel(today)}`,
    seconds: Number($("roundSelect").value),
    opponent: selectedOpponent(),
  });
}

function beginRandom() {
  if (!state.trie) return;
  startRound({
    mode: "random",
    daily: false,
    seed: randomSeed(),
    label: "Random board",
    seconds: Number($("roundSelect").value),
    opponent: selectedOpponent(),
  });
}

function beginLabBoard(cells) {
  startRound({
    mode: "lab",
    daily: false,
    seed: randomSeed(),
    cells: cells.slice(),
    label: "Board lab find",
    seconds: Number($("roundSelect").value),
    opponent: selectedOpponent(),
  });
}

function startRound({ mode, daily = false, seed, cells, label, seconds, opponent = null }) {
  if (!state.trie) return;
  stopRound();
  state.running = true;
  state.seconds = seconds;
  state.timeLeft = seconds;
  state.endsAt = performance.now() + seconds * 1000;
  state.mode = mode;
  state.daily = daily;
  state.seed = (seed ?? randomSeed()) >>> 0;
  state.label = label;
  state.opponent = opponent;
  state.cells = cells ? cells.slice() : generateBoard(mulberry32(state.seed), DICE_4X4);
  state.side = SIDE_4X4;
  state.config = {
    mode,
    daily,
    seed: state.seed,
    cells: cells ? cells.slice() : null,
    label,
    seconds,
    opponent,
  };

  const solveStart = performance.now();
  state.solution = solveBoard(state.cells, state.trie, { side: state.side });
  state.solveMs = performance.now() - solveStart;
  state.found = new Map();
  state.score = 0;
  state.selection = [];
  state.previewPath = null;
  state.resultPath = null;
  state.lastMilestone = 999;
  state.cpu = opponent
    ? {
        preset: opponent,
        score: 0,
        found: new Map(),
        nextAt: performance.now() + opponent.attemptSeconds * 1000,
        random: mulberry32((state.seed ^ 0x9e3779b9) >>> 0),
      }
    : null;

  $("modePill").textContent = daily ? "Daily" : mode === "lab" ? "Lab" : "Random";
  $("modeDetail").textContent = label;
  $("cpuHud").hidden = !opponent;
  $("cpuPanel").hidden = !opponent;
  $("cpuSkillLabel").textContent = opponent ? `CPU · ${opponent.label}` : "CPU";
  $("cpuSkillLabelSide").textContent = opponent ? `CPU · ${opponent.label}` : "CPU";
  $("cpuScoreNow").textContent = "0";
  $("cpuWordsFound").textContent = "0 found";
  $("cpuEvent").textContent = opponent ? "Waiting for the first attempt…" : "";
  $("wordInput").value = "";
  $("wordInput").disabled = false;
  $("submitBtn").disabled = false;
  $("clearBtn").disabled = false;
  $("timerBlock").classList.remove("is-urgent");
  $("timerFill").classList.remove("is-warn", "is-low");

  playView.render(state.cells, state.side);
  playView.setPreview(null);
  setMessage("Trace adjacent tiles or type a word.", "");
  updateHud();
  renderFoundList();
  updateWordLine();
  updateTimer(seconds * 1000);
  showScreen("game");
  state.timerId = window.setInterval(tick, 150);
  announce(`Round started. ${formatTime(seconds * 1000)} on the clock.`);
  if (finePointer.matches) {
    window.setTimeout(() => $("wordInput").focus(), 80);
  }
}

function tick() {
  if (!state.running || state.paused) return;
  const now = performance.now();
  const remaining = Math.max(0, state.endsAt - now);
  state.timeLeft = remaining / 1000;
  updateTimer(remaining);

  if (remaining > 0 && state.cpu && now >= state.cpu.nextAt) cpuAttempt(now);

  const secondsLeft = Math.ceil(remaining / 1000);
  if ((secondsLeft === 30 || secondsLeft === 10) && state.lastMilestone !== secondsLeft) {
    state.lastMilestone = secondsLeft;
    setMessage(`${secondsLeft} seconds left.`, secondsLeft === 10 ? "warn" : "");
    announce(`${secondsLeft} seconds left.`);
  }

  if (remaining <= 0) endRound("time");
}

function updateTimer(remaining) {
  const ratio = clamp(remaining / (state.seconds * 1000), 0, 1);
  const secondsLeft = remaining / 1000;
  $("timerText").textContent = formatTime(remaining);
  $("timerFill").style.width = `${ratio * 100}%`;
  $("timerFill").classList.toggle("is-warn", secondsLeft <= 30 && secondsLeft > 10);
  $("timerFill").classList.toggle("is-low", secondsLeft <= 10);
  $("timerBlock").classList.toggle("is-urgent", secondsLeft <= 10);
}

function updateHud() {
  $("scoreNow").textContent = String(state.score);
  $("sideScore").textContent = String(state.score);
  $("foundCount").textContent = `${state.found.size} found`;
  $("foundTotal").textContent = String(state.found.size);
  $("wordsFound").textContent = `${state.found.size} word${state.found.size === 1 ? "" : "s"}`;
  $("sideWords").textContent = String(state.found.size);
  if (state.cpu) {
    $("cpuScoreNow").textContent = String(state.cpu.score);
    $("cpuWordsFound").textContent = `${state.cpu.found.size} found`;
  }
}

function cpuAttempt(now) {
  const available = state.solution.words.filter((entry) => !state.cpu.found.has(entry.word));
  const choice = chooseCpuAttempt({
    available,
    preset: state.cpu.preset,
    playerScore: state.score,
    cpuScore: state.cpu.score,
    timeLeft: state.timeLeft,
    random: state.cpu.random,
  });

  if (!choice) {
    state.cpu.nextAt = now + 1200;
    return;
  }
  state.cpu.nextAt = now + Math.max(0.4, choice.costSeconds) * 1000;

  if (choice.idle) {
    $("cpuEvent").textContent = "Holding the lead — no risky attempts.";
    return;
  }

  if (state.cpu.random() < choice.probability) {
    const entry = state.solution.byWord.get(choice.word);
    state.cpu.found.set(choice.word, entry);
    state.cpu.score += entry.score;
    $("cpuEvent").textContent = `Found a ${entry.word.length}-letter word (+${entry.score}).`;
    sound.cpu();
  } else {
    $("cpuEvent").textContent = choice.intent === "chase" ? "Reaching for a long word…" : "Still searching…";
  }
  updateHud();
}

/* ---------- word entry ---------- */

function updateWordLine() {
  const typed = $("wordInput").value.trim();
  let word = typed;
  if (!word && playView.selection.length) word = playView.currentWord();
  if (!word && state.previewPath) {
    word = state.previewPath.map((index) => state.cells[index]).join("");
  }
  $("currentWord").textContent = word ? word.toUpperCase() : "—";
  $("currentWord").classList.toggle("is-empty", !word);
  $("wordScore").textContent = word.length >= MIN_WORD_LENGTH ? `+${scoreWord(word)}` : "";
}

function clearCurrent() {
  $("wordInput").value = "";
  playView.setPreview(null);
  playView.setSelection([]);
  state.previewPath = null;
  updateWordLine();
  setMessage("", "");
}

function submitCurrent() {
  if (!state.running) return;
  const typed = $("wordInput").value.trim().toLowerCase();
  const word = typed || playView.currentWord();

  if (!word) {
    setMessage("Type a word or tap adjacent tiles.", "warn");
    sound.error();
    return;
  }
  if (word.length < MIN_WORD_LENGTH) {
    setMessage(`Too short — ${MIN_WORD_LENGTH} letters minimum.`, "warn");
    sound.error();
    return;
  }
  if (!trieHasWord(state.trie, word)) {
    setMessage(`${word.toUpperCase()} is not in the word list.`, "bad");
    sound.error();
    return;
  }
  const entry = state.solution.byWord.get(word);
  if (!entry) {
    setMessage(`${word.toUpperCase()} is not on this board.`, "bad");
    sound.error();
    return;
  }
  if (state.found.has(word)) {
    setMessage(`Already found ${word.toUpperCase()}.`, "warn");
    sound.error();
    return;
  }
  acceptWord(word, entry);
}

function acceptWord(word, entry) {
  state.found.set(word, { ...entry, order: state.found.size + 1 });
  state.score += entry.score;
  $("wordInput").value = "";
  playView.setSelection([]);
  playView.setPreview(entry.path);
  state.previewPath = entry.path;
  updateHud();
  renderFoundList();
  updateWordLine();
  setMessage(`+${entry.score} ${word.toUpperCase()}`, "good");
  sound.found();
}

function previewFound(word) {
  const entry = state.solution && state.solution.byWord.get(word);
  if (!entry) return;
  $("wordInput").value = "";
  playView.setSelection([]);
  playView.setPreview(entry.path);
  state.previewPath = entry.path;
  updateWordLine();
}

function renderFoundList() {
  const container = $("foundList");
  container.textContent = "";
  if (!state.found.size) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing yet. Longer words pay more.";
    container.append(empty);
    return;
  }
  const entries = Array.from(state.found.values()).reverse();
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-btn";
    button.dataset.word = entry.word;
    const word = document.createElement("span");
    word.textContent = entry.word.toUpperCase();
    const points = document.createElement("span");
    points.className = "pts";
    points.textContent = `+${entry.score}`;
    button.append(word, points);
    container.append(button);
  }
}

/* ---------- results ---------- */

function endRound(reason) {
  if (!state.running) return;
  state.running = false;
  state.paused = false;
  state.pausedAt = 0;
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = 0;
  }
  state.timeLeft = Math.max(0, state.endsAt - performance.now()) / 1000;
  renderResults(reason);
  showScreen("results");
  sound.end();
  window.setTimeout(() => $("resultTitle").focus({ preventScroll: true }), 40);
}

function renderResults(reason) {
  const solution = state.solution;
  const found = Array.from(state.found.values()).sort(entrySort);
  const missed = solution.words.filter((entry) => !state.found.has(entry.word));
  const wordPercent = solution.wordCount ? (found.length / solution.wordCount) * 100 : 0;
  const scorePercent = solution.maxScore ? (state.score / solution.maxScore) * 100 : 0;
  const endedEarly = reason === "quit";

  $("resultTitle").textContent = endedEarly ? "Round ended." : "Time. The board is settled.";
  $("resultsSub").textContent = `${endedEarly ? "You ended the round early." : "The clock ran out."} You found ${found.length} of ${solution.wordCount} words and scored ${state.score} of ${solution.maxScore} points. That is ${scorePercent.toFixed(0)}% of the board's exact maximum.`;
  $("resScore").textContent = String(state.score);
  $("resScoreOf").textContent = `of ${solution.maxScore} points`;
  $("resMax").textContent = String(solution.maxScore);
  $("resWords").textContent = String(found.length);
  $("resWordsOf").textContent = `of ${solution.wordCount} words`;
  $("resPercent").textContent = `${wordPercent.toFixed(0)}%`;
  $("resScorePercent").textContent = `${scorePercent.toFixed(0)}% of points`;

  if (state.cpu) {
    const cpu = state.cpu;
    const verdict = state.score > cpu.score ? "You won" : state.score < cpu.score ? "The CPU won" : "A draw";
    $("cpuResult").hidden = false;
    const cpuWords = `${cpu.found.size} word${cpu.found.size === 1 ? "" : "s"}`;
    $("cpuResult").textContent = `CPU · ${cpu.preset.label} found ${cpuWords} and scored ${cpu.score} of ${solution.maxScore}. ${verdict}, ${state.score}–${cpu.score}. Both players can score the same word.`;
  } else {
    $("cpuResult").hidden = true;
    $("cpuResult").textContent = "";
  }

  resultView.render(state.cells, state.side);
  resultView.setPreview(null);
  state.resultPath = null;
  $("resultPathLabel").textContent = "Click a word";
  $("pathReadout").textContent = "Select any word to see its path.";

  renderResultWordList($("yourWords"), found, "No words this time. The board still has " + solution.wordCount + ".");
  renderResultWordList($("missedWords"), missed, "You found every word on the board.");
  const longest = solution.longest
    .map((word) => solution.byWord.get(word))
    .filter(Boolean);
  renderResultWordList($("longestWords"), longest, "No words on this board.");

  $("yourCount").textContent = String(found.length);
  $("missedCount").textContent = String(missed.length);
  const pathTotal = solution.words.reduce((sum, entry) => sum + entry.pathCount, 0);
  $("resultMeta").textContent = `${state.wordCount.toLocaleString()} words in the list · trie ${state.trieBuildMs.toFixed(0)} ms · this board solved in ${state.solveMs.toFixed(1)} ms · ${pathTotal.toLocaleString()} legal paths counted.`;
}

function renderResultWordList(container, entries, emptyText) {
  container.textContent = "";
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-btn";
    button.dataset.word = entry.word;
    button.title = `${entry.pathCount} distinct path${entry.pathCount === 1 ? "" : "s"}`;
    const word = document.createElement("span");
    word.textContent = entry.word.toUpperCase();
    const points = document.createElement("span");
    points.className = "pts";
    points.textContent = `+${entry.score}`;
    button.append(word, points);
    container.append(button);
  }
}

function highlightResultWord(word) {
  const entry = state.solution && state.solution.byWord.get(word);
  if (!entry) return;
  state.resultPath = entry.path;
  resultView.setPreview(entry.path);
  $("resultPathLabel").textContent = `${entry.word.toUpperCase()} · +${entry.score}`;
  $("pathReadout").textContent = `${entry.word.toUpperCase()} · ${entry.word.length} letters · ${scoreLabel(entry.score)} · ${entry.pathCount} distinct path${entry.pathCount === 1 ? "" : "s"} — ${pathText(entry)}`;
  document.querySelectorAll(".results-lists .word-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.word === word);
  });
}

/* ---------- board lab ---------- */

function setLabButtons() {
  const busy = state.lab.busy;
  $("sampleBtn").disabled = !state.trie || busy;
  $("climbBtn").disabled = !state.trie || busy;
  $("playHillBtn").disabled = !state.lab.best || busy;
}

async function runSample() {
  if (!state.trie || state.lab.busy) return;
  state.lab.busy = true;
  state.lab.best = null;
  setLabButtons();
  const total = 250;
  const random = mulberry32(LAB_SEED);
  const samples = [];
  $("labStatus").textContent = `Solving 0 / ${total} random boards…`;

  for (let index = 0; index < total; index += 1) {
    const cells = generateBoard(random, DICE_4X4);
    const start = performance.now();
    const result = solveBoard(cells, state.trie, { side: 4 });
    samples.push({
      cells,
      wordCount: result.wordCount,
      maxScore: result.maxScore,
      ms: performance.now() - start,
    });
  }

  state.lab.samples = samples;
  renderLabSummary(samples);
  renderHistogram($("wordHistogram"), samples.map((sample) => sample.wordCount), {
    binSize: 25,
    unit: "words",
  });
  renderHistogram($("scoreHistogram"), samples.map((sample) => sample.maxScore), {
    binSize: 50,
    unit: "points",
  });
  $("labStatus").textContent = `Sampled ${total} random boards with seed 0x${LAB_SEED.toString(16)}. The distribution is measured; each board is exact.`;
  $("hillMeta").textContent = "Sample ready. Hill-climb from the best board in the sample, or start from a fresh board.";
  state.lab.busy = false;
  setLabButtons();
}

function renderLabSummary(samples) {
  const words = samples.map((sample) => sample.wordCount);
  const scores = samples.map((sample) => sample.maxScore);
  const meanWords = words.reduce((sum, value) => sum + value, 0) / words.length;
  const meanScore = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  $("labSummary").textContent = `${samples.length} boards: words median ${median(words)} (mean ${meanWords.toFixed(1)}, range ${Math.min(...words)}–${Math.max(...words)}); exact maximum median ${median(scores)} (mean ${meanScore.toFixed(1)}, range ${Math.min(...scores)}–${Math.max(...scores)}). This is a sample of boards, not a census.`;
}

function renderHistogram(container, values, { binSize, unit }) {
  container.textContent = "";
  if (!values.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "hist-placeholder";
    placeholder.textContent = "No sample yet.";
    container.append(placeholder);
    return;
  }

  const maximum = Math.max(...values);
  const binCount = clamp(Math.ceil((maximum + 1) / binSize), 5, 10);
  const span = Math.max(1, Math.ceil((maximum + 1) / binCount));
  const counts = new Array(binCount).fill(0);
  for (const value of values) {
    counts[Math.min(binCount - 1, Math.floor(value / span))] += 1;
  }
  const largest = Math.max(...counts, 1);
  container.setAttribute(
    "aria-label",
    `Histogram of exact ${unit} across ${values.length} boards, from 0 to ${maximum}.`
  );

  const bars = document.createElement("div");
  bars.className = "hist-bars";
  counts.forEach((count, index) => {
    const column = document.createElement("div");
    column.className = "hist-col";
    const countLabel = document.createElement("span");
    countLabel.className = "hist-count";
    countLabel.textContent = String(count);
    const bar = document.createElement("span");
    bar.className = "hist-bar";
    bar.style.setProperty("--h", `${(count / largest) * 100}%`);
    const bin = document.createElement("span");
    bin.className = "hist-bin";
    const from = index * span;
    bin.textContent = `${from}–${from + span - 1}`;
    column.append(countLabel, bar, bin);
    bars.append(column);
  });
  container.append(bars);

  const table = document.createElement("table");
  table.className = "sr-only";
  const caption = document.createElement("caption");
  caption.textContent = `Distribution of ${unit}`;
  table.append(caption);
  const head = document.createElement("tr");
  ["Range", "Boards"].forEach((text) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = text;
    head.append(cell);
  });
  table.append(head);
  counts.forEach((count, index) => {
    const row = document.createElement("tr");
    const range = document.createElement("td");
    const from = index * span;
    range.textContent = `${from}–${from + span - 1}`;
    const amount = document.createElement("td");
    amount.textContent = String(count);
    row.append(range, amount);
    table.append(row);
  });
  container.append(table);
}

async function runClimb() {
  if (!state.trie || state.lab.busy) return;
  state.lab.busy = true;
  setLabButtons();

  let seedSample = null;
  if (state.lab.samples && state.lab.samples.length) {
    seedSample = state.lab.samples.reduce((best, sample) =>
      sample.maxScore > best.maxScore ? sample : best
    );
  } else {
    const cells = generateBoard(mulberry32(LAB_SEED), DICE_4X4);
    const result = solveBoard(cells, state.trie, { side: 4 });
    seedSample = { cells, wordCount: result.wordCount, maxScore: result.maxScore };
  }

  const cells = seedSample.cells.slice();
  let result = solveBoard(cells, state.trie, { side: 4 });
  let bestScore = result.maxScore;
  let bestWords = result.wordCount;
  let accepted = 0;
  const iterations = 300;
  const random = mulberry32((LAB_SEED ^ 0x9e3779b9) >>> 0);
  $("labStatus").textContent = `Hill-climbing from ${bestScore} points…`;

  for (let index = 0; index < iterations; index += 1) {
    const a = Math.floor(random() * cells.length);
    let b = Math.floor(random() * (cells.length - 1));
    if (b >= a) b += 1;
    [cells[a], cells[b]] = [cells[b], cells[a]];
    const candidate = solveBoard(cells, state.trie, { side: 4 });
    if (candidate.maxScore > bestScore || (candidate.maxScore === bestScore && candidate.wordCount > bestWords)) {
      result = candidate;
      bestScore = candidate.maxScore;
      bestWords = candidate.wordCount;
      accepted += 1;
    } else {
      [cells[a], cells[b]] = [cells[b], cells[a]];
    }
  }

  state.lab.best = { cells: cells.slice(), result };
  hillView.render(state.lab.best.cells, 4);
  $("hillMeta").textContent = `Best found after ${iterations} swaps: ${result.maxScore} points, ${result.wordCount} words (${accepted} improvements). This is a local search result, not a proven optimum.`;
  $("labStatus").textContent = `Hill climb finished. Best found: ${result.maxScore} points. That is not an upper bound.`;
  state.lab.busy = false;
  setLabButtons();
}

/* ---------- benchmark ---------- */

async function benchmark(count = 100) {
  if (!state.trie) throw new Error("The dictionary is not loaded yet.");
  const total = clamp(Math.floor(count) || 100, 1, 2000);
  const random = mulberry32(0x51de);
  const times = [];
  let words = 0;
  let score = 0;

  for (let index = 0; index < total; index += 1) {
    const cells = generateBoard(random, DICE_4X4);
    const start = performance.now();
    const result = solveBoard(cells, state.trie, { side: 4 });
    times.push(performance.now() - start);
    words += result.wordCount;
    score += result.maxScore;
  }

  times.sort((a, b) => a - b);
  const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
  return {
    boards: total,
    trieBuildMs: state.trieBuildMs,
    meanMs: mean,
    medianMs: median(times),
    p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    maxMs: times[times.length - 1],
    meanWords: words / total,
    meanMaxScore: score / total,
  };
}

/* ---------- events and boot ---------- */

function saveOptions() {
  writeStorage(
    OPTIONS_KEY,
    JSON.stringify({
      opponent: $("opponentSelect").value,
      seconds: Number($("roundSelect").value),
    })
  );
}

function loadOptions() {
  const saved = readStorage(OPTIONS_KEY);
  if (!saved) return;
  try {
    const options = JSON.parse(saved);
    if (["solo", "casual", "sharp", "ruthless"].includes(options.opponent)) {
      $("opponentSelect").value = options.opponent;
    }
    if ([60, 120, 180, 300].includes(options.seconds)) {
      $("roundSelect").value = String(options.seconds);
    }
  } catch {
    // Ignore a malformed saved option.
  }
}

function openHow() {
  pauseClock();
  const dialog = $("howDialog");
  if (!dialog.open) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }
}

function init() {
  sound.init();
  loadOptions();

  playView.onChange = (selection) => {
    state.selection = selection;
    if (selection.length) {
      state.previewPath = null;
      $("wordInput").value = "";
    }
    updateWordLine();
  };
  playView.onSubmit = () => submitCurrent();
  playView.onInvalid = (message) => {
    setMessage(message, "warn");
    sound.error();
  };

  $("startDaily").addEventListener("click", beginDaily);
  $("startRandom").addEventListener("click", beginRandom);
  $("navHome").addEventListener("click", goHome);
  $("navLab").addEventListener("click", (event) => {
    event.preventDefault();
    if (state.running) {
      if (!window.confirm("End this round and open the board lab?")) return;
      stopRound();
    }
    showScreen("home");
    $("lab").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
  });

  $("howBtn").addEventListener("click", openHow);
  $("howDialog").addEventListener("close", () => resumeClock());
  $("soundBtn").addEventListener("click", () => sound.toggle());

  $("wordForm").addEventListener("submit", (event) => {
    event.preventDefault();
    submitCurrent();
  });
  $("wordInput").addEventListener("input", () => {
    const input = $("wordInput");
    const cleaned = input.value.toLowerCase().replace(/[^a-z]/g, "");
    if (input.value !== cleaned) input.value = cleaned;
    if (cleaned) {
      playView.setPreview(null);
      state.previewPath = null;
      playView.setSelection([]);
    }
    updateWordLine();
  });
  $("wordInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearCurrent();
    } else if (event.key === "Backspace" && !event.currentTarget.value && playView.selection.length) {
      event.preventDefault();
      playView.popSelection();
    }
  });
  $("clearBtn").addEventListener("click", clearCurrent);
  $("endBtn").addEventListener("click", () => endRound("quit"));
  $("foundList").addEventListener("click", (event) => {
    const button = event.target.closest(".word-btn");
    if (button && button.dataset.word) previewFound(button.dataset.word);
  });

  $("playAgain").addEventListener("click", () => {
    if (state.config) startRound(state.config);
  });
  $("newBoard").addEventListener("click", () => {
    startRound({
      mode: "random",
      daily: false,
      seed: randomSeed(),
      label: "Random board",
      seconds: state.config ? state.config.seconds : Number($("roundSelect").value),
      opponent: state.config ? state.config.opponent : selectedOpponent(),
    });
  });
  $("backHome").addEventListener("click", () => {
    stopRound();
    showScreen("home");
  });

  document.querySelector(".results-lists").addEventListener("click", (event) => {
    const button = event.target.closest(".word-btn");
    if (button && button.dataset.word) highlightResultWord(button.dataset.word);
  });

  $("sampleBtn").addEventListener("click", runSample);
  $("climbBtn").addEventListener("click", runClimb);
  $("playHillBtn").addEventListener("click", () => {
    if (state.lab.best) beginLabBoard(state.lab.best.cells);
  });

  $("opponentSelect").addEventListener("change", saveOptions);
  $("roundSelect").addEventListener("change", saveOptions);
  document.addEventListener(
    "pointerdown",
    () => {
      sound.unlock();
    },
    { once: true }
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseClock();
    else resumeClock();
  });

  showScreen("home");
  setLabButtons();
  loadDictionary();
}

init();
