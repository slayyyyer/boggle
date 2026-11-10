/**
 * Board generation and seeded randomness.
 *
 * The 4x4 set is the classic 16-die "New Boggle" set. Each die lists its six
 * faces; "Qu" is one face, not a Q face plus a U face. The generator takes the
 * die list as an argument so another size can be added without touching the
 * solver or the UI.
 */

export const DICE_4X4 = Object.freeze([
  Object.freeze(["A", "A", "E", "E", "G", "N"]),
  Object.freeze(["A", "B", "B", "J", "O", "O"]),
  Object.freeze(["A", "C", "H", "O", "P", "S"]),
  Object.freeze(["A", "F", "F", "K", "P", "S"]),
  Object.freeze(["A", "O", "O", "T", "T", "W"]),
  Object.freeze(["C", "I", "M", "O", "T", "U"]),
  Object.freeze(["D", "E", "I", "L", "R", "X"]),
  Object.freeze(["D", "E", "L", "R", "V", "Y"]),
  Object.freeze(["D", "I", "S", "T", "T", "Y"]),
  Object.freeze(["E", "E", "G", "H", "N", "W"]),
  Object.freeze(["E", "E", "I", "N", "S", "U"]),
  Object.freeze(["E", "H", "R", "T", "V", "W"]),
  Object.freeze(["E", "I", "O", "S", "S", "T"]),
  Object.freeze(["E", "L", "R", "T", "T", "Y"]),
  Object.freeze(["H", "I", "M", "N", "Qu", "U"]),
  Object.freeze(["H", "L", "N", "N", "R", "Z"]),
]);

export const SIDE_4X4 = 4;

/** Fast, seedable PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** UTC date seed: the same day everywhere, independent of local timezone. */
export function seedForDate(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return hashString(`boggle-lab:${year}-${month}-${day}`);
}

export function dailyLabel(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function randomSeed() {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0];
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export function shuffleInPlace(items, random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const value = items[i];
    items[i] = items[j];
    items[j] = value;
  }
  return items;
}

/** Shuffle the dice, then roll one face per die. Returns lowercase cells. */
export function generateBoard(random, dice = DICE_4X4) {
  if (!Array.isArray(dice) || dice.length === 0) {
    throw new Error("generateBoard needs a non-empty die list");
  }
  const side = Math.sqrt(dice.length);
  if (!Number.isInteger(side)) {
    throw new Error(`A ${dice.length}-die set does not form a square board`);
  }
  for (const die of dice) {
    if (!Array.isArray(die) || die.length !== 6) {
      throw new Error("Every die must have exactly six faces");
    }
  }
  const shuffled = shuffleInPlace(dice.slice(), random);
  return shuffled.map((die) => {
    const face = die[Math.floor(random() * 6)];
    return face.toLowerCase();
  });
}

/** Display label for a cell: "qu" -> "Qu", otherwise uppercase. */
export function cellLabel(cell) {
  return cell === "qu" ? "Qu" : String(cell).toUpperCase();
}

/** Human path label for a tile index on a square board. */
export function cellPosition(index, side = SIDE_4X4) {
  const row = Math.floor(index / side) + 1;
  const col = (index % side) + 1;
  return `row ${row}, column ${col}`;
}
