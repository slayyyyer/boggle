import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCORE_BY_LENGTH,
  buildTrie,
  scoreWord,
  solveBoard,
  trieHasWord,
} from "../js/solver.js";
import {
  DICE_4X4,
  generateBoard,
  mulberry32,
  seedForDate,
} from "../js/boards.js";
import {
  CPU_PRESETS,
  SAFE_PROBABILITY,
  chooseCpuAttempt,
  successProbability,
} from "../js/cpu.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIDE = 3;

function neighbors(side) {
  const result = Array.from({ length: side * side }, () => []);
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue;
          const rr = row + dr;
          const cc = col + dc;
          if (rr < 0 || rr >= side || cc < 0 || cc >= side) continue;
          result[row * side + col].push(rr * side + cc);
        }
      }
    }
  }
  return result;
}

function assertValidPath(cells, side, entry) {
  assert.equal(entry.path.length > 0, true, `${entry.word} has an empty path`);
  assert.equal(
    entry.path.map((index) => cells[index]).join(""),
    entry.word,
    `${entry.word} path spells a different word`
  );
  const seen = new Set();
  const graph = neighbors(side);
  entry.path.forEach((index, position) => {
    assert.equal(seen.has(index), false, `${entry.word} reuses a tile`);
    seen.add(index);
    if (position > 0) {
      assert.equal(
        graph[entry.path[position - 1]].includes(index),
        true,
        `${entry.word} path is not adjacent at step ${position}`
      );
    }
  });
}

// A deliberately naive reference: enumerate every simple path, check the
// dictionary at each node. Used only on tiny 3x3 boards with small lexicons.
function referenceSolve(cells, dictionary, maxLetters = 6) {
  const side = Math.sqrt(cells.length);
  const graph = neighbors(side);
  const words = new Set(dictionary);
  const paths = new Map();
  const counts = new Map();
  const path = [];
  const used = new Set();

  function walk(index) {
    const text = path.map((item) => cells[item]).join("") + cells[index];
    if (text.length > maxLetters) return;
    path.push(index);
    used.add(index);
    if (words.has(text)) {
      counts.set(text, (counts.get(text) || 0) + 1);
      if (!paths.has(text)) paths.set(text, path.slice());
    }
    for (const next of graph[index]) {
      if (!used.has(next)) walk(next);
    }
    used.delete(index);
    path.pop();
  }

  for (let index = 0; index < cells.length; index += 1) walk(index);
  return { counts, paths };
}

test("the visible scoring table is the standard one", () => {
  assert.deepEqual({ ...SCORE_BY_LENGTH }, { 3: 1, 4: 1, 5: 2, 6: 3, 7: 5, 8: 11 });
  assert.equal(scoreWord("cat"), 1);
  assert.equal(scoreWord("quit"), 1);
  assert.equal(scoreWord("quest"), 2);
  assert.equal(scoreWord("qubits"), 3);
  assert.equal(scoreWord("absolute"), 11);
  assert.equal(scoreWord("absolutely"), 11);
});

test("Qu is one tile, two letters, and scores by letter length", () => {
  const cells = ["qu", "e", "s", "x", "i", "t", "x", "x", "x"];
  const trie = buildTrie(["quit", "quest", "quits", "quite"]);
  const solution = solveBoard(cells, trie, { side: 3 });

  assert.equal(solution.wordCount, 4);
  assert.equal(solution.maxScore, 7);
  assert.deepEqual(solution.words.map((entry) => entry.word).sort(), [
    "quest",
    "quit",
    "quite",
    "quits",
  ]);

  const quit = solution.byWord.get("quit");
  assert.equal(quit.word.length, 4);
  assert.equal(quit.score, 1);
  assert.deepEqual(quit.path, [0, 4, 5]);
  assert.equal(quit.pathCount, 1);
  assertValidPath(cells, SIDE, quit);

  const quest = solution.byWord.get("quest");
  assert.equal(quest.score, 2);
  assert.deepEqual(quest.path, [0, 1, 2, 5]);
  assert.equal(quest.pathCount, 1);
  assertValidPath(cells, SIDE, quest);

  assert.equal(trieHasWord(trie, "quit"), true);
  assert.equal(trieHasWord(trie, "qu"), false);
});

test("a word with many distinct paths is counted once but all paths are counted", () => {
  const cells = ["a", "b", "a", "b", "a", "b", "a", "b", "a"];
  const trie = buildTrie(["aba", "bab"]);
  const solution = solveBoard(cells, trie, { side: 3 });

  assert.equal(solution.wordCount, 2);
  assert.equal(solution.maxScore, 2);
  assert.equal(solution.byWord.get("aba").pathCount, 24);
  assert.equal(solution.byWord.get("bab").pathCount, 20);
  assertValidPath(cells, SIDE, solution.byWord.get("aba"));
  assertValidPath(cells, SIDE, solution.byWord.get("bab"));
});

