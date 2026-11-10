// Builds the two shipped Boggle Lab word lists.
//
// ENABLE1 is public domain. The everyday list is ENABLE1 intersected with the
// top 30,000 entries of Bart Massey's MIT-licensed frequency list. Both
// upstream files are checksum-pinned so a changed source cannot slip in
// silently.
//
// Run with: node tools/build-wordlist.mjs
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_OUT = path.join(ROOT, "data", "enable1-3-16.txt");
const EVERYDAY_OUT = path.join(ROOT, "data", "everyday-3-16.txt");
const ENABLE1_SOURCE = "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt";
const EXPECTED_ENABLE1_SHA256 =
  "3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89";
const FREQ_SOURCE =
  "https://raw.githubusercontent.com/BartMassey/wordlists/af52415c13af809bd8757a40f17f46e79d09583c/freq.txt.gz";
const EXPECTED_FREQ_GZ_SHA256 =
  "6ac3b50bdc3631d9755bb36a00083b68793a9419120f317ea47d9951b2ef3f3d";
const EXPECTED_FREQ_TEXT_SHA256 =
  "f00c2c9cdabb5e47880c81ab983ed6e878301f9ea71a6743b0fce6018d439cc3";
const EVERYDAY_RANK = 30_000;

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

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function download(url, label) {
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
    `${label} download failed after 4 attempts: ${lastError?.cause?.code || lastError?.message}`
  );
}

function argValue(name) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const sourceArg = argValue("source");
const freqArg = argValue("freq-source");

const enableBytes = sourceArg
  ? await fs.readFile(path.resolve(ROOT, sourceArg))
  : await download(ENABLE1_SOURCE, "ENABLE1");
const enableSha = sha256(enableBytes);
if (enableSha !== EXPECTED_ENABLE1_SHA256) {
  throw new Error(
    `ENABLE1 checksum changed.\n  expected ${EXPECTED_ENABLE1_SHA256}\n  received ${enableSha}\n` +
      "Review the new source before updating this script."
  );
}

const freqBytes = freqArg
  ? await fs.readFile(path.resolve(ROOT, freqArg))
  : await download(FREQ_SOURCE, "Frequency list");
const freqIsGzip = Buffer.isBuffer(freqBytes) && freqBytes[0] === 0x1f && freqBytes[1] === 0x8b;
if (freqIsGzip && sha256(freqBytes) !== EXPECTED_FREQ_GZ_SHA256) {
  throw new Error(
    `Frequency gzip checksum changed.\n  expected ${EXPECTED_FREQ_GZ_SHA256}\n  received ${sha256(freqBytes)}\n` +
      "Review the new source before updating this script."
  );
}
const freqText = freqIsGzip ? zlib.gunzipSync(freqBytes).toString("utf8") : freqBytes.toString("utf8");
const freqTextSha = sha256(freqText);
if (freqTextSha !== EXPECTED_FREQ_TEXT_SHA256) {
  throw new Error(
    `Frequency list checksum changed.\n  expected ${EXPECTED_FREQ_TEXT_SHA256}\n  received ${freqTextSha}\n` +
      "Review the new source before updating this script."
  );
}

const allRows = enableBytes
  .toString("utf8")
  .trim()
  .split(/\r?\n/)
  .filter((line) => /^[a-z]+$/.test(line));

const inRange = allRows.filter((word) => word.length >= 3 && word.length <= 16);
const blocked = inRange.filter((word) => BLOCKED.has(word));
const fullWords = inRange
  .filter((word) => !BLOCKED.has(word))
  .sort();

const freqRows = freqText
  .trim()
  .split(/\r?\n/)
  .map((line) => {
    const match = line.match(/^([a-z]+)\s+(\d+)$/);
    if (!match) throw new Error(`Bad frequency row: ${line}`);
    return { word: match[1], count: Number(match[2]) };
  });
freqRows.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
const everydayRanked = new Set(freqRows.slice(0, EVERYDAY_RANK).map((row) => row.word));
const everydayWords = fullWords.filter((word) => everydayRanked.has(word));

function listBody(words) {
  return `${words.join("\n")}\n`;
}

function report(name, outPath, words, body) {
  console.log(`${name}:`);
  console.log(`  Words:      ${words.length}`);
  console.log(`  File size:  ${Buffer.byteLength(body)} bytes`);
  console.log(`  SHA-256:    ${sha256(body)}`);
  console.log(`  Wrote:      ${outPath}`);
}

const fullBody = listBody(fullWords);
const everydayBody = listBody(everydayWords);

await fs.mkdir(path.dirname(FULL_OUT), { recursive: true });
await fs.writeFile(FULL_OUT, fullBody, "utf8");
await fs.writeFile(EVERYDAY_OUT, everydayBody, "utf8");

console.log(`ENABLE1 upstream rows: ${allRows.length}`);
console.log(`3-16 before filter:   ${inRange.length}`);
console.log(`Blocked terms:        ${blocked.length}`);
report("Full ENABLE1", FULL_OUT, fullWords, fullBody);
console.log(`Frequency rows:       ${freqRows.length}`);
report(`Everyday (top ${EVERYDAY_RANK.toLocaleString()})`, EVERYDAY_OUT, everydayWords, everydayBody);
