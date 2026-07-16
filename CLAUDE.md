# SapiAR - CLAUDE.md

This file is the source of truth for Claude Code. Every architectural and data-spec decision documented here was made deliberately, based on the hiring task issued by Sapios (see `GOAL.md`). Do not propose alternatives to decisions already made unless a concrete problem justifies it.

---

## What is SapiAR

SapiAR is a **dual-camera + GPS data collection prototype**, built as a technical hiring exercise for Sapios ("Automated Road Test System" — sapios.io). It is not a product; it is a focused demonstration of one core subsystem: **simultaneous front/back camera recording with hardware-accurate, synchronized GPS logging and gap interpolation**.

**Core principle (drives every architectural decision in this repo):**

> Anything that touches a hardware timestamp or a raw sample buffer lives in native code (Swift), on the native thread, with zero bridge/JSI hops before the value is captured. Everything downstream of an already-captured timestamp (interpolation, CSV assembly, session bookkeeping, UI) lives in RN/Expo TypeScript. The boundary is never blurred for convenience.

Any change that moves timestamp _generation_ into JS, or that reads `Date()` instead of the hardware clock, violates this principle and must be rejected.

---

## Tooling

**Package manager: npm.** Not pnpm. Metro's bundler still assumes a flat, hoisted `node_modules` by default, and pnpm's symlink-based layout requires extra config (`node-linker=hoisted` or Metro resolver flags) to work reliably with Expo/RN. That setup risk buys nothing here: this is a small single-app repo, not a monorepo, so pnpm's actual advantages (install speed, disk dedup) don't apply. Optimize for "clone and build with zero surprises," not for tooling consistency with unrelated projects.

---

## Architecture