test("trie DFS matches a naive reference on small random boards", () => {
  const dictionary = [
    "aba",
    "abc",
    "acab",
    "baba",
    "babc",
    "baca",
    "cab",
    "caba",
    "cabb",
    "abba",
  ];
  const trie = buildTrie(dictionary);
  const random = mulberry32(0x51de);

  for (let boardIndex = 0; boardIndex < 40; boardIndex += 1) {
    const cells = Array.from({ length: 9 }, () => "abc"[Math.floor(random() * 3)]);
    const actual = solveBoard(cells, trie, { side: 3 });
    const expected = referenceSolve(cells, dictionary, 4);
    assert.equal(actual.wordCount, expected.counts.size, `board ${boardIndex} word set`);
    for (const [word, count] of expected.counts) {
      assert.equal(actual.byWord.has(word), true, `${word} missing on board ${boardIndex}`);
      assert.equal(actual.byWord.get(word).pathCount, count, `${word} path count`);
      assertValidPath(cells, SIDE, actual.byWord.get(word));
    }
  }
});

test("daily seeds are stable across a UTC day and across timezones", () => {
  const early = new Date("2026-11-10T00:00:00.000Z");
  const late = new Date("2026-11-10T23:59:59.999Z");
  const nextDay = new Date("2026-11-11T00:00:00.000Z");
  assert.equal(seedForDate(early), seedForDate(late));
  assert.notEqual(seedForDate(early), seedForDate(nextDay));

  const a = generateBoard(mulberry32(seedForDate(early)), DICE_4X4);
  const b = generateBoard(mulberry32(seedForDate(late)), DICE_4X4);
  assert.deepEqual(a, b);
  assert.equal(a.length, 16);
});

test("the CPU protects a lead and chases when behind", () => {
  const available = [
    { word: "cat", score: 1 },
    { word: "absolutely", score: 11 },
  ];
  const preset = CPU_PRESETS.sharp;

  const protecting = chooseCpuAttempt({
    available,
    preset,
    playerScore: 10,
    cpuScore: 40,
    timeLeft: 12,
    random: () => 0,
  });
  assert.equal(protecting.intent, "protect");
  assert.equal(protecting.word, "cat");
  assert.ok(protecting.probability >= SAFE_PROBABILITY);

  const chasing = chooseCpuAttempt({
    available,
    preset,
    playerScore: 80,
    cpuScore: 20,
    timeLeft: 20,
    random: () => 0,
  });
  assert.equal(chasing.intent, "chase");
  assert.equal(chasing.word, "absolutely");

  const idle = chooseCpuAttempt({
    available: [{ word: "absolutely", score: 11 }],
    preset,
    playerScore: 10,
    cpuScore: 40,
    timeLeft: 5,
    random: () => 0,
  });
  assert.equal(idle.idle, true);

  assert.ok(
    successProbability(3, 0.85) > successProbability(10, 0.85),
    "length must reduce find probability"
  );
});

test("the fixed full-dictionary board matches its regression snapshot", () => {
  const words = fs
    .readFileSync(path.join(ROOT, "data", "enable1-3-16.txt"), "utf8")
    .trim()
    .split(/\r?\n/);
  const trie = buildTrie(words);
  const board = ["c", "j", "e", "m", "w", "k", "s", "l", "h", "i", "s", "l", "n", "e", "i", "e"];
  const solution = solveBoard(board, trie, { side: 4 });
  assert.equal(solution.wordCount, 99);
  assert.equal(solution.maxScore, 150);
  assert.equal(
    crypto
      .createHash("sha256")
      .update(solution.words.map((entry) => entry.word).join("|"))
      .digest("hex"),
    "315f2f8de8009e38e965f0fe25bba425e9344db109b6f2c058b06b5fa35d1e26"
  );
});

test("the full dictionary board is internally exact", () => {
  const words = fs
    .readFileSync(path.join(ROOT, "data", "enable1-3-16.txt"), "utf8")
    .trim()
    .split(/\r?\n/);
  const dictionary = new Set(words);
  const trie = buildTrie(words);
  const board = generateBoard(mulberry32(0x20261110), DICE_4X4);
  const solution = solveBoard(board, trie, { side: 4 });

  assert.ok(solution.wordCount > 0);
  assert.equal(solution.words.length, solution.wordCount);
  assert.equal(
    solution.maxScore,
    solution.words.reduce((sum, entry) => sum + entry.score, 0)
  );
  for (const entry of solution.words) {
    assert.equal(dictionary.has(entry.word), true);
    assert.equal(entry.score, scoreWord(entry.word));
    assertValidPath(board, 4, entry);
    assert.ok(entry.pathCount >= 1);
  }
  assert.equal(new Set(solution.words.map((entry) => entry.word)).size, solution.wordCount);
});
