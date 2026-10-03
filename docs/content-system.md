# Tab Trainer — Content System Design

Status: draft v1 · Platform: web app / PWA · Business model: one-time purchase

This document describes how practice content is modelled, authored, imported,
versioned, licensed, shipped, and gated behind a one-time purchase. It builds
on the existing single-file app and the pack schema in `schema/pack.schema.json`.

---

## 1. Goals & constraints

- **Content is data, not code.** Today the exercises live in a `PATTERNS` object
  inside `index.html`. That must become versioned JSON so content can grow
  without shipping a new app bundle.
- **Licensing first.** We must never ship copyrighted songs we haven't licensed.
  The model has to make the legal status of every entry explicit.
- **Offline-friendly PWA.** Buy once, install, practice on a plane.
- **One-time purchase.** No subscriptions, no recurring billing. A license token
  unlocks content and keeps working offline.
- **Zero runtime dependencies.** Audio stays on-device; content is plain JSON.

## 2. Design principles

1. **Packs are versioned, additive units.** A pack is the smallest thing a user
   can own. Entries never appear outside a pack.
2. **String index is canonical.** `0 = high e … 5 = low E`, matching the app.
   Every entry may declare its own tuning; default is `"standard"`.
3. **Two playback modes.** `sequence` = play the notes in order (drills, riffs).
   `timed` = beat-aligned (songs, playback + future rhythm scoring).
4. **Import at build time, ship JSON at runtime.** Guitar Pro / MusicXML / MIDI
   import runs in Node with a parser (alphaTab); the app only ever reads JSON.
5. **Signals, not DRM.** Entitlements are signed tokens verified offline. Packs
   are readable JSON; the gate is in the UI. (Optional encryption later.)

## 3. Content model

Defined in [`schema/pack.schema.json`](../schema/pack.schema.json).

```
Pack
├─ schemaVersion: 1
├─ id, name, version (semver), author
├─ license, attribution
├─ price: { usd }
└─ entries: Entry[]

Entry
├─ id, title, type, category, difficulty (1–5), tags[]
├─ tuning: "standard" | ["E4","B3","G3","D3","A2","E2"]  (high → low)
├─ capo, tempo, timeSignature
├─ mode: "sequence" | "timed"
├─ notes: [{ string, fret, beat?, duration? }]      // explicit
│   or frets: [[string, fret], ...]                 // shorthand for sequence
├─ license?, attribution?
└─ source: { format: hand|ascii|guitarpro|musicxml|midi, ref }
```

Normalisation rules the loader applies:
- `frets` is expanded to `notes` (no `beat`/`duration`).
- `tuning` string → 6 frequencies; explicit array → parsed note names.
- `capo` shifts computed target frequencies by `capo` semitones.

Existing exercises are already migrated into real packs:
[`content/packs/core.json`](../content/packs/core.json) (original, free) and
[`content/packs/folk.json`](../content/packs/folk.json) (public-domain songs).

## 4. Repository layout

```
content/
  catalog.json          # index of packs + bundles (what the app fetches first)
  packs/
    core.json
    folk.json
schema/
  pack.schema.json      # JSON Schema (draft 2020-12)
tools/
  validate.mjs          # zero-dep validator:  node tools/validate.mjs
  import-ascii.mjs      # ASCII tab -> pack
  import-guitarpro.mjs  # (planned) alphaTab -> pack
  build-catalog.mjs     # (planned) regenerate catalog from packs/
docs/
  content-system.md     # this file
```

The app currently lives in a single `index.html`. The refactor to consume packs
is described in §7; until then the packs here are the source of truth for
content and are validated in CI.

## 5. Authoring workflow

1. **Hand-authored drills/scales** — write JSON directly, or start from an
   existing entry. Validate with `node tools/validate.mjs`.
