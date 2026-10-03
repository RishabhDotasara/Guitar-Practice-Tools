#!/usr/bin/env node
/*
 * validate.mjs — zero-dependency content validator.
 *
 * Checks content/catalog.json and every referenced pack for:
 *   • required pack/entry fields and id formats
 *   • unique ids (within and across packs)
 *   • valid string/fret indices and note frequencies inside the detector range
 *   • catalog <-> pack consistency (paths exist, ids resolve)
 *
 * Usage:  node tools/validate.mjs
 * Exit code 1 if there are any errors (warnings alone exit 0).
 *
 * For a full JSON-Schema check, add `ajv` in CI — this script keeps the
 * repo dependency-free so it runs anywhere.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");

// display order, index 0 = high e ... 5 = low E
const STRING_FREQS = [329.63, 246.94, 196.00, 146.83, 110.00, 82.41];
const MIN_HZ = 70, MAX_HZ = 700;
const LICENSES = ["public-domain", "cc-by-4.0", "cc-by-sa-4.0", "original", "proprietary", "user-content"];
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    err(`Cannot parse ${path}: ${e.message}`);
    return null;
  }
}

function notesOf(entry) {
  if (Array.isArray(entry.notes)) return entry.notes.map((n) => ({ s: n.string, f: n.fret }));
  if (Array.isArray(entry.frets)) return entry.frets.map((p) => ({ s: p[0], f: p[1] }));
  return [];
}

const catalogPath = join(CONTENT, "catalog.json");
if (!existsSync(catalogPath)) {
  err(`Missing ${catalogPath}`);
} else {
  const catalog = readJSON(catalogPath);
  if (catalog) {
    if (catalog.schemaVersion !== 1) err(`catalog.json: schemaVersion must be 1`);
    if (!Array.isArray(catalog.packs) || !catalog.packs.length) err(`catalog.json: no packs`);

    const seenPackIds = new Set();
    const allEntryIds = new Map(); // entry id -> pack id

    for (const ref of catalog.packs || []) {
      if (!ref.id || !ID_RE.test(ref.id)) err(`catalog: bad pack id ${JSON.stringify(ref.id)}`);
      if (seenPackIds.has(ref.id)) err(`catalog: duplicate pack id ${ref.id}`);
      seenPackIds.add(ref.id);
      if (!ref.path) { err(`catalog: pack ${ref.id} has no path`); continue; }

      const packPath = join(CONTENT, ref.path);
      if (!existsSync(packPath)) { err(`catalog: pack ${ref.id} path missing: content/${ref.path}`); continue; }

      const pack = readJSON(packPath);
      if (!pack) continue;

      const where = `pack ${pack.id || ref.id}`;
      for (const field of ["schemaVersion", "id", "name", "version", "license", "entries"]) {
        if (pack[field] === undefined) err(`${where}: missing "${field}"`);
      }
      if (pack.schemaVersion !== 1) err(`${where}: schemaVersion must be 1`);
      if (pack.id !== ref.id) warn(`${where}: pack id "${pack.id}" != catalog id "${ref.id}"`);
      if (pack.license && !LICENSES.includes(pack.license)) err(`${where}: unknown license "${pack.license}"`);
      if (pack.version && !/^\d+\.\d+\.\d+$/.test(pack.version)) err(`${where}: version not semver ("${pack.version}")`);
      if (pack.license === "public-domain" && pack.price && pack.price.usd > 0) {
        warn(`${where}: selling public-domain content is legal but may be unkind; verify attribution`);
      }

      for (const entry of pack.entries || []) {
        const eid = `${where}/${entry.id}`;
        if (!entry.id || !ID_RE.test(entry.id)) err(`${eid}: bad entry id`);
        if (!entry.title) err(`${eid}: missing title`);
        if (!Number.isInteger(entry.difficulty) || entry.difficulty < 1 || entry.difficulty > 5) {
          err(`${eid}: difficulty must be 1..5`);
        }
        if (!["sequence", "timed"].includes(entry.mode)) err(`${eid}: mode must be sequence|timed`);
        if (entry.license && !LICENSES.includes(entry.license)) err(`${eid}: unknown license "${entry.license}"`);
        if (allEntryIds.has(entry.id)) err(`duplicate entry id "${entry.id}" in ${where} and ${allEntryIds.get(entry.id)}`);
        else allEntryIds.set(entry.id, where);

        const notes = notesOf(entry);
        if (!notes.length) { err(`${eid}: no notes/frets`); continue; }
        if (entry.mode === "timed") {
          for (const n of entry.notes || []) {
            if (n.beat === undefined) err(`${eid}: timed entries need "beat" on every note`);
          }
        }
        for (const { s, f } of notes) {
          if (!Number.isInteger(s) || s < 0 || s > 5) { err(`${eid}: string ${s} out of range 0..5`); continue; }
          if (!Number.isInteger(f) || f < 0 || f > 24) { err(`${eid}: fret ${f} out of range 0..24`); continue; }
          const hz = STRING_FREQS[s] * Math.pow(2, f / 12);
          if (hz < MIN_HZ || hz > MAX_HZ) {
            warn(`${eid}: ${STRING_FREQS[s].toFixed(2)}Hz + fret ${f} = ${hz.toFixed(1)}Hz outside detector range ${MIN_HZ}-${MAX_HZ}Hz`);
          }
          if (f > 12) warn(`${eid}: fret ${f} is high for a beginner exercise`);
        }
      }
    }

    // bundle references
    for (const bundle of catalog.bundles || []) {
      for (const pid of bundle.packs || []) {
        if (!seenPackIds.has(pid)) err(`catalog bundle ${bundle.id}: references unknown pack "${pid}"`);
      }
    }
  }
}

// ---- report ----
for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
