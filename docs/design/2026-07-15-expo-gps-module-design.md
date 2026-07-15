# Expo GPS Module — Design (Checkpoint 4)

Date: 2026-07-15
Status: approved for implementation (autonomous session — mandated by AGENTS.md Superpowers Integration)

## Problem

`LocationData.csv` needs every available GPS update at highest precision, each
row carrying the hardware `CLLocation.timestamp` as Unix ms — never `Date()`
at write time — plus lat/long/speed/course/accuracy fields, and a
never-silently-dropped error signal for hardware failures (GOAL.md §3).

This checkpoint delivers **capture only**: raw values buffered natively,
drainable from TS. Classification (≤20 m threshold, `quality_flag`, `-1`
fallbacks, ERROR sentinel rows) is TS data-assembly work in checkpoints 6/7 —
deliberately not implemented in Swift, so the pipeline's decision logic stays
unit-testable without a device.

## Decision

**Expo Module (Swift) with the checkpoint-3 buffer pattern**: in-memory buffer
under `NSLock`, `drain()` returns-and-clears, `count` for cheap polling.
Rejected alternatives: per-update `sendEvent` (bridge chatter, breaks the
established native-module API shape, buys nothing over polling for a buffered
pipeline) and a JS callback (same, more surface).

## Architecture

```
modules/expo-gps/
├── expo-module.config.json   # Expo autolinking (ios platform)
├── package.json              # file: dependency, same as frame-timestamp-plugin
├── index.ts                  # typed wrapper over the native module
└── ios/
    ├── ExpoGps.podspec
    └── ExpoGpsModule.swift    # CLLocationManager + delegate + buffer
```

TS surface (mirrors `FrameTimestampController`):

```ts
requestPermission(): Promise<boolean>
start(): void
stop(): void
drain(): GpsSample[]
count: number
```

`GpsSample` (all-raw, one chronological stream):

```ts
{
  timestampMs: number | null        // CLLocation.timestamp → Unix ms; null on error entries
  lat, long: number | null
  speedMs, courseDeg, courseAccuracyDeg: number | null
  horizontalAccuracyM, verticalAccuracyM: number | null
  errorCode: number | null          // CLError.code — non-null marks a hardware-error entry
  errorDomain: string | null
}
```

## The delegate-timing decisions (why this checkpoint needed a brainstorm)

- **Run loop:** `CLLocationManager` must be created on a thread with a run
  loop; delegate callbacks arrive there. Created lazily on the **main thread**;
  buffer appends take an `NSLock`, so TS-side `drain()`/`count` reads (JS
  thread) never race the delegate.
- **`didUpdateLocations` batches:** CoreLocation may deliver several
  `CLLocation`s in one callback (deferred/queued fixes). Every element is
  captured in array order — GOAL.md demands _every available update_.
- **`didFailWithError` is not terminal:** `kCLErrorLocationUnknown` is
  transient (the manager keeps trying); `denied` is effectively terminal. The
  module records the raw `CLError` code/domain as an entry in the same
  chronological buffer and keeps running — whether an error becomes an ERROR
  sentinel row (and whether capture should stop) is downstream TS policy.
- **Authorization is asynchronous:** `requestWhenInUseAuthorization()` returns
  immediately; the outcome lands in `locationManagerDidChangeAuthorization`.
  `requestPermission()` resolves its Promise from that callback (no polling,
  no fixed timeout). Foreground-only permission — recording happens with the
  app active by design.
- **Timestamp conversion:** `CLLocation.timestamp` is already wall-clock (the
  fix's hardware `Date`), so `timeIntervalSince1970 × 1000` is exact — unlike
  checkpoint 3's `CMTime`, **no host-clock anchor is needed**. No `Date()` is
  ever read.
- **Raw negative pass-through:** CoreLocation already encodes "unavailable" as
  negative values (`speed < 0`, `course < 0`, `courseAccuracy < 0`,
  `horizontalAccuracy < 0` = invalid fix). Values are passed through raw; TS
  maps them to the spec's `-1`/quality semantics later. Swift performs zero
  classification.
- **Continuous capture knobs:** `desiredAccuracy = kCLLocationAccuracyBest`,
  `distanceFilter = kCLDistanceFilterNone` (every update, not
  distance-gated), `pausesLocationUpdatesAutomatically = false` (iOS may
  otherwise silently pause updates — fatal for a continuous log).

## Verification (this checkpoint)

On the physical iPhone 12 Pro via Metro console logs (checkpoint-3 pipeline):
updates arriving at ~1 Hz, timestamps sane and monotonic, raw negative values
observed for course/speed when stationary, and a drain round-trip. A real
walk/drive segment exercises non-negative speed/course if the device is moved
during the session. Result numbers recorded below once run.

**Result (simulator, iPhone 17 Pro, 2026-07-15):** capture path verified;
two items pending. Over a 60 s+ session with a simctl-simulated location:
updates arrived at exactly 1 Hz (buffered count +1/s, sustained); `drain()`
at t=20 s returned 11 fixes + **1 error entry** — CoreLocation emitted a real
transient error before its first fix, and it landed in the stream as a
distinct `errorCode` entry instead of being dropped, exercising the
`didFailWithError` path organically. Timestamps monotonic, span 20.9 s
against the 20 s window. Raw negative pass-through observed on the first fix
(speed &lt; 0, course &lt; 0 with no motion history). Permission flow verified
via `simctl privacy grant` (resolves true, capture starts).

Pending: (1) speed/course under movement — a simulated waypoint route was
started, but the dev-client reload channel broke (embedded-bundle fallback,
then launcher crash-to-home) and the moving-fix drain couldn't be captured;
three attempts, stopped per AGENTS.md's rule. (2) Real-hardware verification
on the iPhone 12 Pro — the app built and installed, but the location
permission dialog needs a human tap and the phone locked before it was
answered. Both fold into the next session's first minutes: relaunch, tap
Allow, walk.