2. **From ASCII tab** — `node tools/import-ascii.mjs riff.txt --title "..." --id riff`
3. **From Guitar Pro / MusicXML / MIDI (planned)** — a Node tool using
   [alphaTab](https://www.alphatab.net/) to read the file, then map its beats to
   `notes[]` with `beat`/`duration`, and infer string/fret (Guitar Pro and
   MusicXML already carry string/fret; MIDI does not, so it needs a
   fretboard-position search).
4. **From a user's own file (UGC)** — parsed at runtime into the same shape and
   labelled `license: "user-content"`. UGC is never redistributed by us.

Every commit that touches `content/` runs `tools/validate.mjs`. Warnings (e.g.
notes outside the 70–700 Hz detector range, high frets) are surfaced but don't
fail the build.

## 6. Import pipeline (build-time)

```
 .gp/.gpx  ─┐
 .musicxml ─┼─► alphaTab (Node) ─► Normaliser ─► validator ─► content/packs/*.json
 .mid      ─┤
 ASCII txt ─┘      import-ascii.mjs
```

Mapping rules:
- AlphaTab measures/beats → `notes[]` with `beat` (in beats) and `duration`.
- Tuning from the file → `tuning`; if non-standard, store the explicit array.
- Techniques (slides/bends/hammer-ons) are recorded later as optional note
  fields; v1 ignores them for scoring.
- MIDI with no string/fret uses a simple position search: pick the lowest
  fret position on the lowest playable string within a 4-fret hand span.

## 7. Runtime architecture (PWA)

Today the app is one HTML file. The target runtime:

```
index.html (app shell)
  → fetch /content/catalog.json
  → render free entries immediately
  → lazily fetch a pack when its entry is opened
  → cache packs in IndexedDB (offline)
service-worker.js  → cache app shell + catalog + owned packs
manifest.webmanifest → installable PWA
```

Proposed small runtime API:

```js
Content.catalog()                  // -> Catalog
Content.pack(id)                   // -> Pack (cached in IndexedDB)
Content.notes(entry, tuningTable)  // -> [{ s, f, hz, beat?, duration? }]
Content.entriesByCategory(cat)     // for menus
```

Notes on the single-file constraint:
- Over `http(s)` (PWA), `fetch("content/catalog.json")` works normally.
- For a genuinely single-file build, a `build.mjs` can inline a default pack as
  a `<script type="application/json">` block. Keep the packs as the source and
  generate the inline copy — don't hand-maintain both.

The **random-note mode stays a generator**, not content, since it is infinite.

## 8. Versioning & migrations

- `schemaVersion` is an integer per pack. The loader migrates forward:
  `migrations = { 0: pack => …, 1: pack => pack }`.
- `version` is semver per pack; the app can prompt "new entries available" when
  a newer catalog is fetched.
- Deleting/renaming pack ids requires keeping the old id in the catalog (with
  `deprecated: true`) so existing entitlements keep resolving.

## 9. Licensing tiers

| Tier | License value | Sellable? | Example |
|---|---|---|---|
| Original | `original` | Yes | Core exercises |
| Public domain | `public-domain` | Yes | Ode to Joy, Twinkle |
| Open license | `cc-by-4.0` / `cc-by-sa-4.0` | Yes, with attribution | community arrangements |
| Licensed | `proprietary` | Yes (per agreement) | an artist pack |
| User import | `user-content` | No — personal use only | a user's `.gp5` |

Policy:
- Default to original + public-domain + UGC. This makes a credible paid product
  without any licensing deals.
- `validate.mjs` warns when public-domain content is sold — legal, but confirm
  attribution and jurisdiction.
- Do not host copyrighted tabs in packs. UGC is parsed locally and stays local;
  a DMCA/abuse contact is still needed if UGC can ever be shared.
- A "songs" pack can later be licensed from publishers (HFA/mechanical) or via
  an aggregator; that is a business step, not a code change.

## 10. Commerce — one-time purchase

**Free tier** (drives conversion, keeps the app useful):
- All original core exercises, random mode, tuner, custom-tab importer.

**Paid unlock** (one-time):
- Song packs and expansion packs, advanced progress/analytics, and future packs.
- Suggested anchor: **Pro unlock — $19.99** (all current + future packs), with
  individual packs at $4.99 as an alternative. Regional pricing via Stripe.

**Flow (web / PWA):**

```
Pricing page → Stripe Checkout (hosted) → webhook
   → server signs an entitlement token (Ed25519) → redirect back with token
   → app verifies token with an embedded public key → stores in IndexedDB
   → packs in the token's scope become selectable
```

Entitlement token (JWT-like, verified offline with WebCrypto):

```json
{
  "iss": "tabtrainer",
  "sub": "cus_123",
  "packs": ["*"],          // or ["folk","scales-2"]
  "iat": 1760000000,
  "ver": 1
}
```

- "All current & future packs" is expressed as `packs: ["*"]`.
- The token is the license; it survives reinstall. Offer a "restore purchase"
  field that accepts the token or an emailed magic link.
- Verify signature offline so paid packs work with no network. The UI gate is
  sufficient at this price point; optionally encrypt pack JSON with a key
  derived from the token for stronger protection.
- **Stripe** handles cards, Apple/Google Pay, and EU VAT; enable a 14-day refund
  for EU/UK digital-goods compliance. Receipts/emails come from Stripe.
- No account required. If you add one later (progress sync), link it to the
  entitlement token.

## 11. What ships free vs paid (recommended)

| Free | Paid |
|---|---|
| Core original exercises | Traditional-song packs |
| Random note trainer | Expansion scale/mode packs |
| Chromatic / spider warmups | Full song library (licensed/UGC-shared) |
| Tuner, metronome | Progress analytics + streak history |
| Custom-tab importer | Future packs (`packs:["*"]`) |

## 12. Roadmap

**Phase 0 — content foundation (this turn)**
- [x] Pack schema + catalog
- [x] Core and public-domain packs
- [x] Validator + ASCII importer

**Phase 1 — app consumes packs**
- [ ] Refactor `index.html` to load `catalog.json` and packs (fetch + IndexedDB).
- [ ] Menu generated from `category`/`difficulty`; keep random mode as a generator.
- [ ] `timed` playback: metronome, tempo control, simple scrolling tab.
- [ ] Service worker + web manifest → installable, offline.

**Phase 2 — commerce**
- [ ] Stripe Checkout + webhook → signed entitlement token.
- [ ] Offline verification + "restore purchase".
- [ ] Pricing screen; free/paid gating in the menu.

**Phase 3 — content pipeline at scale**
- [ ] `import-guitarpro.mjs` (alphaTab) and `build-catalog.mjs`.
- [ ] `timed` songs with sections/loops and play-along scoring.
- [ ] Community/UGC sharing with reporting + DMCA process (optional).

**Phase 4 — monetisable polish**
- [ ] Progress, streaks, daily challenge.
- [ ] More packs (scales/modes, fingerstyle, blues, chord packs).
- [ ] Basic analytics + funnels; A/B the price point.

## 13. Next build steps in this repo

1. Wire `index.html` to `Content.catalog()` / `Content.pack()` and render the menu
   from packs (keep the current UI).
2. Add `manifest.webmanifest` + `service-worker.js` for offline PWA.
3. Add `tools/build-catalog.mjs` and a `package.json` with
   `npm run validate` / `npm run import`.
4. Add `tools/import-guitarpro.mjs` with alphaTab behind a dev dependency.
5. Only then build the Stripe entitlement flow.

## 14. Open decisions

- Price and scope of the one-time unlock (all-future vs fixed set).
- Whether paid packs are plaintext-gated or encrypted.
- How much song content is licensed vs UGC vs original.
- Whether to keep a single-file build (inline packs) or serve a multi-file PWA.
