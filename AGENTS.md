# SapiAR - AGENTS.md

Always-on rules for Claude Code. Read `CLAUDE.md` for full architectural context and the data spec. Scope discipline matters as much as code quality.

---

## Dependency Management

**Package manager: npm** Metro's default resolver assumes hoisted `node_modules`; pnpm needs extra config that isn't worth the setup risk on a repo a reviewer will clone cold). Use `npm install` for day-to-day work, commit `package-lock.json`, and use **`npm ci`** (not `npm install`) for any reproducible/CI build step — it fails hard if the lockfile doesn't match `package.json` exactly, which is npm's equivalent of a frozen-lockfile guarantee.

**`.npmrc` deliberately does not set `ignore-scripts=true` project-wide**, unlike a typical pnpm security baseline. This project's native-module tooling (Expo autolinking, vision-camera, CocoaPods integration) can depend on install-time lifecycle scripts; blocking them globally risks silent, hard-to-diagnose build breakage. For new or unfamiliar dependencies, review scripts manually and install with `npm install <package> --ignore-scripts` instead.

**`.npmrc` sets `min-release-age=1`** (24h cooldown, requires npm CLI >= 11.10.0) to filter out most short-lived supply-chain compromises before they can be installed. If a legitimate install is blocked by this — for example, an urgent security patch that was just published — use `npm install --min-release-age 0 <package>@<version>` rather than removing or lowering the config. This is a known source of confusing "package not found" style errors for anyone (including an agent) who hasn't seen this config before — check `.npmrc` first if an install fails for a package that clearly exists on npm.

**npm v12 blocks dependency install scripts by default** (`preinstall`/`install`/`postinstall`, plus implicit `node-gyp` rebuilds for packages with `binding.gyp`) — this is now enforced, not advisory, as of the v12 release. An install that silently skips a script is not necessarily a bug: check for a "skipped scripts" warning first. Workflow:

```bash
npm install-scripts ls                                # list what's pending, and why
npm install-scripts approve <package>                 # approve after reviewing the script
npm install-scripts deny <package>                    # explicitly block instead
```

