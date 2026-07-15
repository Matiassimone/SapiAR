# SapiAR

Dual-camera + GPS data collection prototype — technical exercise for Sapios.

## Status

Work in progress. This README is maintained as a running technical log
during development; the final 200-400 word synchronization write-up
(GOAL.md deliverable) will be distilled from the entries below once the
pipeline is complete — not written from scratch at the end.

---

## Final Write-up (Synchronization, Tradeoffs, Improvements)

_[To be written at checkpoint 11, distilled from the Technical Decision Log
below. Placeholder — do not leave this section empty in the final commit.]_

---

## Prerequisites / Known Setup Gotchas

Environment issues hit during development — documented so a fresh clone doesn't lose time rediscovering them.

- **CocoaPods must be >= 1.13.0.** Older versions fail `pod install` with `Unrecognized option(s) always_out_of_date in script phase` — Expo's generated `Podfile` uses a script-phase option older CocoaPods doesn't recognize. Fix: `brew upgrade cocoapods` (or `gem install cocoapods`), then `cd ios && pod deintegrate && rm -rf Pods Podfile.lock && cd .. && npx expo run:ios`.
- **npm CLI must be >= 11.10.0** for `.npmrc`'s `min-release-age` to take effect. Don't jump straight to `npm@latest` — as of npm v12, the engine requirement is Node `^22.22.2 || ^24.15.0 || >=26.0.0`; on an older Node, `npm install -g npm@latest` fails with `EBADENGINE`. Use `npm install -g npm@11` instead unless Node is already current.
- **First run on a physical iOS device:** after `npx expo run:ios --device`, the app installs but launch fails with a code-signature error unless the developer profile is explicitly trusted: **Settings → General → VPN & Device Management → [Apple ID] → Trust**. Standard iOS behavior for free/personal developer accounts, not a build issue.

---

## Technical Decision Log

Entries added per checkpoint, in the moment, while the reasoning is fresh —
not reconstructed from memory afterward.

### Checkpoint 0 — Tooling

- ESLint pinned to 9.x, not 10: `eslint-config-expo`'s internal
  `eslint-plugin-react` depends on `context.getFilename`, removed in ESLint 10.

### Checkpoint 2 — Dual camera preview

- vision-camera v5 uses an imperative Nitro API (`supportsMultiCamSessions` →
  `createDeviceFactory()` → `supportedMultiCamDeviceCombinations` →
  `createCameraSession()` → `configure()` → `start()`), not the v4 declarative
  `<Camera>` component. No Expo config plugin ships with v5; camera
  permission is declared via `ios.infoPlist.NSCameraUsageDescription`.
- Device combination selection is constrained to whatever
  `supportedMultiCamDeviceCombinations` reports as hardware-supported —
  never a manually constructed front+back pairing.

### Checkpoint 3 — Frame timestamp capture

