# Camera config degradation ladder — design note

Short-pass brainstorm (user-scoped): automatic fallback for intermittent
`AVCaptureMultiCamSession` hardwareCost failures (-11872) at bring-up.
TS-only, no new native surface. Resilience layer over checkpoint 8, not a
Build Order checkpoint.

## The two questions this note settles

### 1. Trigger points

The ladder guards **initial bring-up only** — from `configure()` until the
first frame arrives on both cameras. Three failure signals, two paths:

- **Synchronous throw from `configure()`/`start()`** → caught in the
  per-candidate try/catch → next rung, silently.
- **Interruption/error listener firing before the first frame** → fails
  the current attempt's first-frame wait → next rung, silently.
- **5 s first-frame watchdog** (`count === 0` on either timestamp
  controller — the exact signal last night's banner used) → fails the
  attempt → next rung. The watchdog is restructured from a one-shot
  `setTimeout` into a per-attempt promise (`waitForFirstFrames`), same
  signal, same 5 s window.

**After** the first frame, the session is considered up and the ladder is
done for this run. A later interruption (backgrounding, mid-use thermal)
is NOT a ladder case — those either self-heal (interruption-ended clears
the banner, as shipped last night) or surface the banner for a manual
retry. Rationale: a session that produced frames had an under-budget
hardwareCost; re-negotiating on a mid-use interruption would tear down a
proven config in response to a transient.

### 2. Coexistence with the manual tap-to-retry banner

Single-owner rule: all escalation state is **local to one effect run** (a
plain loop over candidates — no per-rung state/nonce churn). The banner
only appears when the ladder is exhausted, so a tap can never race an
in-flight auto-escalation. The tap bumps `retryNonce` → full effect
re-run → ladder restarts from rung 1 (the ideal config): a manual retry
is a fresh roll of the hardwareCost dice, not a resume from the failed
rung. The interruption/error listeners are attached once per attempt and
switch role on first frame: before it they fail the attempt (ladder
mode), after it they feed the banner (last night's behavior, unchanged).

## The ladder

Built by a pure function (`src/session/cameraConfigLadder.ts`, TDD):

| Rung | Target resolution        | Binned | fps            |
| ---- | ------------------------ | ------ | -------------- |
| 1    | tiers[0] (HIGHEST_4_3)   | false  | user's setting |
| 2    | tiers[0]                 | true   | user's setting |
| 3    | tiers[1] (FHD_4_3-class) | true   | user's setting |

- Rung 2 is Apple's documented first mitigation for -11872: binned format
  at the same target — less bandwidth, same resolution class.
- The user's FPS-picker choice is the ladder's starting point on every
  rung — the ladder degrades resolution/binning, never overrides the
  explicitly chosen rate.
- If the tier list has a single entry, rung 3 is omitted (no duplicate
  candidates) — graceful on constrained inputs.

**Why symbolic tiers, not device formats:** vision-camera 5.1.0 exposes
no per-device format list (`CameraDevice` has only
`supportedPixelFormats` — verified in the installed specs), and
`hardwareCost` itself is equally unexposed. Device-agnosticism therefore
comes from the negotiation semantics of `targetResolution`: a tier target
asks for "this class or the nearest the hardware supports," so the same
ladder degrades correctly on any device without naming a single pixel
value of this iPhone. Enumerating real formats would require new native
surface — explicitly out of scope.

## Transparency

`SessionMetadata` gains
`cameraConfig: { step: number; degraded: boolean; binned: boolean } | null`
(null = pre-ladder sessions). `degraded = step > 1`. Threaded
App.tsx → `RecordingDeps` → metadata.json, rendered as a section in the
debug screen's Metadata tab. A reviewer can always tell whether a
recording used the ideal config or a self-selected compromise.

## Testing

- Pure ladder logic: TDD (rung order, fps pass-through, single-tier
  degradation, `nextCandidate` exhaustion, degraded flags).
- Wiring: not unit-testable (camera APIs); verified by device cold
  launches — normal launch must produce `degraded: false` and behave
  exactly as before (the common case must not regress into fallback).
