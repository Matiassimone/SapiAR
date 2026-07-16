# Recording Pipeline — Design (Checkpoint 8, Part A)

Date: 2026-07-15
Status: implemented (checkpoint 8)

## The hardware-budget question

Checkpoint 3's design doc flagged the open risk: multi-cam hardware cost with
4 outputs, growing to 6 with recording. Reading the installed v5 source
resolves most of it:

- The default recording path is **`AVCaptureMovieFileOutput`** (fully
  internal capture→encode; `enablePersistentRecorder` would switch to a
  VideoDataOutput+AVAssetWriter pipeline, and is left off). Recording does
  not add another frame-streaming consumer — it encodes the already-negotiated
  stream.
- Multi-cam hardware cost is dominated by sensor-format bandwidth. Checkpoint
  3 ran **unconstrained** formats (front negotiated 60 fps) and fit. This
  checkpoint constrains both cameras down to `{ fps: 30 }` at a 1080p target —
  lower bandwidth than what already fit, plus two internal file writers.
- ~~Preventive mitigation: `deliversPreviewSizedOutputBuffers = true` on the
  timestamp outputs.~~ **Retracted after device testing:** setting that
  property on a data-only output (no preview layer) throws
  `NSInvalidArgumentException` at init — uncatchable from Swift, a
  100%-reproducible launch crash. Removed outright rather than wrapped: an
  ObjC++ exception bridge isn't worth building for an optimization the
  budget analysis above shows is unnecessary.
- Fallback if `configure()` throws: lower the recording resolution target.
  The throw is explicit and surfaces in the record UI's error state — never
  silently.

## Decisions

1. **FPS constraint `{ fps: 30 }` on both connections** (checkpoint 3's
   carried-over item). iPhone 12 Pro multi-cam formats realistically cap at
   30 fps; the front camera's earlier 60 fps was preview-only with no
   constraint. Uniform 30 also makes the frame-count validation arithmetic
   uniform (30 × duration × 2). Verify `onSessionConfigSelected` now reports
   a real value; document before/after.
2. **Recording target resolution 1080p** per camera (dual-4K multi-cam does
   not exist on this hardware); negotiation settles the exact format.
3. **HEVC explicitly** — `setOutputSettings({ codec: 'h265' })`, not the
   "likely h265" default. Audio off: GOAL.md doesn't ask for it, and off
   avoids the microphone permission entirely.
4. **Record directly into the session folder**: `RecorderSettings.filePath`
   accepts an absolute filesystem path (parents auto-created) — sessionManager
   URIs minus the `file://` prefix. No temp-file move step.
5. **Video outputs join the session at mount**, not at record-start —
   reconfiguring a running session re-negotiates formats and glitches the
   preview; an idle `AVCaptureMovieFileOutput` costs session budget but does
   no encoding work.
6. **Drain-and-discard at record-start**: the timestamp controllers buffer
   from preview start, so record-start discards everything buffered so far;
   as a second belt, the orchestrator drops frame timestamps `< epochMs`
   (boundary slop is at most one drain tick).
7. **One 1 s interval** drains all three native modules → appends to the
   checkpoint-7 buffers → flushes. A per-second flush batches ~60 frame rows
   per write — "periodic, not per-row" with a single cadence, no second timer.
8. **Stop sequence**: clear interval → `stopRecording()` ×2 awaiting
   `onRecordingFinished` (files finalized) → `ExpoGps.stop()` → final
   drain+append+flush → build + write `metadata.json`. `durationMs` is
   `Date.now()` bookkeeping, same legal status as `epochMs` (checkpoint 5).

## Structure

```
src/session/recordingSession.ts   # start/stop orchestration + drain/flush timer
app/… (App.tsx)                   # minimal UI: dual preview, record/stop, timer
modules/frame-timestamp-plugin    # unchanged (preview-sized-buffer idea retracted — crashes on device)
```

`recordingSession` receives the camera-side objects (timestamp controllers,
video outputs, negotiated fps) from the UI layer and owns everything
session-scoped: sessionManager call, buffers, recorders, GPS start/stop,
timer, metadata. UI owns only camera mount-time wiring and button/timer state
(no precision logic, per CLAUDE.md).

## Verification

Simulator: full GPS→CSV→metadata path (cameras absent by design) — session
folder inspectable directly on the Mac's filesystem. Device: full run;
record/stop taps are human steps, may complete asynchronously. Confirm both
`.mov` files playable, CSV structure spot-checks, metadata consistency, and
the negotiated-FPS before/after numbers.
