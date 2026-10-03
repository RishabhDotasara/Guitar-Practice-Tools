#!/usr/bin/env node
/*
 * import-ascii.mjs — turn an ASCII tab into a Tab Trainer content pack.
 *
 * This is the first stage of the content pipeline: the most common way
 * guitarists have tabs is plain text, so this converts it into the versioned
 * pack schema. A future `import-guitarpro.mjs` (using alphaTab) would output
 * the exact same shape.
 *
 * Usage:
 *   node tools/import-ascii.mjs input.txt --title "My Riff" --id my-riff \
 *        [--mode sequence|timed] [--tempo 90] [--difficulty 3] \
 *        [--license original] [--out content/packs/my-riff.json]
 *
 * String index mapping: line order is used when there are 6 lines
 * (top = high e); otherwise labels (e B G D A E) are matched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const STRINGS = [
  { name: "e", freq: 329.63 },
  { name: "B", freq: 246.94 },
  { name: "G", freq: 196.00 },
  { name: "D", freq: 146.83 },
  { name: "A", freq: 110.00 },
  { name: "E", freq: 82.41 },
];

function parseAsciiTab(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.includes("|"));
  if (!lines.length) return null;
  const bars = lines.map((l) => l.indexOf("|"));
  const labels = lines.map((l, i) => l.slice(0, bars[i]).trim());
  const bodies = lines.map((l, i) => {
    let b = l.slice(bars[i] + 1);
    const last = b.lastIndexOf("|");
    if (last !== -1) b = b.slice(0, last);
    return b;
  });

  let map;
  if (bodies.length === 6) {
    map = [0, 1, 2, 3, 4, 5];
  } else {
    map = labels.map((lab) => {
      let idx = STRINGS.findIndex((s) => s.name === lab);
      if (idx < 0) idx = STRINGS.findIndex((s) => s.name.toUpperCase() === lab.toUpperCase());
      return idx;
    });
    if (map.some((x) => x < 0)) map = bodies.map((_, i) => i);
  }

  const notes = [];
  bodies.forEach((body, row) => {
    const si = map[row];
    if (si < 0 || si > 5) return;
    let i = 0;
    while (i < body.length) {
      if (/[0-9]/.test(body[i])) {
        let j = i, num = "";
        while (j < body.length && /[0-9]/.test(body[j])) { num += body[j]; j++; }
        notes.push({ pos: i, s: si, f: parseInt(num, 10) });
        i = j;
      } else i++;
    }
  });
  if (!notes.length) return null;
  notes.sort((a, b) => a.pos - b.pos || a.s - b.s);
  return notes.map((n) => [n.s, n.f]);
}

// ---- args ----
const argv = process.argv.slice(2);
if (!argv.length) {
  console.error("Usage: node tools/import-ascii.mjs input.txt --title \"...\" --id slug [--out file.json]");
  process.exit(1);
}
const positional = argv.filter((a) => !a.startsWith("--"));
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const key = argv[i].slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    flags[key] = val;
  }
}

const inputPath = positional[0];
if (!inputPath) { console.error("Missing input file."); process.exit(1); }
const text = readFileSync(inputPath, "utf8");
const frets = parseAsciiTab(text);
if (!frets) { console.error("No notes found in that file."); process.exit(1); }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const title = flags.title || inputPath.replace(/\.[^.]+$/, "").split("/").pop();
const id = flags.id || slug(title);
const mode = flags.mode === "timed" ? "timed" : "sequence";

const entry = {
  id,
  title,
  type: "song",
  category: "song",
  difficulty: Number(flags.difficulty) || 2,
  tags: ["imported", "ascii"],
  tuning: "standard",
  mode,
  source: { format: "ascii", ref: inputPath },
  license: flags.license || "user-content",
  frets,
};
if (mode === "timed") entry.tempo = Number(flags.tempo) || 90;

const pack = {
  schemaVersion: 1,
  id: id,
  name: title,
  description: "Imported from ASCII tab.",
  author: flags.author || "Imported",
  version: "1.0.0",
  license: entry.license,
  price: { usd: 0 },
  entries: [entry],
};

const out = JSON.stringify(pack, null, 2) + "\n";
if (flags.out) {
  writeFileSync(resolve(process.cwd(), flags.out), out);
  console.error(`Wrote ${flags.out} (${frets.length} notes).`);
} else {
  process.stdout.write(out);
}
