# Word list

`enable1-3-16.txt` is the dictionary Boggle Lab ships and loads once at page start.

- **Source:** ENABLE1 (Enhanced North American Benchmark LExicon), the plain-text word list distributed with word games and used by Word Chomp. Upstream copy: <https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt>.
- **License:** public domain. The ENABLE1 distribution states that it is released into the public domain.
- **Format:** one lowercase word per line, sorted with `LC_ALL=C`, ASCII `a–z` only, no comments.
- **Filter:** 3–16 letters inclusive. 80 blocked terms are removed with the same list Word Chomp applies. Nothing else is added, stemmed or reordered.
- **Shipped size:** 170,318 words, 1,698,337 bytes.
- **SHA-256 of the shipped file:** `332273e7f603db677679024dbdd238dcf0f8d591a74ce395e2b13cee67aa94c4`
- **SHA-256 of the upstream `enable1.txt` this was built from:** `3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89` (1,743,363 bytes, 172,823 rows).

## Rebuild

The builder pins the upstream checksum, retries the download, and writes the filtered file:

```sh
node tools/build-wordlist.mjs
```

To use an already-downloaded upstream file instead of the network:

```sh
node tools/build-wordlist.mjs --source=.refs/enable1.txt
```

Re-run `node --test tests/*.test.mjs` after regenerating. One test checks the shipped file's exact word count and checksum, so a changed dictionary fails loudly rather than silently changing every board's answer.

## Limits

- This is ENABLE1, not Hasbro's official Boggle dictionary. A word's presence or absence here is a property of this list, not a claim about standard play.
- Words with a Q not followed by U are present in ENABLE1, but no board can form them: the only Q tile is `Qu`. They are left in the file for transparency and are simply unreachable in the solver.
- The list is static and uninflected beyond what ENABLE1 contains. It has no definitions, frequencies or parts of speech.
