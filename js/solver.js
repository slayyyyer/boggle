/**
 * Boggle Lab solver.
 *
 * DOM-free on purpose: this module is imported by the browser game and by the
 * Node tests and benchmark. It knows nothing about tiles, timers or rendering.
 *
 * The solver builds a trie once, then walks every simple path (no tile reused)
 * from every starting tile. A path only continues while its prefix exists in
 * the trie, so no dictionary word can be missed and no path is sampled.
 *
 * A cell is a string: "a" for one letter, "qu" for the Qu tile. Qu therefore
 * advances the trie by two characters, and a word's score uses its letter
 * count, not its tile count.
 */

/** Standard Boggle scoring. Change this table and everything follows. */
export const SCORE_BY_LENGTH = Object.freeze({
  3: 1,
  4: 1,
  5: 2,
  6: 3,
  7: 5,
  8: 11,
});

export const MIN_WORD_LENGTH = 3;

export function scoreWord(word) {
  if (word.length >= 8) return SCORE_BY_LENGTH[8];
  return SCORE_BY_LENGTH[word.length] || 0;
}

class TrieNode {
  constructor() {
    // Most trie nodes have exactly one child. Storing that single edge inline
    // keeps the 170k-word trie small; only branching nodes allocate a Map.
    this.singleChar = "";
    this.singleChild = null;
    this.children = null;
    this.word = null;
  }
}

function childFor(node, char) {
  if (node.singleChild) {
    return node.singleChar === char ? node.singleChild : null;
  }
  if (node.children) return node.children.get(char) || null;
  return null;
}

function addChild(node, char, child) {
  if (!node.singleChild && !node.children) {
    node.singleChar = char;
    node.singleChild = child;
    return;
  }
  if (node.singleChild) {
    const children = new Map();
    children.set(node.singleChar, node.singleChild);
    children.set(char, child);
    node.children = children;
    node.singleChar = "";
    node.singleChild = null;
    return;
  }
  node.children.set(char, child);
}

/** Build a trie from an iterable of lowercase words. */
export function buildTrie(words) {
  const root = new TrieNode();
  for (const raw of words) {
    const word = String(raw).toLowerCase();
    if (!/^[a-z]+$/.test(word) || word.length < MIN_WORD_LENGTH) continue;
    let node = root;
    for (let i = 0; i < word.length; i += 1) {
      const char = word[i];
      let next = childFor(node, char);
      if (!next) {
        next = new TrieNode();
        addChild(node, char, next);
      }
      node = next;
    }
    node.word = word;
  }
  return root;
}

export function trieHasWord(root, word) {
  let node = root;
  const text = String(word).toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    node = childFor(node, text[i]);
    if (!node) return false;
  }
  return Boolean(node.word);
}

export function trieHasPrefix(root, text) {
  let node = root;
  const value = String(text).toLowerCase();
  for (let i = 0; i < value.length; i += 1) {
    node = childFor(node, value[i]);
    if (!node) return false;
  }
  return true;
}

const neighborCache = new Map();

/** Adjacent tile indices for a square board of the given side. */
export function neighborsFor(side) {
  const cached = neighborCache.get(side);
  if (cached) return cached;
  if (!Number.isInteger(side) || side < 2) {
    throw new Error(`Board side must be an integer >= 2, got ${side}`);
  }
  const total = side * side;
  const neighbors = Array.from({ length: total }, () => []);
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const index = row * side + col;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const rr = row + dr;
          const cc = col + dc;
          if (rr >= 0 && rr < side && cc >= 0 && cc < side) {
            neighbors[index].push(rr * side + cc);
          }
        }
      }
    }
  }
  neighborCache.set(side, neighbors);
  return neighbors;
}

/**
 * Solve a board exactly.
 *
 * @param {string[]} cells flat row-major cells, lowercase, "qu" for Qu
 * @param {object} trie from buildTrie()
 * @param {{side?: number}} [options]
 * @returns {{
 *   side: number,
 *   words: Array<{word: string, score: number, path: number[], pathCount: number}>,
 *   byWord: Map<string, {word: string, score: number, path: number[], pathCount: number}>,
 *   wordCount: number,
 *   maxScore: number,
 *   longest: string[],
 *   byLength: Record<number, number>
 * }}
 */
export function solveBoard(cells, trie, options = {}) {
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new Error("solveBoard needs a non-empty cell array");
  }
  const side = options.side ?? Math.round(Math.sqrt(cells.length));
  if (side * side !== cells.length) {
    throw new Error(`Board has ${cells.length} cells; side ${side} does not fit`);
  }

  const neighbors = neighborsFor(side);
  const normalized = cells.map((cell) => String(cell).toLowerCase());
  for (const cell of normalized) {
    if (!/^[a-z]{1,2}$/.test(cell)) {
      throw new Error(`Invalid board cell "${cell}"; expected one letter or "qu"`);
    }
  }

  const found = new Map();
  const path = [];
  const used = new Uint8Array(cells.length);
  let maxScore = 0;

  function walk(node, index) {
    const text = normalized[index];
    let next = node;
    for (let i = 0; i < text.length; i += 1) {
      next = childFor(next, text[i]);
      if (!next) return;
    }

    path.push(index);
    used[index] = 1;

    if (next.word) {
      let entry = found.get(next.word);
      if (entry) {
        entry.pathCount += 1;
      } else {
        entry = {
          word: next.word,
          score: scoreWord(next.word),
          path: path.slice(),
          pathCount: 1,
        };
        found.set(next.word, entry);
        maxScore += entry.score;
      }
    }

    if (next.singleChild || next.children) {
      const adjacent = neighbors[index];
      for (let i = 0; i < adjacent.length; i += 1) {
        const neighbor = adjacent[i];
        if (!used[neighbor]) walk(next, neighbor);
      }
    }

    used[index] = 0;
    path.pop();
  }

  for (let index = 0; index < normalized.length; index += 1) {
    walk(trie, index);
  }

  const words = Array.from(found.values()).sort(
    (a, b) =>
      b.score - a.score ||
      b.word.length - a.word.length ||
      a.word.localeCompare(b.word)
  );

  const byLength = {};
  for (const entry of words) {
    byLength[entry.word.length] = (byLength[entry.word.length] || 0) + 1;
  }

  const longest = words
    .slice()
    .sort(
      (a, b) =>
        b.word.length - a.word.length ||
        b.score - a.score ||
        a.word.localeCompare(b.word)
    )
    .slice(0, 12)
    .map((entry) => entry.word);

  return {
    side,
    words,
    byWord: found,
    wordCount: words.length,
    maxScore,
    longest,
    byLength,
  };
}
