# Boggle Lab

A 4×4 Boggle game backed by a complete solver. Every board's full word list, one legal path per word, the number of distinct paths, and the exact maximum score are computed — not sampled, not estimated.

**Play online:** <https://slayyyyer.github.io/boggle/>

The page is vanilla HTML, CSS and JavaScript in one folder. No framework, no build step, no dependencies, no backend, no analytics. The only runtime requests are the page itself, its local assets, and the local word list.

## Play

- **Daily board** — seeded from the UTC date, so every browser gets the same sixteen tiles. It changes at UTC midnight.
- **Random board** — a fresh board from the classic 16-die set.
- **Opponent** — solo, or a CPU at Casual, Sharp or Ruthless strength.
- **Round** — 3:00 by default; 1:00, 2:00 and 5:00 are selectable.
- Enter words by tapping adjacent tiles, dragging across them, or typing in the word box. `Enter` submits, `Escape` clears, `Backspace` removes the last selected tile. Every tile is a button, so Tab and Enter/Space also work.
- A tile can be used once per word. Words must be at least three letters. Qu is printed on one tile and counts as two letters. Each distinct word counts once, even if several paths spell it.
- Scoring is the visible table: 3–4 letters = 1, 5 = 2, 6 = 3, 7 = 5, 8+ = 11.
- Invalid words, words not on the board, short words and duplicates are rejected immediately in the live message.
- After the round, the results screen shows your words, every missed word sorted by score, your score against the board's exact maximum, and the percentage found. Click any word — including a missed one — to trace its path on the board.
- Sound is off by default. If enabled, it is synthesized with the Web Audio API; there are no audio files. Options and the sound preference are kept in `localStorage` only.

## The solver

`js/solver.js` is DOM-free and is imported by the browser game, the Node tests and the benchmark.

1. Build a trie from the word list once, at load.
2. From each of the sixteen starting tiles, walk every simple path over the eight neighbours. A tile cannot appear twice in a path.
3. Only continue while the current prefix exists in the trie. That pruning is exact: it can drop a path only when no dictionary word can begin with it.
4. Record each distinct word once, along with the first path found and the number of distinct paths that spell it.

The result is exact for the shipped word list and that board. It is not a sample, a beam search or a heuristic. If a word is in the dictionary and can be spelled on the board, the solver finds it.

Guarantees and limits:

- Exact for **this dictionary**, not for every English dictionary or Hasbro's official Boggle list.
- One path is stored per word for display; the path count is the full number of distinct simple paths that spell that word.
- The walk is exponential in the worst case because the board has many simple paths. The trie prunes it to a small fraction in practice; a typical 4×4 board is well under a millisecond here (see [Benchmarks](#benchmarks)).
- `Qu` advances the trie by two characters but is one tile and one move. A word's score uses its letter count, so `QUIT` is four letters and one point.
- The solver and `generateBoard` take a square side and a die list. Only the 4×4 board and its dice ship in the UI.

The scoring table is one exported constant, `SCORE_BY_LENGTH`, so changing it changes the UI, the CPU and the results together.

## Word list

The shipped list is `data/enable1-3-16.txt`:

- **Source:** ENABLE1 (Enhanced North American Benchmark LExicon), the same public-domain upstream Word Chomp builds from. Upstream copy: <https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt>.
- **License:** public domain.
- **Filter:** 3–16 letters, ASCII `a–z`, with the same 80-word blocked-terms list Word Chomp applies. Nothing is added, stemmed or reordered.
- **Shipped size:** 170,318 words, 1,698,337 bytes.
- **SHA-256:** `332273e7f603db677679024dbdd238dcf0f8d591a74ce395e2b13cee67aa94c4`
- **Upstream SHA-256:** `3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89`

`data/README.md` has the rebuild command and the full provenance. `node tools/build-wordlist.mjs` pins the upstream checksum, retries the download, and writes the filtered file. A test also pins the shipped word count and hash.

ENABLE1 contains words with a Q not followed by U. They are left in the file, but no board can form them: the only Q face is `Qu`. That is a property of this game, not a missing word check.

## CPU model

The CPU knows the complete solved list. Strength is therefore a parameter, not a performance of “thinking”. It never sees the player's words or score history beyond the current score gap.

Each attempt costs time. A candidate word of length `L` succeeds with probability

```
clamp(0.12 + 0.8 * skill - 0.03 * (L - 3), 0.05, 0.97)
```

so longer words are harder and higher skill raises the chance. A failed attempt still spends its time.

| Preset | Skill | Seconds per attempt |
| --- | ---: | ---: |
| Casual | 0.35 | 4.2 |
| Sharp | 0.60 | 3.2 |
| Ruthless | 0.85 | 2.4 |

The choice of word depends on the match state:

- **Ahead, 30 seconds or fewer left** — attempt only words with success probability at least 0.60, preferring the safest and then the highest expected score. If no word qualifies, idle instead of risking the lead.
- **Behind, 45 seconds or fewer left** — take the highest expected points, including risky 8+ letter words, because only a swing can win.
- **Otherwise** — sample from the top eight expected-value candidates, weighted by expected points squared, for variety.

This is a documented heuristic, not an exact game-theoretic solve. Both players may score the same word; the CPU's score is its own collection, not a claim of exclusive ownership. The full solved list is what makes the exact results and the CPU possible; the CPU's limitations are its probabilities and clock, not its knowledge.

## Daily board and dice

The 4×4 set is the classic 16-die “New Boggle” letter distribution. Each die has six faces; `Qu` is one face.

```
AAEEGN  ABBJOO  ACHOPS  AFFKPS
AOOTTW  CIMOTU  DEILRX  DELRVY
DISTTY  EEGHNW  EEINSU  EHRTVW
EIOSST  ELRTTY  HIMNQuU  HLNNRZ
```

The generator shuffles the dice, then rolls one face from each die. The daily seed is FNV-1a over `boggle-lab:YYYY-MM-DD` using the UTC date, fed to `mulberry32`. The label and the seed use UTC, so the same calendar date gives the same board in every timezone. A random board uses `crypto.getRandomValues` for its seed.

Only 4×4 ships. A 5×5 board would need its own 25-die set and layout; the solver itself already accepts a side parameter.

## Board lab

The lab runs in the browser against the full dictionary.

- **Sample 250 boards** — seeded random boards, solved exactly, with histograms of word count and exact maximum score, plus median, mean and range. This is a measured sample of boards, not a census.
- **Hill climb** — starts from the best sampled board (or a fresh board) and tries 300 random two-tile swaps. It keeps a swap only when the exact maximum rises, or ties with more words. The best board can be played immediately.
- Every result is labelled **best found**. A local search cannot prove a board is optimal, and the README does not claim it is.

## Accessibility and mobile

- All play controls are native buttons or inputs. Tiles expose labels such as “M, row 1, column 1”, selection order is reflected in `aria-pressed` and the visible order badge, and the live message is a polite status region.
- Visible focus is preserved, including on tiles. `prefers-reduced-motion` removes animations and smooth scrolling.
- The board uses pointer capture and `touch-action: none`, so a drag selects tiles instead of scrolling the page. At 375px the board measured 318.8px wide with 75.2px tiles and no horizontal overflow.
- Controls are at least 44px tall where they are primary targets. The timer pauses while the tab is hidden, and resumes when it returns.
- No physical phone was available for a device benchmark. The 375px layout and pointer logic were exercised in desktop Chromium; the solver is fast enough that a phone should not be the constraint, but that is an expectation, not a measured claim.

## Run it

ES modules and the word-list `fetch` need an HTTP origin; opening `index.html` from `file://` will not load the dictionary.

```sh
node tools/serve.mjs
# http://127.0.0.1:4173/
```

or:

```sh
npm run serve
```

There is nothing to install and no build step. `package.json` exists only for the local scripts.

## Tests

```sh
npm test
# equivalent
node --test tests/*.test.mjs
```

The eight tests run with plain Node and no dependencies:

- the scoring table;
- Qu on a hand-verified 3×3 board, including path and letter-count scoring;
- repeated paths: `ABA` has 24 distinct paths and `BAB` has 20, each still counted once;
- a 40-board cross-check against a deliberately naive path enumerator;
- UTC daily seeding across a day and across timezones;
- CPU protect/chase/idle behavior;
- a fixed full-dictionary board with an exact word-count, score and joined-word SHA-256 snapshot;
- internal exactness checks over every word on a full-dictionary board.

## Benchmarks

Measured on the development machine: Node v24.20.0, win32 x64. The browser run is local Chromium on the same machine. Times vary with CPU, load and browser; these are the numbers from this build.

| Run | Boards | Trie build | Mean | Median | p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node (`node tools/benchmark.mjs --boards=200`) | 200 | 74.8 ms | 0.18 ms | 0.16 ms | 0.34 ms | 0.75 ms |
| Browser (`BoggleLab.benchmark(100)`) | 100 | 166.8 ms | 0.229 ms | 0.20 ms | 0.40 ms | 0.60 ms |

The same runs averaged 89.6 words and a 125.8 maximum score per board in Node, and 88.76 words and 122.55 in the browser. A typical board is a fraction of a millisecond; the one-off trie build is the larger cost, and it happens once at load.

```sh
npm run bench -- --boards=200
```

In the browser, after the dictionary loads:

```js
await BoggleLab.benchmark(100)
```

## Project layout

```
index.html                 home, game, results and the native how-it-works dialog
icon.svg                   app / favicon mark
assets/styles.css          Aqua visual system, responsive layout, reduced motion
js/solver.js               DOM-free trie and exact path solver
js/boards.js               classic dice, seeded generation, UTC daily seed
js/cpu.js                  documented strength and match-aware attempt model
js/app.js                  game flow, input, timer, CPU pacing, results, lab
data/enable1-3-16.txt      shipped 3–16 letter ENABLE1 list
data/README.md             word-list provenance and rebuild instructions
tools/build-wordlist.mjs   checksum-pinned list builder
tools/benchmark.mjs        Node benchmark
tools/serve.mjs            dependency-free local static server
tests/solver.test.mjs      eight Node tests
.github/workflows/pages.yml  static Pages deployment
docs/portfolio-snippet.html  drafted /projects/ card, not applied to the main site
```

## Deploying

Every push to `main` runs `.github/workflows/pages.yml`, stages only the public site files (`index.html`, `icon.svg`, `assets/`, `js/`, `data/`), uploads the Pages artifact and deploys it. In the repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow can also be run manually from the Actions tab.

The published site is <https://slayyyyer.github.io/boggle/>.

## Limits and deliberate omissions

- No backend, accounts, leaderboards or shared scores. The daily board is shared by seed, not by a server.
- No analytics and no runtime network requests after the initial page and word list. `localStorage` holds the sound preference and round options only.
- Only the 4×4 UI ships. The solver accepts another side, but there is no 5×5 dice set or layout.
- ENABLE1 is broad and includes obscure words. It is not the official Boggle dictionary; a word's presence here is a property of this list.
- The CPU is a documented probability model, not an exact game-theoretic opponent. The board lab's hill climb is a local search and is always labelled “best found.”
- The 3:00 default, the 1/2/5-minute options and the UTC daily reset are deliberate product choices, not a claim about tournament rules.
- No physical phone benchmark; the 375px layout is measured in desktop Chromium.

## Trademark

Boggle is a trademark of Hasbro. Boggle Lab is an independent, unaffiliated project; it is not sponsored or endorsed by Hasbro. The title uses “Boggle” descriptively for the 4×4 word-search game. All visuals and code here are original, and the classic dice letter distribution is factual game data rather than copied artwork.

ENABLE1 is public domain. The blocked-terms list follows Word Chomp's family-friendly filter.
