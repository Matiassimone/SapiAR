# SapiAR - AGENTS.md

Always-on rules for Claude Code. Read `CLAUDE.md` for full architectural context and the data spec. Scope discipline matters as much as code quality.

---

## Dependency Management

**Package manager: npm** (see `CLAUDE.md` → Tooling for the reasoning — Metro's default resolver assumes hoisted `node_modules`; pnpm needs extra config that isn't worth the setup risk on a repo a reviewer will clone cold). Use `npm install`, commit `package-lock.json`.

**Exact versions in `package.json`** — no `^` or `~` on direct dependencies. This is a hiring artifact; the reviewer may `git clone` and build it on a different date than today, and a floating version that pulls a breaking vision-camera or Expo SDK update is an unforced error.

```json
// correct
"dependencies": { "react-native-vision-camera": "4.6.4" }

// never
"dependencies": { "react-native-vision-camera": "^4.6.4" }
```

**Adding a new dependency checklist:**

1. Check if Expo SDK or an already-installed package covers it (Ponytail rung 5) before adding anything new.
2. Pin exact version.
3. If it's a native module requiring config plugins, document the `app.json`/`app.config.ts` plugin entry in the same commit.

---

## File and Module Naming

**Expo Modules (native):** one folder per module under `modules/`, named for what it does, not how it's built.

```
modules/expo-gps/ios/ExpoGpsModule.swift
modules/frame-timestamp-plugin/ios/FrameTimestampPlugin.swift
```

**TypeScript session/CSV logic:** `camelCase.ts`, one responsibility per file, suffixed by role where it disambiguates.

```
frameBuffer.ts       # buffering only
gpsInterpolation.ts  # pure interpolation logic only
csvWriter.ts         # row formatting only
```

**No god files.** `sessionManager.ts` orchestrates; it does not itself implement interpolation or CSV row formatting — it imports and calls those modules. This is the same boundary discipline as a NestJS module import rule, just without NestJS.

---

## Engineering Conventions

**Testing:** Jest for TypeScript (interpolation logic, CSV formatting — both are pure functions, no device needed to unit-test them). No test framework requirement for the Swift native modules given the 2-day scope, but the manual validation steps in `CLAUDE.md` → Validation Strategy are not optional — they produce the evidence for the sample output deliverable.

**Error handling:** GPS/camera failures are expected, not exceptional. A GPS hardware error is a `quality_flag = ERROR` row, not a thrown exception that kills the session. A camera permission denial is a UI state, not a crash. Reserve actual `throw`/exceptions for truly unrecoverable states (e.g., disk write failure mid-session).

**Linting and formatting:**

- `npx expo lint` — TypeScript/RN side.
- `swift-format` (default config) — native Swift modules.
- Both must be clean before a task is marked complete.

---

## Ponytail Mode

Mode: **`full`**. Do not drift into `ultra` — this is a focused prototype, not a platform.

Ponytail rung 5 ("already-installed dependency") applies specifically to:

- `react-native-vision-camera`'s built-in multi-cam support — never hand-roll `AVCaptureMultiCamSession` config that the library already exposes.
- `react-native-maps` for the debug screen's track rendering — never hand-roll map tile/marker rendering.
- Expo SDK modules (`expo-file-system`, `expo-router`, etc.) over custom native bridges, for anything that is not the timestamp-critical path.

**Watch specifically for scope creep on `session-debug.tsx`.** It's an aid, not a deliverable in `GOAL.md`. If it starts accumulating features beyond "show the track, show the counts, show the gaps," that's a signal to stop and flag it rather than keep building.

**Deliberate shortcut annotation** — same convention as any Ponytail project:

```ts
// ponytail: linear interpolation only — no quadratic/spline smoothing.
// Sufficient for gap-filling; revisit if Sapios needs curvature-aware paths.
```

These are the seeds of the "what I'd improve given more time" section of the README write-up — harvest them there directly.

**Commands:**
| Command | When |
|---|---|
| `/ponytail-review` | Before marking any task complete |
| `/ponytail-debt` | End of each session — feeds the README "given more time" section |
| `/ponytail lite\|full\|ultra\|off` | Adjust only with explicit reason |

---

## Superpowers Integration

