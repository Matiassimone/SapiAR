# Frame Timestamp Plugin — Design (Checkpoint 3)

Date: 2026-07-14
Status: approved for implementation (autonomous session — mandated by AGENTS.md Superpowers Integration)

## Problem

`FrameData.csv` requires one row per captured frame, from both cameras, with the
hardware `CMSampleBuffer.presentationTimeStamp` converted to Unix ms. CLAUDE.md's
core principle: the timestamp must be captured in native Swift on the capture
thread, with zero bridge/JSI hops before the value exists in memory.

CLAUDE.md names a "vision-camera Frame Processor Plugin" for this. That mechanism
is v4-era: **vision-camera v5 removed the native plugin registry**. The v5
JS-facing frame hook (`CameraFrameOutput.setOnFrameCallback`) is worklet-based —
a synchronous JS call per frame — which violates the core principle and would
add two dependencies (`react-native-vision-camera-worklets`, `react-native-worklets`).

## Decision

Implement the plugin as a **custom native camera output**: vision-camera v5's
`ResolvedCameraSessionConnection.resolveOutput` accepts any object conforming to
`HybridCameraOutputSpec & NativeCameraOutput` (both public), so a third-party
Nitro module can hand its own output into `session.configure()` exactly like the
library's own outputs. This is the sanctioned v5 extension point — same design
intent as a v4 Frame Processor Plugin, different registration mechanism.

### Rejected alternatives

- **Worklet `onFrame`** — JSI hop per frame; forbidden by CLAUDE.md.
- **Patching vision-camera** — fork maintenance on a repo a reviewer clones cold.

## Architecture

```
modules/frame-timestamp-plugin/
├── nitro.json                     # Nitro module config (autolinking)
├── src/FrameTimestampController.nitro.ts  # standalone spec: count, drain(), getCameraOutput()
├── ios/FrameTimestampController.swift     # controller + AVCaptureVideoDataOutput + delegate + buffer
└── FrameTimestampPlugin.podspec
```

**Amended during implementation:** the first cut made our spec `extend
CameraOutput` (cross-module spec inheritance). nitrogen 0.36.1 generates
uncompilable Swift for that path — inherited struct types land in the wrong
C++ namespace, and the generated wrapper `override`s members that
vision-camera emits as `public` (not `open`), which Swift forbids across
modules. Three distinct generated-code defects in one feature is a signal,
not a patch target (AGENTS.md three-attempt rule). Redesigned to the pattern
vision-camera itself ships with nitro-image types: a **standalone spec**
whose `getCameraOutput()` method returns the external `CameraOutput`
HybridObject. The native class conforms to vision-camera's public protocols
with zero overrides; no generated code needs patching.

- One `FrameTimestampController` per camera (front/back), created from TS; its
  `getCameraOutput()` is appended to the existing checkpoint-2 connection's
  `outputs` array.
- Per-frame work (Architecture Rule #2 — the minimum possible):
  read `presentationTimeStamp`, add epoch offset, append one `Double` to an
  array under `os_unfair_lock`. No file I/O, no serialization, no allocation
  beyond amortized array growth.
- `Source` is implicit per instance — TS created each output and knows which
  camera it belongs to; the buffer stores timestamps only.

## Unix-ms conversion (the one subtle decision)

`presentationTimeStamp` is on the host clock (time since boot), not the Unix
epoch. A per-session anchor is unavoidable to satisfy GOAL.md's Unix-ms spec:

```
offset = clock_gettime(CLOCK_REALTIME) − CMClockGetTime(CMClockGetHostTimeClock())
frameUnixMs = ptsMs + offsetMs
```

Both anchor readings are taken back-to-back once at output creation (~µs skew).
Frame-to-frame deltas therefore come 100% from the hardware clock; the anchor
only positions the series on the epoch. This is not the forbidden per-frame
`Date()` pattern — README write-up must explain this.

## Throughput/completeness tradeoffs

- `alwaysDiscardsLateVideoFrames = false`: the frame-count validation demands
  every frame; our delegate work is nanoseconds, so no backpressure risk.
- Buffer is drained (returned + cleared) by TS via `drain()` — at stop for this
  checkpoint; periodic flush arrives with checkpoint 7.

## Known risk

Multi-cam hardware cost with 4 outputs (2 preview + 2 timestamp). `configure()`
throws explicitly if exceeded — verify on device.

**Fallback retracted (checkpoint 8):** the originally documented fallback —
`deliversPreviewSizedOutputBuffers = true` on the timestamp outputs — is
**unsafe as written**: on a real device it throws `NSInvalidArgumentException`
at init (this output has no preview layer), which Swift cannot catch —
a 100%-reproducible launch crash. It was never validated when planned here.
The budget concern it targeted also never materialized: recording uses
`AVCaptureMovieFileOutput`, which adds no frame-streaming consumer. If the
budget ever does overflow, the remaining lever is lowering the recording
resolution target — not this property.

## Verification (this checkpoint)

Run the dual preview ≥10 s on the physical device; compare
`fps × duration` per camera (fps from the negotiated `CameraSessionConfig`)
against `count` per output. Document actual numbers. Mismatch = the session's
main finding, root-caused per the 4-phase methodology — not silently patched.

**Result (iPhone 12 Pro, 2026-07-15):** PASSED, with one caveat.
47 s continuous dual capture, zero dropped frames on either camera.
Back: 24.06 fps steady (409 frames / 17 s window); front: 60.06 fps steady
(1021 / 17 s). `drain()` at t=15 s returned 363 (back) / 908 (front) rows
whose first→last timestamp spans measured 15.04 s / 15.14 s against the 15 s
wall-clock window — hardware timestamps are self-consistent. Caveat: the
planned expected-count baseline (`selectedFPS` from `onSessionConfigSelected`)
came back `undefined` — v5 doesn't report a negotiated FPS when no FPS
constraint is set, so fps was measured empirically from the counts. The
recording checkpoint should set an explicit FPS constraint, which both fixes
the low default back-camera rate (24 fps) and restores a real expected-count
baseline.
