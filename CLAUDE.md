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

| Layer                                       | Technology                                                               | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video capture (front + back)                | `react-native-vision-camera` (`AVCaptureMultiCamSession` under the hood) | Simultaneous dual recording to `.mov`, live preview. Not reimplemented — mature library, already solves multi-cam session config. **v5 note:** uses an imperative Nitro API, not the old declarative `<Camera>` component — `supportsMultiCamSessions` → `createDeviceFactory()` → `supportedMultiCamDeviceCombinations` → `createCameraSession()` → `configure()` → `start()`, with a `NativePreviewView` per camera. No Expo config plugin ships with v5; camera permission is declared via `ios.infoPlist.NSCameraUsageDescription` in `app.json` directly. Device combination selection is constrained to whatever the library reports as hardware-supported — never construct a front+back pairing manually. |
| Frame timestamps                            | Custom native camera output — `NativeCameraOutput` protocol (vision-camera v5's officially documented custom-output extension point) + standalone Nitro spec | v5's Frame Processor Plugin path routes through a synchronous JS `onFrame` worklet per frame — not a timestamp-accuracy problem (`presentationTimeStamp` would be identical either way), but a **completeness/dependency risk**: a per-frame JS worklet in the capture hot path risks backpressure-driven frame drops if it doesn't finish before the next frame, and requires `react-native-vision-camera-worklets`/`worklets` as extra dependencies. `NativeCameraOutput` avoids JS entirely in the per-frame path, eliminating that risk outright. A `FrameTimestampController` per camera implements the protocol directly and is appended to the session's `outputs` array; its `AVCaptureVideoDataOutput` delegate runs on the native capture thread, reads `presentationTimeStamp`, applies a once-per-session host-clock→Unix-ms anchor, and appends to an in-memory buffer under lock. Spec is standalone, not `extends CameraOutput` — nitrogen 0.36.1 generates uncompilable Swift for cross-module spec inheritance; returning the external `CameraOutput` HybridObject from `getCameraOutput()` is the same pattern vision-camera's own nitro-image integration uses. |
| GPS                                         | **Expo Module API** (Swift on iOS, Kotlin on Android stub)               | `CLLocationManager` with `desiredAccuracy = kCLLocationAccuracyBest`, delegate captures `location.timestamp` (hardware), plus lat/long/speed/course/accuracy fields. Chosen over a hand-rolled Turbo Module for autolinking + `expo prebuild`/EAS compatibility + a unified cross-platform TS surface.                                                                                                                                                                                                                                                                                                                                                                                                            |
| GPS gap interpolation                       | TypeScript                                                               | Operates on already-timestamped data — not time-critical. Detects gaps above threshold and linearly interpolates lat/long/speed/course between the two bounding real points.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CSV assembly, session folder, metadata.json | TypeScript                                                               | Buffers frame/GPS rows in memory, flushes periodically (not per-row) to avoid blocking the JS thread.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Record UI (preview, record button, timer)   | RN + Expo                                                                | No precision logic. Reusable across iOS/Android by construction — a deliberate cross-platform bonus, not a requirement. This is what `GOAL.md` means by "minimal UI" — nothing beyond preview, button, timer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Debug/session-review screen                 | RN + Expo (`react-native-maps` for track rendering)                      | **Not part of the evaluated "minimal UI."** A separate, explicitly-labeled screen reached after recording stops. Renders the GPS track with real vs. interpolated points color-coded, plus counts (frames front/back, GPS real/interpolated/error rows) and a list of detected gaps. Built primarily as a development/debugging aid — it doubles as stronger evidence for the README write-up than a raw CSV screenshot.                                                                                                                                                                                                                                                                                          |

**Why RN at all instead of fully native:** the critical path (frame timestamp capture, GPS hardware timestamp capture) is 100% native either way — RN does not touch it. What RN buys is orchestration-layer reuse and, more importantly, a legible separation of "what must be native for correctness" vs. "what is native only for convenience." That separation is itself the thing being evaluated — see `README.md` write-up requirement in `GOAL.md`.

**Known tradeoff:** the Frame Processor Plugin does only trivial work (extract timestamp + source, push to buffer) specifically so it never causes vision-camera to drop frames under backpressure. This is a conscious design choice, verified empirically: expected frame count (`fps × duration`) must match `FrameData.csv` row count in the sample output.

**Why a debug screen instead of a separate BO:** a standalone backoffice would be out of scope for a 2-day window and would dilute focus away from the pipeline itself, which is what's being evaluated. An in-app screen costs little, is available during development (not just at the end), and produces visual proof of correctness (interpolated points visibly filling gaps on a map) that's more convincing than inspecting a CSV by hand.

---

## Data Spec (source of truth: `GOAL.md`)

Do not paraphrase or drift from this table. `GOAL.md` is Sapios's literal spec; treat it as immutable requirements, not a suggestion.

### `{epochMs}_FrameData.csv`

| Column      | Rule                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `Timestamp` | Unix ms, from `CMSampleBuffer.presentationTimeStamp`, converted — never `Date()` at write time |
| `Source`    | `Front` or `Back`                                                                              |

### `{epochMs}_LocationData.csv`

| Column                                       | Rule                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Timestamp_unix_ms`                          | Unix ms from `CLLocation.timestamp` (hardware)                                                                                     |
| `Lat`, `Long`                                | Decimal degrees                                                                                                                    |
| `Speed_m_s`                                  | `-1` if unavailable                                                                                                                |
| `Course_deg`                                 | `-1` if unavailable                                                                                                                |
| `CourseAccuracy_deg`                         | `-1` if unavailable                                                                                                                |
| `HorizontalAccuracy_m`, `VerticalAccuracy_m` | Metres                                                                                                                             |
| `is_interpolated`                            | `0` real, `1` synthetic                                                                                                            |
| `quality_flag`                               | `OK` (≤20m accuracy) / `LOW_ACCURACY` (>20m) / `ERROR` (hardware failure, all numeric fields `-1`, `is_interpolated=0`) / `INTERP` |

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
 * simultaneous dual-camera capture. See CLAUDE.md "Known tradeoff".
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
├── app/                          # Expo Router screens (RN/TS)
│   ├── index.tsx                 # record/stop button, dual preview, timer — the evaluated "minimal UI"
│   └── session-debug.tsx         # post-recording debug screen — map + counts + gap list, explicitly secondary
├── modules/
│   ├── frame-timestamp-plugin/   # vision-camera Frame Processor Plugin (Swift)
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
│   └── sample-output/            # real 30s+ recording, CSVs + metadata.json (no video)
├── README.md                     # includes the 200-400 word synchronization write-up
├── CLAUDE.md                     # this file
├── AGENTS.md
└── GOAL.md                       # Original Hiring Task
```

---

## Architecture Rules — Always Follow

1. **No hardware timestamp is ever generated in TypeScript.** TS only receives, interpolates, and writes already-native-timestamped data.
2. **The Frame Processor Plugin does the minimum possible work.** No file I/O, no JSON serialization, no heavy computation inside the per-frame callback — buffer and return.
3. **GPS interpolation is a pure function**, unit-testable without a device: given a sorted array of real points and a gap threshold, return the real + synthetic points merged, each correctly flagged.
4. **`epochMs` is generated once per session**, at record-start, in `sessionManager.ts`, and passed down — never re-derived per file.
5. **CSV writers never write a row without every required column populated** — missing data is `-1`, not an empty cell.
6. **Minimum complexity.** If Expo/vision-camera already solves it, do not reimplement it natively "for control." Native code is reserved for what the spec actually requires to be native (timestamps).
7. **`session-debug.tsx` never becomes the primary flow.** It reads already-written session data (CSVs/session object) for display; it never writes, mutates, or re-derives pipeline data. If it starts influencing the recording flow, that's scope creep — stop and flag it.

---

## Validation Strategy

Given more time, this would be `XCTest` + `jest`. For the scope of this exercise:

- **Frame count check:** expected frames (`fps × duration × 2 cameras`) vs. actual `FrameData.csv` row count, run against a real recording — not simulated.
- **GPS continuity check:** no timestamp gap in `LocationData.csv` exceeds the interpolation threshold, across a real 30s+ walk.
- **Sentinel row check:** manually force a GPS error path (airplane mode toggle mid-recording) and confirm the `ERROR` row is written correctly, not silently dropped.
- **Visual check:** the `session-debug.tsx` map view is the fastest way to eyeball whether interpolated points land sensibly between real ones — use it during development, not just at the end.

Document actual results (not just intent) in the README.
