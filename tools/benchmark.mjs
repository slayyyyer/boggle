// Node benchmark for the shipped word list and solver.
// Run: node tools/benchmark.mjs [--boards=200]
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { buildTrie, solveBoard } from "../js/solver.js";
import { DICE_4X4, generateBoard, mulberry32 } from "../js/boards.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "enable1-3-16.txt");
const boardArg = process.argv.find((arg) => arg.startsWith("--boards="));
const BOARDS = Math.max(1, Number(boardArg?.split("=")[1] || 200));

const words = fs.readFileSync(DATA, "utf8").trim().split(/\r?\n/);

const buildStart = performance.now();
const trie = buildTrie(words);
const buildMs = performance.now() - buildStart;

const random = mulberry32(0xb0661e);
for (let i = 0; i < 10; i += 1) {
  solveBoard(generateBoard(random, DICE_4X4), trie);
}

const times = [];
const wordCounts = [];
const maxScores = [];
for (let i = 0; i < BOARDS; i += 1) {
  const board = generateBoard(random, DICE_4X4);
  const start = performance.now();
  const result = solveBoard(board, trie);
  times.push(performance.now() - start);
  wordCounts.push(result.wordCount);
  maxScores.push(result.maxScore);
}

times.sort((a, b) => a - b);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (values, fraction) =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))];

console.log("Boggle Lab benchmark");
console.log(`Node ${process.version} on ${process.platform} ${process.arch}`);
console.log(`Dictionary: ${words.length.toLocaleString()} words (3-16 letters)`);
console.log(`Trie build: ${buildMs.toFixed(1)} ms`);
console.log(`Boards: ${BOARDS}`);
console.log(`Solve mean: ${mean(times).toFixed(2)} ms`);
console.log(`Solve median: ${percentile(times, 0.5).toFixed(2)} ms`);
console.log(`Solve p95: ${percentile(times, 0.95).toFixed(2)} ms`);
console.log(`Solve max: ${times[times.length - 1].toFixed(2)} ms`);
console.log(`Words per board: mean ${mean(wordCounts).toFixed(1)}`);
console.log(`Max score: mean ${mean(maxScores).toFixed(1)}`);
