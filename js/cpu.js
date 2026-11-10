/**
 * CPU opponent model.
 *
 * The CPU knows the exact solved word list, so the interesting question is not
 * "can it see the answer" but "how often does it find each word, and how does
 * it spend the clock". Strength is a parameter, not a pretend-human heuristic.
 *
 * Each attempt costs a fixed number of seconds. A candidate word is found with
 * a probability that falls with word length and rises with skill. If the roll
 * fails, the time is still spent. Near the end of a head-to-head round the CPU
 * switches from "maximise expected points" to "protect the lead" or "chase":
 *
 *  - ahead and <= 30s left: only attempt words with p >= 0.60; idle otherwise;
 *  - behind and <= 45s left: take the highest expected points, accepting risky
 *    8+ letter attempts because only a big swing can win;
 *  - otherwise: sample from the top expected-value candidates for variety.
 *
 * This is a documented heuristic, not an exact game-theoretic solve. It never
 * sees the player's words, only the score gap.
 */

export const PROTECT_WINDOW_SECONDS = 30;
export const CHASE_WINDOW_SECONDS = 45;
export const SAFE_PROBABILITY = 0.6;

export const CPU_PRESETS = Object.freeze({
  casual: Object.freeze({
    id: "casual",
    label: "Casual",
    skill: 0.35,
    attemptSeconds: 4.2,
    blurb: "Sees fewer words and takes longer over each one.",
  }),
  sharp: Object.freeze({
    id: "sharp",
    label: "Sharp",
    skill: 0.6,
    attemptSeconds: 3.2,
    blurb: "A steady opponent with a reasonable eye for long words.",
  }),
  ruthless: Object.freeze({
    id: "ruthless",
    label: "Ruthless",
    skill: 0.85,
    attemptSeconds: 2.4,
    blurb: "Fast, accurate, and willing to hunt the 11-point words.",
  }),
});

export const CPU_PRESET_LIST = Object.freeze(Object.values(CPU_PRESETS));

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Per-attempt find probability for a word of this letter length. */
export function successProbability(length, skill) {
  return clamp(0.12 + 0.8 * skill - 0.03 * (length - 3), 0.05, 0.97);
}

/**
 * Choose one attempt.
 *
 * @param {{
 *   available: Array<{word: string, score: number}>,
 *   preset: {skill: number, attemptSeconds: number},
 *   playerScore: number,
 *   cpuScore: number,
 *   timeLeft: number,
 *   random?: () => number
 * }} input
 * @returns {null | {
 *   idle?: boolean,
 *   word?: string,
 *   score?: number,
 *   probability?: number,
 *   costSeconds: number,
 *   intent: "protect" | "chase" | "normal"
 * }}
 */
export function chooseCpuAttempt({
  available,
  preset,
  playerScore,
  cpuScore,
  timeLeft,
  random = Math.random,
}) {
  if (!available || available.length === 0 || timeLeft <= 0) return null;

  const candidates = available.map((entry) => {
    const probability = successProbability(entry.word.length, preset.skill);
    return {
      word: entry.word,
      score: entry.score,
      probability,
      expected: probability * entry.score,
    };
  });

  const protecting = cpuScore > playerScore && timeLeft <= PROTECT_WINDOW_SECONDS;
  const chasing = cpuScore < playerScore && timeLeft <= CHASE_WINDOW_SECONDS;

  if (protecting) {
    const safe = candidates
      .filter((candidate) => candidate.probability >= SAFE_PROBABILITY)
      .sort(
        (a, b) =>
          b.probability - a.probability ||
          b.expected - a.expected ||
          a.word.localeCompare(b.word)
      );
    if (safe.length === 0) {
      return { idle: true, costSeconds: 1.1, intent: "protect" };
    }
    const pick = safe[0];
    return {
      word: pick.word,
      score: pick.score,
      probability: pick.probability,
      costSeconds: preset.attemptSeconds,
      intent: "protect",
    };
  }

  if (chasing) {
    candidates.sort(
      (a, b) =>
        b.expected - a.expected ||
        b.score - a.score ||
        a.word.localeCompare(b.word)
    );
    const pick = candidates[0];
    return {
      word: pick.word,
      score: pick.score,
      probability: pick.probability,
      costSeconds: preset.attemptSeconds,
      intent: "chase",
    };
  }

  candidates.sort(
    (a, b) =>
      b.expected - a.expected ||
      b.score - a.score ||
      a.word.localeCompare(b.word)
  );
  const top = candidates.slice(0, Math.min(8, candidates.length));
  const weights = top.map((candidate) => Math.max(0.001, candidate.expected ** 2));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  let pick = top[top.length - 1];
  for (let i = 0; i < top.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) {
      pick = top[i];
      break;
    }
  }

  return {
    word: pick.word,
    score: pick.score,
    probability: pick.probability,
    costSeconds: preset.attemptSeconds,
    intent: "normal",
  };
}