| Layer                                       | Technology                                                                          | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video capture (front + back)                | `react-native-vision-camera` v5 (`AVCaptureMultiCamSession` under the hood)         | Simultaneous dual recording to `.mov`, live preview. v5's imperative Nitro API, not the old `<Camera>` component. Camera permission via `ios.infoPlist.NSCameraUsageDescription` (v5 has no config plugin). Device combination is whatever the library reports as hardware-supported — never construct one manually. **Multi-cam negotiation requires explicit intent**: without `resolutionBias` + `binned: false` per connection, the session silently negotiates a low-res binned format (640×480 on iPhone 12 Pro) regardless of target resolution set on the output — confirmed via 5 negative experiments, checkpoint 8. **`setOutputSettings()` is broken under `AVCaptureMultiCamSession`** — throws an uncatchable NSException in every tested configuration; never call it. The default codec is already HEVC/hvc1 on this hardware (verified by probing recorded files), so this isn't a quality loss, just an API to avoid. Full v5 API notes: README.md Decision Log, checkpoints 2 and 8. |
| Frame timestamps                            | Custom native camera output — `NativeCameraOutput` protocol + standalone Nitro spec | `FrameTimestampController` per camera implements vision-camera v5's officially documented `NativeCameraOutput` extension point directly (not the Frame Processor Plugin path, which requires a per-frame JS worklet). Captures `presentationTimeStamp` on the native capture thread, applies a once-per-session host-clock→Unix-ms anchor, buffers under lock. Zero JS in the per-frame path. Full reasoning + nitrogen constraint: README.md Decision Log, checkpoint 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GPS                                         | Expo Module API (Swift)                                                             | `CLLocationManager`, `desiredAccuracy = kCLLocationAccuracyBest`, captures hardware `location.timestamp`. Native emits raw values + a hardware-error signal only — `quality_flag` classification is TS's job (see Data Spec below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GPS gap interpolation                       | TypeScript                                                                          | Pure function on already-timestamped data. Detects gaps above threshold, linearly interpolates between bounding real points.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CSV assembly, session folder, metadata.json | TypeScript                                                                          | Buffers frame/GPS rows in memory, flushes periodically (not per-row).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Record UI (preview, record button, timer)   | RN + Expo                                                                           | No precision logic. This is `GOAL.md`'s "minimal UI" — nothing beyond preview, button, timer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Debug/session-review screen                 | RN + Expo + `react-native-maps`                                                     | Not part of the evaluated UI. Separate screen, reached after recording stops: GPS track (real vs. interpolated, color-coded), counts, gap list. Read-only over already-written session data — never writes or influences the recording flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

- **Why RN instead of fully native:** the critical path (timestamp capture) is 100% native either way. RN buys orchestration reuse and a legible native-vs-convenience boundary — that separation is itself part of what's being evaluated.
- **Native capture does minimum work per frame/update** (extract + buffer, nothing else) — a conscious choice verified empirically against expected frame count.
- **Debug screen instead of a separate BO:** cheap, available during development, gives visual proof of correctness a raw CSV doesn't.

---

## Data Spec (source of truth: `GOAL.md`)

Do not paraphrase or drift from this table. `GOAL.md` is Sapios's literal spec; treat it as immutable requirements, not a suggestion.

### `{epochMs}_FrameData.csv`

| Column      | Rule                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `Timestamp` | Unix ms, from `CMSampleBuffer.presentationTimeStamp`, converted — never `Date()` at write time |
| `Source`    | `Front` or `Back`                                                                              |

### `{epochMs}_LocationData.csv`

| Column                                       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Timestamp_unix_ms`                          | Unix ms from `CLLocation.timestamp` (hardware). **Exception: `-1` on `ERROR` rows** — `GOAL.md` specifies "all numeric fields = `-1`" for the sentinel row, which includes this one. The real error timestamp (if captured internally for stream ordering) is not preserved in the CSV output — don't "helpfully" keep it, that contradicts the literal spec. **Not a unique row identifier.** `GOAL.md` §3 mandates "every available update" — two fixes can legitimately round to the same ms, or CoreLocation can redeliver. Row identity is positional (index in the array/file), never derived from timestamp. Any code (UI keys, lookups, dedup logic) that assumes timestamp uniqueness is wrong — found and fixed once already in `session-debug.tsx` (checkpoint 9), don't reintroduce the assumption elsewhere. |
| `Lat`, `Long`                                | Decimal degrees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Speed_m_s`                                  | `-1` if unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Course_deg`                                 | `-1` if unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CourseAccuracy_deg`                         | `-1` if unavailable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `HorizontalAccuracy_m`, `VerticalAccuracy_m` | Metres                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `is_interpolated`                            | `0` real, `1` synthetic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `quality_flag`                               | `OK` (≤20m accuracy) / `LOW_ACCURACY` (>20m) / `ERROR` (hardware failure, all numeric fields `-1`, `is_interpolated=0`) / `INTERP`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Never leave a gap in the file.** A GPS error still produces a sentinel row. A GPS silence above the gap threshold still produces interpolated rows. The CSV is a continuous stream by construction, not by luck.

### Session folder

```
{epochMs}_Session/
├── {epochMs}_FrontVideo.mov
├── {epochMs}_BackVideo.mov
├── {epochMs}_FrameData.csv
├── {epochMs}_LocationData.csv
└── metadata.json
```

`{epochMs}` = unix ms at the moment recording starts. Same value seeds every filename in the session — this is what makes the folder self-describing and sortable, and it is generated once, in one place, then threaded through every writer (never regenerated per-file).

---

## Coding Agent

This project uses **Ponytail** in `full` mode as a discipline layer — apply YAGNI before writing any code. Rung 5 ("already-installed dependency") covers `react-native-vision-camera`, `react-native-maps`, Expo Modules API, and any Expo SDK package already in `package.json`.

This project uses **Superpowers** for planning and execution discipline. See `AGENTS.md` for command usage.

---

## Code Standards

All code, variable/function names, and comments in **English**. This includes Swift, Kotlin stubs, and TypeScript.

**TSDoc for TypeScript, standard `///` doc comments for Swift.** Comment the _why_, not the _what_ — especially for any deliberate precision/throughput tradeoff (buffering strategy, flush intervals, interpolation thresholds).

```ts
/**
 * Flushes the in-memory frame buffer to FrameData.csv.
 * Batched (not per-frame) to avoid blocking the JS thread during
 * simultaneous dual-camera capture. See CLAUDE.md Architecture table.
 */
export function flushFrameBuffer(buffer: FrameRow[]): void { ... }
```

**No comments that restate what the code already says.** This is a hard rule, not a style preference — a comment earns its place only if it explains a _why_ that isn't visible in the code (a tradeoff, a non-obvious constraint, a reason an alternative was rejected). If deleting the comment loses no information, delete it.

```ts
// BAD — restates the code, adds nothing
// Set loading to true
setLoading(true)

// BAD — restates the function signature in prose instead of explaining a tradeoff
/**
 * Gets the frame buffer.
 * @returns the frame buffer
 */
function getFrameBuffer(): FrameRow[] { ... }

// BAD — narrates every trivial line of an obvious loop
// Loop through the rows
for (const row of rows) {
  // Push to array
  buffer.push(row)
}

// GOOD — explains a constraint the code itself can't show
// Capped at 500 rows before forcing a flush — larger batches were
// observed to visibly drop frames during dual-camera capture.
if (buffer.length > 500) flush(buffer)
```

Before marking any task complete, do a pass specifically to delete comments that fail this test — this is part of what `/ponytail-review` checks, not just the logic.

**No `any`** in TypeScript — use `unknown` and narrow it.

**Named exports only** in TS, except React components (default export required by Expo Router / RN screens).

**Formatting:** Prettier defaults for TS (no semicolons, single quotes). `swift-format` defaults for Swift — do not hand-roll a style.

**Never read `Date()` as a substitute for a hardware timestamp**, anywhere in the codebase, even in a test or a TODO. If a hardware timestamp is genuinely unavailable, that is a `quality_flag = ERROR` row, not a `Date()` fallback.

---

## Repo Structure

```
SapiAR/
├── App.tsx                       # composition root — hooks + record/debug switch, 77 lines
├── app/
│   ├── components/                # screen-agnostic, reusable presentational kit
│   │   ├── Glyph/                 # Glyph.tsx, Glyph.styles.ts, index.ts
│   │   ├── InfoRow/                # InfoRow.tsx, InfoRow.styles.ts, index.ts
│   │   ├── InfoSection/            # InfoSection.tsx, InfoSection.styles.ts, index.ts
│   │   └── DataCard/               # DataCard.tsx, DataCard.styles.ts, index.ts
│   ├── record/                    # the evaluated "minimal UI" (GOAL.md §7)
│   │   ├── camera.constants.ts    # DEFAULT_FPS
│   │   ├── recordScreen.styles.ts
│   │   ├── useSessionEvents.ts    # event log + toast + recordEvent
│   │   ├── useCameraPipeline.ts   # bring-up, config ladder, listeners, health, teardown
│   │   ├── useRecording.ts        # record/stop toggle + timer
│   │   └── RecordScreen.tsx       # presentational only
│   └── debug/                     # post-recording viewer, explicitly secondary
│       ├── sessionDebug.constants.ts
│       ├── sessionDebug.styles.ts
│       ├── useSessionBrowser.ts   # list/open/parse/delete a session
│       ├── SessionDebugScreen.tsx # session list + swipe-to-delete
│       ├── DebugSettingsSheet.tsx # FPS picker modal
│       ├── SessionDetail.tsx      # tab switcher + virtualized row lists
│       ├── OverviewTab.tsx
│       ├── ValidationCard.tsx
│       ├── MetadataTab.tsx
│       └── EventsTab.tsx
├── modules/
│   ├── frame-timestamp-plugin/   # custom NativeCameraOutput (Swift) — see CLAUDE.md Architecture
│   │   └── ios/
│   ├── expo-gps/                 # Expo Module — GPS capture (Swift iOS, Kotlin stub)
│   │   ├── ios/
│   │   └── android/
├── src/
│   ├── session/
│   │   ├── sessionManager.ts     # generates {epochMs}, owns session folder lifecycle
│   │   ├── frameBuffer.ts        # in-memory buffer + periodic flush -> FrameData.csv
│   │   ├── locationBuffer.ts     # in-memory buffer + periodic flush -> LocationData.csv
│   │   └── metadata.ts           # metadata.json assembly
│   ├── interpolation/
│   │   └── gpsInterpolation.ts   # gap detection + linear interpolation, pure functions
│   └── csv/
│       └── csvWriter.ts          # shared CSV row formatting (both files)
├── docs/
│   ├── design/                    # per-checkpoint /brainstorming design docs
│   └── sample-output/            # real 30s+ recording, CSVs + metadata.json (no video)
├── README.md                     # includes the 200-400 word synchronization write-up
├── CLAUDE.md                     # this file
├── AGENTS.md
└── GOAL.md                       # Original Hiring Task
```

`app/record/` and `app/debug/` were split out of two originally monolithic
files (`App.tsx` at 606 lines, `session-debug.tsx` + its UI kit at 823
lines) once the pipeline was feature-complete — extraction only, verbatim
logic, per Architecture Rule #7's "no god files" now applied to screens,
not just session/CSV modules. `app/components/` holds what turned out to
be genuinely screen-agnostic presentational pieces (no hooks, no native
listeners, no lifecycle dependency), split out once a second screen
(`app/debug/`) started reusing them.

---

## Architecture Rules — Always Follow

1. **No hardware timestamp is ever generated in TypeScript.** TS only receives, interpolates, and writes already-native-timestamped data.
2. **Native capture code does the minimum possible work per frame/update.** No file I/O, no JSON serialization, no heavy computation inside the capture callback — extract, buffer, return.
3. **GPS interpolation is a pure function**, unit-testable without a device: given a sorted array of real points and a gap threshold, return the real + synthetic points merged, each correctly flagged.
4. **`epochMs` is generated once per session**, at record-start, in `sessionManager.ts`, and passed down — never re-derived per file.
5. **CSV writers never write a row without every required column populated** — missing data is `-1`, not an empty cell.
6. **Minimum complexity.** If Expo/vision-camera already solves it, do not reimplement it natively "for control." Native code is reserved for what the spec actually requires to be native (timestamps).
7. **The debug screen (`app/debug/`) never becomes the primary flow.** It reads already-written session data (CSVs/session object) for display; it never mutates or re-derives pipeline data. No rewriting rows, no recalculating classifications, no reimplementing gap detection. **Exception: deleting an entire session folder is allowed** (housekeeping, not data mutation, doesn't touch pipeline logic or influence the recording flow) as long as it's a whole-folder delete with confirmation, never a partial edit. This applies to every file under `app/debug/`, not just the top-level screen component. If it starts influencing the recording flow, that's scope creep, stop and flag it.
8. **No special-case handling for session folder collisions or partial/failed sessions.** `GOAL.md` §7 defines only a record/stop button — there is no "cancel" concept, so a partial-session cleanup path isn't a real requirement. A folder-name collision (same `epochMs` twice) requires two sessions starting in the same millisecond via human button-press, which isn't realistic — let it throw rather than adding retry/regeneration logic.
9. **No interpolation before the first real GPS fix or after the last one.** `GOAL.md`'s "never leave a gap" applies to gaps _between_ real fixes, not to extrapolating before/after the observed range — linear interpolation needs two real bounds, and fabricating position without one would be the same category of error as inventing speed/course on synthetic rows (Architecture Rule area, checkpoint 6). A few real-world seconds of no GPS data at recording start/stop is expected hardware behavior, not a spec violation.
10. **`gpsInterpolation.ts` must return real entries by the same object reference, never a clone.** `locationBuffer.ts`'s flush carry-over (last real fix of flush N re-entering flush N+1 as interpolation context) deduplicates by reference identity (`e !== carriedFix`) to avoid writing that row twice. If interpolation ever starts copying entries, this silently breaks and produces duplicate CSV rows. Both sides are pinned by tests (checkpoint 6's `toBe` reference check, checkpoint 7's duplicate-row regression test) — if you touch either module, re-run both test files, not just the one you edited.

---

## Validation Strategy

Given more time, this would be `XCTest` + `jest`. For the scope of this exercise:

- **Frame count check:** expected frames (`fps × duration × 2 cameras`) vs. actual `FrameData.csv` row count, run against a real recording — not simulated.
- **GPS continuity check:** no timestamp gap in `LocationData.csv` exceeds the interpolation threshold, across a real 30s+ walk.
- **Sentinel row check:** manually force a GPS error path (airplane mode toggle mid-recording) and confirm the `ERROR` row is written correctly, not silently dropped.
- **Visual check:** the `session-debug.tsx` map view is the fastest way to eyeball whether interpolated points land sensibly between real ones — use it during development, not just at the end.

Document actual results (not just intent) in the README.