Approvals are pinned to the reviewed version by default and written to `package.json` — commit them. This is a hard failure point for any native-module dependency (the debug screen's `react-native-maps`, or anything using `node-gyp`) if left unapproved: a skipped native build doesn't fail the install, it fails later at runtime when the module can't load. If a task's build fails mysteriously after adding a dependency, check for unapproved scripts before assuming the config or the code is wrong.

**nitrogen (v0.36.1, vision-camera's Nitro spec codegen) cannot handle cross-module spec inheritance.** A TS spec using `extends` on a type from another module (e.g. `extends CameraOutput`) generates Swift that doesn't compile — wrong namespace for inherited struct types, and `override` on members vision-camera emits as `public` (not `open`), which Swift forbids across module boundaries. Write standalone specs only; if a native class needs to hand back an external HybridObject, return it from a method (`getX(): ExternalType`) instead of inheriting its spec. This is the same pattern vision-camera's own nitro-image integration uses — not a workaround, the intended approach for cross-module composition.

**Never run `expo`/`npm` commands from inside a `modules/` subdirectory**, including in the background. If Expo's CLI picks up a module's folder as its working directory, it can treat that module as the app itself and overwrite/delete files in it (this happened once during checkpoint 3 — a background `expo run:ios` inherited a module's `cwd` and deleted a native source file; recovered from context, but avoidable). Always invoke these commands from the project root with an explicit path if running anything non-interactively or in the background.

**Jest must stay on the 29.x line, not 30** — `jest-expo@57` packages Jest 29 internals, and Jest 30 calls APIs that don't exist on that internal version (e.g. `clearMocksOnScope`). Same shape as the ESLint 9/10 constraint: don't "helpfully" upgrade without re-checking this.

**TypeScript 6 no longer auto-includes `@types/*` packages.** Add `"types": ["jest"]` explicitly to `tsconfig.json` (or whichever `@types` package a new dependency needs) — omitting it produces confusing "cannot find name" errors that look like a missing install, not a missing config line.

**`expo-file-system` v57's `FileHandle` writes bytes, not strings** — `writeBytes(Uint8Array)`, no `write(string)` overload. Encode with `TextEncoder` before each flush. Found while implementing checkpoint 7's CSV buffers. Also: `Append` mode opens but never creates — the target file must exist before the first `open()`, or it throws (checkpoint 8's CSV pre-creation fix).

**`react-native-vision-camera` v5's `setOutputSettings()` is broken under `AVCaptureMultiCamSession`** — confirmed via 5 distinct configurations, always an uncatchable NSException. Never call it in this project (see CLAUDE.md's Video capture row for the workaround). Worth filing upstream as a minimal reproducible bug report if time allows before Thursday — not required for the deliverable, but a clean writeup of "5 configs, same crash, here's the isolated repro" is a genuinely useful contribution and low-cost given the investigation already happened.

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

| Command                            | When                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| `/ponytail-review`                 | Before marking any task complete                                 |
| `/ponytail-debt`                   | End of each session — feeds the README "given more time" section |
| `/ponytail lite\|full\|ultra\|off` | Adjust only with explicit reason                                 |

---

## Superpowers Integration

**Before starting native module work** (custom camera output, GPS module): use `/brainstorming` first — these are the places where a wrong assumption is expensive to unwind in a 2-day window.

**For implementation:** use `/execute-plan`, following the Build Order below as the single source of truth for checkpoints — don't maintain a second list here. Do not start checkpoint N+1 until N produces verifiable output.

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

0. **Tooling setup** — tsconfig (extends `expo/tsconfig.base`, `strict: true`), Prettier (`semi: false`, `singleQuote: true`, rest defaults), ESLint (`eslint-config-expo` + `@typescript-eslint/no-explicit-any: error` + `import/no-default-export: error` scoped off for `app/**`), `lint`/`format`/`format:check` scripts — all verified green (`npx expo lint`, `npx tsc --noEmit`, `npm run format:check`) before any feature code. **Pin ESLint to the 9.x line, not 10** — `eslint-config-expo`'s current internal `eslint-plugin-react` depends on `context.getFilename`, removed in ESLint 10. Do not "helpfully" upgrade this without re-checking that constraint.
1. Expo project scaffold (`expo prebuild`, bare-enough to support native modules and `AVCaptureMultiCamSession`). `npm install`, exact versions from the start.
2. `react-native-vision-camera` installed and configured for dual-camera preview — no timestamp logic yet, just confirm both feeds render simultaneously.
3. Custom native camera output (Swift, `NativeCameraOutput`) — extract `presentationTimeStamp`, buffer in memory, expose to TS. Verify frame count against expected `fps × duration` before moving on.
4. Expo GPS module (Swift) — `CLLocationManager`, hardware timestamp, all required fields including `-1` fallbacks. Native emits a hardware-error signal only; `quality_flag`/`ERROR` sentinel row formatting happens downstream in TS (checkpoint 6/7), not here.
5. `sessionManager.ts` — generates `{epochMs}`, owns folder lifecycle.
6. `gpsInterpolation.ts` — pure function, unit-tested, gap detection + fill.
7. CSV writers + `metadata.json` assembly — buffered, periodic flush.
8. Minimal record UI — preview, record/stop button, timer. Deliberately kept late — it's explicitly not what's being evaluated. **Must set an explicit FPS constraint on both camera outputs** (checkpoint 3 found the back camera negotiates a default 24fps with no constraint set, vs. front's 60fps — GOAL.md calls for highest available quality, and an explicit constraint also restores a real expected-frame-count baseline instead of measuring fps empirically after the fact).
9. `session-debug.tsx` — map with real/interpolated points, counts, gap list. Built once real data exists to visualize; doubles as ongoing dev tool from this point forward.
10. Real recording (30s+ outdoor walk) → validate frame count, GPS continuity, sentinel rows, eyeball via debug screen → produce sample output folder.
11. README write-up (200-400 words) — pull directly from `ponytail:` shortcut comments and Session Report "Decisions made" entries accumulated across sessions, don't write it from scratch at the end.