**Before starting the native modules (Frame Processor Plugin, Expo GPS module):**
Use `/brainstorming` to walk through the `AVCaptureMultiCamSession` config and `CLLocationManager` delegate setup _before_ writing Swift — these are the two places where a wrong assumption is expensive to unwind later in a 2-day window.

**For implementation:**
Use `/execute-plan` to batch work into checkpoints: (1) dual camera + preview working, (2) frame timestamp plugin wired and buffering, (3) GPS module + interpolation, (4) CSV/session assembly, (5) debug screen, (6) real recording validation. Do not start checkpoint N+1 until N produces verifiable output.

**TDD** for all pure TypeScript logic (interpolation, CSV formatting) — write the failing test first. Not required for the Swift native layer given scope, but see Validation Strategy in `CLAUDE.md` for the equivalent rigor.

**Debugging:** 4-phase methodology (reproduce, root cause, hypothesis, fix). If a native/JS bridge issue survives three fix attempts, stop and flag it explicitly rather than papering over it with a workaround that reintroduces bridge-per-frame calls — that would silently violate the core architectural principle in `CLAUDE.md`.

---

## Session Discipline

Each session targets a single checkpoint from the Superpowers `/execute-plan` breakdown above — not the whole app.

**Start of session:**

1. State which checkpoint this session targets.
2. Confirm it's achievable in the session, or split it.
3. Read `CLAUDE.md`'s Data Spec and Architecture sections before touching native code — do not re-derive the CSV schema from memory.

**During session:**

- One native module or one TS module at a time. Verify (build + manual smoke test on device/simulator) before moving on.
- Any assumption about `AVCaptureMultiCamSession` format compatibility, thermal limits, or `CLLocationManager` delegate timing that turns out wrong: stop, surface it, don't silently patch around it.

**End of session — structured report:**

---

## Session Report

### Skills activated this session

| Skill / Plugin   | Moment                    | Result                      |
| ---------------- | ------------------------- | --------------------------- |
| Ponytail full    | pre-hook every turn       | active                      |
| /brainstorming   | before native module work | [ used / skipped — reason ] |
| /execute-plan    | implementation            | [ used / skipped — reason ] |
| TDD              | TS pure logic             | [ used / skipped — reason ] |
| /ponytail-review | before marking complete   | [ used / skipped — reason ] |
| /ponytail-debt   | end of session            | [ used / skipped — reason ] |

### What happened

- [ short bullet list, one line each ]

### Pending

- [ what's not finished and why ]

### Decisions made

- [ any architectural call not pre-defined in CLAUDE.md ]

### Docs to update

- **CLAUDE.md** — [ what, or "none" ]
- **AGENTS.md** — [ what, or "none" ]
- **README.md** — [ what needs to feed into the 200-400 word write-up, or "none" ]

### Suggestions

- [ optional: risks or patterns worth flagging before next session ]

### Next task

[ single sentence ]

---

## Build Order (reference)

1. Expo project scaffold (`expo prebuild`, bare-enough to support native modules and `AVCaptureMultiCamSession`). `npm install`, exact versions from the start.
2. `react-native-vision-camera` installed and configured for dual-camera preview — no timestamp logic yet, just confirm both feeds render simultaneously.
3. Frame Processor Plugin (Swift) — extract `presentationTimeStamp`, buffer in memory, expose to TS. Verify frame count against expected `fps × duration` before moving on.
4. Expo GPS module (Swift) — `CLLocationManager`, hardware timestamp, all required fields including `-1` fallbacks and `ERROR` sentinel rows.
5. `sessionManager.ts` — generates `{epochMs}`, owns folder lifecycle.
6. `gpsInterpolation.ts` — pure function, unit-tested, gap detection + fill.
7. CSV writers + `metadata.json` assembly — buffered, periodic flush.
8. Minimal record UI — preview, record/stop button, timer. Deliberately kept late — it's explicitly not what's being evaluated.
9. `session-debug.tsx` — map with real/interpolated points, counts, gap list. Built once real data exists to visualize; doubles as ongoing dev tool from this point forward.
10. Real recording (30s+ outdoor walk) → validate frame count, GPS continuity, sentinel rows, eyeball via debug screen → produce sample output folder.
11. README write-up (200-400 words) — pull directly from `ponytail:` shortcut comments and Session Report "Decisions made" entries accumulated across sessions, don't write it from scratch at the end.