- **The core sync problem:** `FrameData.csv` needs one row per frame with
  the hardware `presentationTimeStamp`, captured with zero JS involvement
  before the value exists in memory (CLAUDE.md's core principle).
- **Why not vision-camera's Frame Processor Plugin path:** it routes
  through a synchronous JS `onFrame` worklet per frame. This is not a
  timestamp-accuracy problem — `presentationTimeStamp` would be identical
  either way, since it's a value already recorded in the buffer, not
  something measured at read time. The real risk is completeness and
  dependencies: a per-frame JS worklet in the capture hot path can cause
  backpressure-driven frame drops if it doesn't finish before the next
  frame arrives, and requires two extra packages
  (`react-native-vision-camera-worklets`, `react-native-worklets`).
- **What we used instead:** a custom native camera output conforming to
  vision-camera v5's public `NativeCameraOutput` protocol — an officially
  documented extension point (see Margelo's "What's New in VisionCamera
  V5"), not a workaround. A `FrameTimestampController` per camera (front/
  back) is appended directly to the session's `outputs` array; its
  `AVCaptureVideoDataOutput` delegate runs entirely on the native capture
  thread. Zero JS in the per-frame path.
- **Unix-ms conversion:** `presentationTimeStamp` lives on the host clock
  (time since boot), not the Unix epoch. A once-per-session anchor —
  `clock_gettime(CLOCK_REALTIME)` and `CMClockGetTime(CMClockGetHostTimeClock())`
  read back-to-back — offsets the series onto Unix time. Frame-to-frame
  deltas come 100% from the hardware clock; the anchor only positions the
  series. This is not the forbidden per-frame `Date()` pattern: the anchor
  is computed once, not per row.
- **Tooling constraint found:** nitrogen 0.36.1 (vision-camera's Nitro spec
  codegen) cannot handle cross-module spec inheritance (`extends
CameraOutput` generates uncompilable Swift). Specs are standalone;
  `getCameraOutput()` returns the external `CameraOutput` HybridObject by
  value instead — the same pattern vision-camera's own nitro-image
  integration uses internally.
- **Real-world verification (iPhone 12 Pro, 47s continuous):** zero dropped
  frames on either camera. Back steady at 24.06 fps, front steady at 60.06
  fps (measured empirically — see next point). `drain()` at t=15s returned
  363 rows (back) / 908 (front), spanning 15.04s / 15.14s against the 15s
  wall-clock window: hardware timestamps are internally self-consistent.
- **Open item carried to checkpoint 8:** no explicit FPS constraint was set
  this checkpoint, so v5 didn't report a negotiated FPS
  (`onSessionConfigSelected` came back `undefined`) — fps was measured from
  raw counts instead. The back camera's default-negotiated 24fps is also
  below what GOAL.md's "highest available quality" calls for. The recording
  checkpoint must set an explicit FPS constraint, which fixes both issues.

### Checkpoint 4 — GPS capture (Expo Module)

- **Capture/classification split:** the Swift module emits raw CoreLocation
  values only — `CLLocation.timestamp` as Unix ms, lat/long, and
  speed/course/accuracy passed through with CoreLocation's own negative
  "unavailable" encoding intact. The ≤20m threshold, `quality_flag`, `-1`
  mapping, and ERROR sentinel rows are TS data-assembly work (checkpoints
  6/7), so the classification logic stays unit-testable without a device.
- **No clock anchor needed here** — unlike the frame path:
  `CLLocation.timestamp` is already a wall-clock `Date` from the fix, so
  `timeIntervalSince1970 × 1000` is the hardware timestamp. The two capture
  paths converge on the same Unix-ms axis via different, documented routes.
- **Hardware errors are stream entries, not exceptions:** `didFailWithError`
  appends a distinct `errorCode` entry to the same chronological buffer.
  Verified organically on the simulator — CoreLocation emitted a transient
  error before its first fix and it appeared in the drain as an error entry
  rather than vanishing.
- **Continuous-capture knobs that matter:** `kCLLocationAccuracyBest` +
  `distanceFilter = kCLDistanceFilterNone` (every update, per GOAL.md §3)
  and `pausesLocationUpdatesAutomatically = false` — iOS silently pauses
  updates otherwise, which would fake a GPS gap.
- **API shape mirrors the frame module** (`drain()` / `count`, NSLock'd
  buffer, main-thread CLLocationManager for its run-loop requirement) — one
  pattern for both native capture modules.
- **Verified (simulator):** 1 Hz sustained updates, monotonic timestamps
  (span 20.9s over a 20s window), raw negatives on the first no-motion fix,
  drain round-trip, permission flow. **Pending:** moving-fix speed/course
  (dev-client reload channel broke; 3 attempts, stopped per AGENTS.md) and
  the real-device walk — both queued as the first minutes of checkpoint 5's
  session.
- **Real-device finding (iPhone, indoor, stationary/light movement):**
  first `drain()` at t=20s returned 8 fixes spanning **80.2s** — physically
  impossible within a 20s-old session. Root cause: `CLLocationManager`'s
  first delivery on a fresh authorization is commonly a **cached
  last-known-location** from before the manager started (`buffered` jumped
  straight to 5 at t=1s, confirming a startup burst rather than 5 fresh
  reads in one second), not a live fix. Expected CoreLocation behavior, not
  a bug in our capture code — but it's an **open design decision for
  checkpoints 6/7**: `LocationData.csv` is named `{epochMs}_...`, implying
  everything in it belongs to that session; a fix timestamped before the
  session's `epochMs` should not silently land in the file. Needs an
  explicit filter (drop or flag fixes with `timestamp < epochMs`) in the
  CSV-assembly stage.
- **Speed/course still unresolved on real hardware too:** 8/8 fixes had
  `speed<0`/`course<0` (indoor walk within a small room, `hAcc` 12-24m —
  the movement was inside the fix's own error margin, so CoreLocation had
  no basis to report either). Not a new finding, but confirms the
  simulator's gap wasn't a simulator-only artifact. Still deferred to
  checkpoint 10's real outdoor recording, where actual walking speed will
  exceed GPS noise.

### Checkpoint 5 — sessionManager.ts

- **First TDD checkpoint** (per AGENTS.md): 8 failing-first Jest tests cover
  GOAL.md §6 naming exactly (including `metadata.json` carrying no epoch
  prefix), single-epochMs threading, purity/trailing-slash normalization,
  and once-only epoch generation with folder creation (mocked FS).
- **`Date.now()` is legal here, and only here:** `epochMs` is the session's
  _identity_ — the folder-naming timestamp GOAL.md §6 defines as "the moment
  recording started" — not a data timestamp. Architecture Rule #4 assigns
  its generation to sessionManager.ts in TS; every CSV row still carries
  only native hardware clocks. The distinction is documented at the call
  site because it looks like a violation of the no-`Date()` rule without
  that context.
- **Pure/FS split:** `buildSessionPaths(epochMs, containerUri)` is a pure
  function (fully unit-tested); `startSession()` is the thin orchestration
  that reads the clock once, builds paths, and creates the folder via
  expo-file-system v57's `Directory` API.
- **Toolchain friction, same shape as ESLint 9/10:** jest must stay on the
  **29.x line** — jest-expo@57 bundles jest-29 internals (`jest-mock@29`),
  and jest 30's runtime calls APIs they lack
  (`clearMocksOnScope`). Also, `min-release-age` blocked both
  `jest-expo@57.0.2` and `expo-file-system@57.0.1` (published hours before
  this session) — pinned the prior releases instead of lowering the
  cooldown, per AGENTS.md. TypeScript 6 no longer auto-includes `@types/*`;
  `"types": ["jest"]` added to tsconfig.
- **Flagged, not guessed (per Session Discipline):** folder-lifecycle edge
  cases are unspecified in CLAUDE.md/GOAL.md — (1) what to do if
  `{epochMs}_Session/` already exists (current behavior: `Directory.create()`
  throws — plausibly correct as an unrecoverable state, but undecided), and
  (2) whether a cancelled/failed session should delete its folder. Both need
  an owner decision before checkpoint 8 wires the record button.
  _Resolved: Architecture Rule #8 now says let it throw, no special cases._

### Checkpoint 6 — gpsInterpolation.ts

- **TDD, red-first:** 12 tests written before the implementation, covering
  every case the checkpoint mandated — pass-through, gap exactly at
  threshold (not interpolated: strictly-above triggers), single/multiple
  gaps, error-entry-inside-a-gap, leading/trailing errors, empty/single
  inputs, input immutability, and the continuity property itself (no
  consecutive positioned-point delta above threshold — the exact check
  CLAUDE.md's Validation Strategy runs against real data in checkpoint 10).
- **Threshold: 3000 ms, parameterized.** 3× the 1 Hz cadence verified
  on-device in checkpoint 4: one missed update (~2 s silence) is normal
  jitter, two or more is a real gap. Exported as a constant so checkpoint 7
  passes it explicitly.
- **Synthetic rows carry interpolated lat/long only; kinematics and
  accuracies are `-1`.** GOAL.md §4's requirement is positional continuity
  ("no large holes"); speed/course/accuracy on a synthetic row would be
  fabricated sensor data. The bounding fixes frequently carry `-1`
  themselves (the stationary case from checkpoint 4), so per-field
  interpolate-or-not rules would add complexity to produce fake precision.
  `INTERP` + `-1` keeps synthetic rows unmistakable downstream.
- **Fill density:** `ceil(gap/threshold) − 1` evenly spaced points, so no
  resulting delta exceeds the threshold — the output satisfies the
  continuity property by construction.
- **Hardware-error entries are not gap boundaries** — they carry no
  timestamp/position, so nothing can be interpolated from them. They pass
  through in arrival order; the gap is measured between real fixes. (Edge
  case GOAL.md doesn't address; decided + tested explicitly.)
- **No extrapolation at array edges:** a gap with only one bounding fix is
  left alone — linear interpolation needs two bounds, and extrapolating
  fabricates a trajectory. The function also can't see session start/stop
  times by design; whether the session's first/last seconds need coverage
  is a checkpoint 7/8 (assembly) question, flagged not guessed.
- **Ownership boundary honored:** this module assigns only `INTERP` on
  points it creates. Real and error entries pass through byte-identical
  (same references) — `OK`/`LOW_ACCURACY`/`ERROR` classification is
  csvWriter's (checkpoint 7).

### Checkpoint 7 — csvWriter, buffers, metadata

- **TDD, red-first:** 21 new tests (41 total across the TS pipeline) —
  headers pinned character-exact to GOAL.md, the 20 m boundary (exactly 20 m
  is `OK`; strictly above is `LOW_ACCURACY`), ERROR sentinel with every
  numeric field `-1` **including `Timestamp_unix_ms`** (per the Data Spec
  clarification — the internally-known error arrival time is deliberately
  not preserved), INTERP rows passing through unmodified, frame rows for
  both cameras, and the pre-session filter's ordering guarantee.
- **Pre-session cached fixes are dropped, and the filter runs BEFORE
  interpolation.** A cached fix (checkpoint 4's 80.2 s-span finding) isn't
  this session's data — but the sequencing is the real safety property: had
  interpolation run first, the cached fix would anchor synthetic points
  that never happened. The ordering test constructs exactly that scenario
  (cached fix 40 s pre-epoch + two session fixes 2 s apart) and asserts
  zero INTERP rows reach the file. Error entries carry no timestamp and are
  kept — they occurred during the session and owe the file a sentinel row.
- **Flush windows are append-only via a carried-over last fix.** The
  location pipeline (filter → interpolate → format) runs per flush; the
  previous window's last real fix is prepended as interpolation context so
  a gap spanning two flushes is still detected — no whole-file rewrites,
  no missed cross-window gaps. Tested with a 10 s gap split across two
  flushes (3 INTERP rows appear, correctly ordered).
- **Edge cases decided (GOAL.md silent), flagged in code:** negative
  horizontal accuracy (CoreLocation invalid-fix marker) writes `-1` and can
  never be `OK` — an invalid fix can't claim ≤20 m confidence; timestamps
  are written as integer ms (sub-ms is below both sensors' meaningful
  resolution).
- **metadata.json schema** (unspecified in GOAL.md): minimal — epochMs,
  durationMs, per-camera frame counts, GPS row counts by type
  (real/interpolated/error), negotiated fps when known. The counts exist to
  cross-check the CSVs; nothing speculative added.
- **expo-file-system v57 append API:** `FileHandle` exposes `writeBytes`
  (no string `write`) — rows are `TextEncoder`-encoded per flush,
  `FileMode.Append` keeps files append-only.
- **Still open for checkpoint 8:** the seconds between `epochMs` and the
  first GPS fix (and between the last fix and stop) are uncovered by
  design — interpolation needs two bounds and the pipeline never sees
  session stop time. Whether that leading/trailing window needs rows is an
  assembly/product question, flagged not guessed.
  _Resolved: Architecture Rule #9 — no extrapolation at session edges._

### Checkpoint 8 — Recording pipeline wired end-to-end

- **The hardware-budget question resolved by reading the source:** v5's
  default recording path is `AVCaptureMovieFileOutput` (internal encode of
  the already-negotiated stream — `enablePersistentRecorder` stays off), so
  recording adds no new frame-streaming consumer. Multi-cam cost is
  dominated by sensor-format bandwidth, which this checkpoint _reduces_:
  explicit `{ fps: 30 }` at a 1080p target versus checkpoint 3's
  unconstrained formats (front had negotiated 60 fps). The `configure()`
  throw remains the explicit arbiter and now surfaces in the UI error state.
- **Crash found on device, root-caused, fixed by removal:** the
  "belt-and-suspenders" bandwidth mitigation this checkpoint initially
  shipped — `deliversPreviewSizedOutputBuffers = true` on the timestamp
  outputs (checkpoint 3's documented-but-never-validated fallback) —
  **crashes 100% reproducibly at launch on real hardware**:
  `NSInvalidArgumentException` from `FrameTimestampCameraOutput.init()`,
  because the property rejects data-only outputs with no preview layer, and
  Swift cannot catch Objective-C exceptions (EXC_BREAKPOINT trap). Fix:
  removed outright — not wrapped — since an ObjC++ exception bridge isn't
  worth building for an optimization the budget analysis shows unnecessary.
  Write-up material: a documented mitigation that was wrong the first time
  it met hardware; the lesson is that fallbacks belong behind the same
  validation bar as primary paths.
- **Second device-found bug, same session: the CSV files were never
  created.** expo-file-system's `FileHandle` in Append mode
  opens-but-never-creates; checkpoint 5's sessionManager deliberately
  creates only the folder ("paths and lifecycle", no content), and
  checkpoint 7's buffers assumed the file existed at first append — the
  responsibility fell in the gap _between_ two correctly-tested modules.
  Fix: `recordingSession` creates both empty CSVs at session start
  (orchestration owns "getting the pipeline ready"; sessionManager's
  checkpoint-5 boundary stays untouched). Files are created truly empty —
  headers remain buffer-owned, written on first flush (checkpoint 7's
  existing decision). The `.mov` side has no such gap, confirmed with
  hardware evidence: the failed session's folder contains both video files
  and no CSVs — the Recorder creates its own output. Write-up material for
  "what I'd improve": each checkpoint's unit tests correctly assumed the
  other's preconditions, so only an integration test of
  session-start-to-first-flush (or a real device run) could catch this —
  that test is the first thing to add given more time.
- **Fix verification status:** crash fix confirmed on hardware (app
  launched and stayed alive well past the camera mount that previously
  trapped 100% of launches). CSV-creation fix is pinned by a failing-first
  unit test (48 total) and awaits the first successful device recording
  for end-to-end confirmation.
- **Third device-found bug: `setOutputSettings` called before
  `configure()`.** Two unhandled promise rejections per launch ("Cannot set
  output settings when VideoOutput is not yet connected") — the HEVC codec
  setter ran at output creation, but the v5 contract (in the source, not
  the error message alone) requires it _after_ `configure()` attaches the
  output and _before_ `createRecorder()`. Root-caused with evidence from
  the failed session's videos: **codec-only** — the FPS constraint is
  declarative in the connections and did apply (`fps=30.003` back /
  `29.997` front read straight from the `.mov` tracks — checkpoint 8's
  24→30 objective landed), and the rejected codec setter was masked by the
  library default already choosing `hvc1`/HEVC. Fix: setter moved after
  `configure()`, properly awaited, errors surfacing in the UI. Verified
  zero rejections on a fresh Metro-connected launch.
- **New finding flagged (not chased in the bugfix session): negotiated
  recording resolution is 640×480**, far below the 1080p target — read
  from the same `.mov` tracks. Independent of the codec bug (that setter
  doesn't touch resolution); the format negotiation across 6 outputs is
  settling on the smallest multi-cam format. Needs its own investigation —
  candidate causes: aspect-ratio weighting of the FHD 16:9 target against
  4:3 multi-cam formats, or the `.any`-resolution timestamp outputs
  dragging negotiation down.
- **Resolution root cause found (fourth device session): missing
  negotiation _intent_, not topology.** Five on-device experiments —
  HIGHEST_4_3 target alone, no timestamp outputs, video-only connections,
  alternate device combination, no FPS constraint — all still negotiated
  640×480. The fix: vision-camera's constraints "describe intent", and no
  resolution intent was ever expressed. Adding
  `{ resolutionBias: videoOutput }` + `{ binned: false }` to each
  connection's constraints moved negotiation to **1920×1440 @ 30 fps on
  both cameras** (9× the pixels) with the full 6-output topology intact —
  target resolution on the output alone is provably insufficient under
  multi-cam.
- **`setOutputSettings` is unusable under multi-cam — a vision-camera v5
  bug, not a format issue.** The codec-crash hypothesis (HEVC missing at
  the binned format) was disproven on device: `getSupportedVideoCodecs()`
  lists `h265` at every tested format, yet `setOutputSettings` throws the
  same uncatchable ObjC exception at 640×480-binned **and** at
  1920×1440 non-binned. It has never once succeeded in a multi-cam
  session. Resolution: never call it; rely on the library's default codec,
  which is empirically HEVC/`hvc1` on this hardware (verified from
  recorded files) — with a one-shot log of supported codecs per run as
  standing evidence. Write-up material: two library behaviors (negotiation
  needing explicit intent; a setter broken under multi-cam) that only real
  hardware could reveal.
- **End-to-end verification (real 64 s device recording, final config) —
  every bar cleared:** both `.mov`s HEVC/`hvc1` at **1920×1440, 30.00 fps**
  (probed from the files, not assumed); frame capture 1928 front / 1929
  back vs ~1932 expected (99.8%, ±4-frame boundary slop, effectively zero
  drops); FrameData row count cross-checks metadata exactly; GPS 64 real
  fixes at 1 Hz + **3 INTERP rows filling a real gap** with max
  consecutive delta 2543 ms ≤ the 3000 ms threshold (the Validation
  Strategy continuity check, passing on real data); zero pre-session
  timestamps in the CSV (cached-fix filter verified end-to-end);
  `metadata.json` valid and consistent (fps 30/30 — checkpoint 3's
  24 fps open item closed with negotiated, recorded proof).
- **FPS constraint (checkpoint 3's carried item):** `{ fps: 30 }` on both
  connections — uniform rate on hardware whose multi-cam formats cap at 30,
  and uniform frame-count arithmetic (30 × duration × 2). On-device
  before/after numbers pending the first real recording (metadata.json
  carries the negotiated values).
- **HEVC explicit** (`setOutputSettings({ codec: 'h265' })`), audio off (not
  in GOAL.md; avoids the mic permission). Recorders write **directly into
  the session folder** — `RecorderSettings.filePath` takes an absolute
  filesystem path with parents auto-created, so GOAL §1 naming comes
  straight from sessionManager with no temp-file move.
- **Video outputs join the session at mount, recorders per session:**
  reconfiguring a live session re-negotiates formats and glitches the
  preview; an idle `MovieFileOutput` does no encode work. A `Recorder`
  records once — each record-start creates fresh ones.
- **Session-boundary hygiene:** record-start drains-and-discards everything
  the timestamp controllers buffered since preview mount, plus a
  `timestamp >= epochMs` frame filter for the one-tick boundary slop —
  FrameData.csv only ever contains this session's frames.
- **One 1 s cadence** drains all three native modules → appends → flushes:
  ~60 frame rows per write is already "periodic, not per-row" without a
  second timer.
- **TDD:** 5 orchestrator tests (fakes for controllers/recorders, fake
  timers, mocked FS) — pre-record discard, epoch filter, session-path
  recording + stop finalization, GPS lifecycle, metadata correctness.
  47 tests total.
- **Verified:** simulator boot smoke (clean minimal UI, correct no-multi-cam
  degradation, scaffolding gone). **Pending — the device e2e:** the app is
  installed on the iPhone (build succeeded; auto-launch blocked by device
  lock). First real record/stop run confirms playable HEVC `.mov`s, CSV
  spot-checks, metadata, and the negotiated-FPS numbers.
