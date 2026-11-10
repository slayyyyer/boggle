// Builds data/enable1-3-16.txt for Boggle Lab.
//
// Upstream: ENABLE1, the Enhanced North American Benchmark Lexicon, released
// into the public domain by its authors. This script verifies the exact
// upstream bytes before filtering, so a changed source cannot slip in silently.
//
// Run with: node tools/build-wordlist.mjs
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "enable1-3-16.txt");
const SOURCE = "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt";
const EXPECTED_SOURCE_SHA256 =
  "3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89";

// Same family-friendly policy as Word Chomp. Slurs and strong profanity only.
// This is the only editorial filter applied to ENABLE1; it is documented in
// data/README.md and in the site's "How it works" dialog.
const BLOCKED = new Set(
  `
arse ass asses bastard bastards bitch bitches blowjob blowjobs chink chinks
cock cocks coon coons cum cunt cunts dick dicks dildo dildos dyke dykes fag
faggot faggots fags fuck fucked fucker fuckers fuckin fucking fucks gook gooks
handjob handjobs hoe hoes jizz kike kikes nazi nazis negro negroes nigga
niggas nigger niggers piss pissed pisses pissing porn porno pornos rape raped
rapes raping rapist rapists retard retards shit shits shitting shitty slut
sluts slutty spic spics tit tits titties titty twat twats wetback wetbacks
whore whores wop wops
`
    .trim()
    .split(/\s+/)
);

async function download(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "boggle-lab/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw new Error(
    `ENABLE1 download failed after 4 attempts: ${lastError?.cause?.code || lastError?.message}. ` +
      "Download the file yourself and rerun with --source=path/to/enable1.txt"
  );
}

const sourceArg = process.argv.find((arg) => arg.startsWith("--source="))?.slice(9);
const bytes = sourceArg
  ? await fs.readFile(path.resolve(ROOT, sourceArg))
  : await download(SOURCE);
const sourceSha = crypto.createHash("sha256").update(bytes).digest("hex");
if (sourceSha !== EXPECTED_SOURCE_SHA256) {
  throw new Error(
    `ENABLE1 checksum changed.\n  expected ${EXPECTED_SOURCE_SHA256}\n  received ${sourceSha}\n` +
      "Review the new source before updating this script."
  );
}

const allRows = bytes
  .toString("utf8")
  .trim()
  .split(/\r?\n/)
  .filter((line) => /^[a-z]+$/.test(line));

const inRange = allRows.filter((word) => word.length >= 3 && word.length <= 16);
const blocked = inRange.filter((word) => BLOCKED.has(word));
const words = inRange
  .filter((word) => !BLOCKED.has(word))
  .sort();

const body = `${words.join("\n")}\n`;
const outSha = crypto.createHash("sha256").update(body).digest("hex");

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, body, "utf8");

const byLength = {};
for (const word of words) byLength[word.length] = (byLength[word.length] || 0) + 1;

console.log(`Upstream rows:       ${allRows.length}`);
console.log(`3-16 before filter:  ${inRange.length}`);
console.log(`Blocked terms:       ${blocked.length}`);
console.log(`Shipped words:       ${words.length}`);
const longest = words.reduce((maximum, word) => Math.max(maximum, word.length), 0);
console.log(`Longest word:        ${longest} letters`);
console.log(`File size:           ${Buffer.byteLength(body)} bytes`);
console.log(`SHA-256:             ${outSha}`);
console.log("Length distribution:", byLength);
console.log(`Wrote ${OUT}`);
