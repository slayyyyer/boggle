# Word lists

Boggle Lab ships two dictionaries:

- `everyday-3-16.txt` — the default. 29,507 words, 256,536 bytes.
- `enable1-3-16.txt` — the opt-in full ENABLE1 list. 170,318 words, 1,698,337 bytes.

Both are one lowercase word per line, sorted with `LC_ALL=C`, ASCII `a–z` only, no comments, 3–16 letters. The same 80 blocked terms are removed from both with the list Word Chomp applies.

## Everyday list

The everyday list is the full ENABLE1 list intersected with the top 30,000 words of [Bart Massey's frequency list](https://github.com/BartMassey/wordlists), sorted by count descending and then alphabetically for ties. The frequency list is a curated “frequently used” puzzle dictionary, not a raw corpus dump.

- **Source:** [ENABLE1](https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt) (public domain) and [`freq.txt.gz`](https://raw.githubusercontent.com/BartMassey/wordlists/af52415c13af809bd8757a40f17f46e79d09583c/freq.txt.gz) from Bart Massey's `wordlists` repository.
- **Frequency source commit:** `af52415c13af809bd8757a40f17f46e79d09583c`
- **License:** ENABLE1 is public domain. Bart Massey's compilation is MIT-licensed; the everyday list is a derivative of that compilation. Full notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- **Filter:** 3–16 letters, the 80 blocked terms, and the top 30,000 frequency ranks. Nothing else is added, stemmed or reordered.
- **Shipped size:** 29,507 words, 256,536 bytes.
- **SHA-256 of the shipped file:** `29d429f0a79c9d0c585f4a86b4d60d699aecfae178f0c7c264f41baae60bea3b`
- **SHA-256 of `freq.txt.gz`:** `6ac3b50bdc3631d9755bb36a00083b68793a9419120f317ea47d9951b2ef3f3d`
- **SHA-256 of the decompressed `freq.txt`:** `f00c2c9cdabb5e47880c81ab983ed6e878301f9ea71a6743b0fce6018d439cc3`

The everyday list still contains some rare but legitimate words. It is a frequency-filtered subset, not a promise that every entry is familiar. Choose **Full ENABLE1** to play the exhaustive list.

## Full list

- **Source:** [ENABLE1](https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt) (Enhanced North American Benchmark LExicon), the plain-text word list distributed with word games and used by Word Chomp.
- **License:** public domain. The ENABLE1 distribution states that it is released into the public domain.
- **Filter:** 3–16 letters inclusive and the same 80 blocked terms. Nothing else is added, stemmed or reordered.
- **Shipped size:** 170,318 words, 1,698,337 bytes.
- **SHA-256 of the shipped file:** `332273e7f603db677679024dbdd238dcf0f8d591a74ce395e2b13cee67aa94c4`
- **SHA-256 of upstream `enable1.txt`:** `3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89` (1,743,363 bytes, 172,823 rows).

## Rebuild

The builder pins both upstream checksums, retries the downloads, and writes both files:

```sh
node tools/build-wordlist.mjs
```

To use already-downloaded sources instead of the network:

```sh
node tools/build-wordlist.mjs --source=.refs/enable1.txt --freq-source=.refs/freq.txt.gz
```

Re-run `node --test tests/*.test.mjs` after regenerating. Tests check both shipped files' exact word counts and checksums, the everyday list's subset relationship, and a regression board.

## Limits

- Neither list is Hasbro's official Boggle dictionary. A word's presence or absence is a property of these lists, not a claim about standard play.
- The everyday list is frequency-filtered, but frequency is not the same as familiarity. Ambiguous entries remain possible.
- Words with a Q not followed by U are in ENABLE1, but no board can form them: the only Q tile is `Qu`. They are unreachable in the solver.
- The lists have no definitions or parts of speech.
