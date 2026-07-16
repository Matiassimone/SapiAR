import { ExpoGps } from 'expo-gps'
import { StatusBar } from 'expo-status-bar'
import { createFrameTimestampController } from 'frame-timestamp-plugin'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import {
  CommonResolutions,
  NativePreviewView,
  VisionCamera,
  type CameraDevice,
  type CameraPreviewOutput,
  type CameraSession,
  type CameraSessionConnection,
  type CameraVideoOutput,
  type ListenerSubscription,
} from 'react-native-vision-camera'

import SessionDebugScreen from './app/session-debug'
import {
  buildCandidateLadder,
  nextCandidate,
  type CameraConfigCandidate,
} from './src/session/cameraConfigLadder'
import type { SessionEvent } from './src/session/metadata'
import {
  startRecordingSession,
  type ActiveRecording,
  type RecordingDeps,
} from './src/session/recordingSession'

interface CameraRig {
  previews: { front: CameraPreviewOutput; back: CameraPreviewOutput }
  recordingDeps: RecordingDeps
}

// ponytail: 30fps default — iPhone 12 Pro multi-cam formats cap there in
// practice, and a uniform rate keeps the frame-count validation arithmetic
// (fps × duration × 2) uniform. Overridable from the debug settings (24/30/
// 60) for experimentation; whatever actually negotiates lands in
// metadata.json, which is what the Validate check reads.
const DEFAULT_FPS = 30

export default function App() {
  const [rig, setRig] = useState<CameraRig | null>(null)
  const [status, setStatus] = useState('Starting cameras…')
  const [elapsedS, setElapsedS] = useState<number | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [targetFps, setTargetFps] = useState(DEFAULT_FPS)
  // Non-null = the camera pipeline is known-unhealthy; the string is shown
  // in a tappable banner and tapping bumps retryNonce to force a full
  // session teardown + renegotiation (the same proven path an fps change
  // takes). Added after intermittent black previews on unplugged cold
  // launches — see README Pre-checkpoint-10.
  const [cameraHealth, setCameraHealth] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  // Brief auto-dismissing notice for events that fire DURING a recording —
  // distinct from the red banner (which means "bring-up ladder exhausted").
  const [toast, setToast] = useState<string | null>(null)
  const recordingRef = useRef<ActiveRecording | null>(null)
  const startingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Append-only session event log (observability only — never read by
  // recording/retry logic). recordingSession scopes it per session by
  // timestamp at stop(); see metadata.ts SessionEvent for the Date.now()
  // legality note.
  const eventsRef = useRef<SessionEvent[]>([])

  const recordEvent = (type: SessionEvent['type'], detail: string): void => {
    eventsRef.current.push({ timestampMs: Date.now(), type, detail })
    if (recordingRef.current != null) {
      setToast(`${type}${detail === '' ? '' : `: ${detail}`}`)
      if (toastTimerRef.current != null) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToast(null), 4000)
    }
  }

  useEffect(() => {
    let session: CameraSession | undefined
    let cancelled = false
    const healthSubs: ListenerSubscription[] = []

    // First-frame gate, reusing the health watchdog's signal (count === 0
    // on a timestamp controller): resolves true as soon as both cameras
    // have delivered a frame, false on the 5 s deadline, cancellation, or
    // an external failure (interruption/error during bring-up).
    const waitForFirstFrames = (
      frontFrames: { count: number },
      backFrames: { count: number },
      registerFail: (fail: () => void) => void,
    ): Promise<boolean> =>
      new Promise((resolve) => {
        let ticks = 0
        const poll = setInterval(() => {
          if (frontFrames.count > 0 && backFrames.count > 0) {
            clearInterval(poll)
            resolve(true)
          } else if (cancelled || ++ticks >= 25) {
            clearInterval(poll)
            resolve(false)
          }
        }, 200)
        registerFail(() => {
          clearInterval(poll)
          resolve(false)
        })
      })

    // One full bring-up attempt with a single ladder candidate: fresh
    // outputs + session per attempt (a failed session's outputs are never
    // reused). Returns null on any failure — the caller moves down the
    // ladder. Silent by design: only ladder exhaustion reaches the user.
    const attemptCandidate = async (
      candidate: CameraConfigCandidate,
      devices: { front: CameraDevice; back: CameraDevice },
    ): Promise<CameraRig | null> => {
      const previews = {
        front: VisionCamera.createPreviewOutput(),
        back: VisionCamera.createPreviewOutput(),
      }
      const frontFrames = createFrameTimestampController()
      const backFrames = createFrameTimestampController()

      // The candidate's target expresses GOAL.md's "highest available
      // quality" as negotiation intent (rung 1: HIGHEST_4_3, non-binned) —
      // multi-cam formats on this hardware are 4:3 sensor-native families.
      // The target alone is NOT enough: without the resolutionBias + binned
      // constraints below, the multi-cam negotiator settles on its smallest
      // binned format (640×480, verified on device) regardless of any
      // output's target resolution.
      const createVideo = (): CameraVideoOutput =>
        VisionCamera.createVideoOutput({
          targetResolution: candidate.targetResolution,
        })
      const frontVideo = createVideo()
      const backVideo = createVideo()

      let frontFps: number | null = null
      let backFps: number | null = null

      // Video outputs join the session at mount: reconfiguring a running
      // session re-negotiates formats and glitches the preview; an idle
      // recorder output does no encoding work (see checkpoint 8 design doc).
      const connections: CameraSessionConnection[] = [
        {
          input: devices.front,
          outputs: [
            { output: previews.front, mirrorMode: 'auto' },
            { output: frontFrames.getCameraOutput(), mirrorMode: 'auto' },
            { output: frontVideo, mirrorMode: 'auto' },
          ],
          constraints: [
            { fps: candidate.fps },
            { resolutionBias: frontVideo },
            { binned: candidate.binned },
          ],
          onSessionConfigSelected: (config) => {
            frontFps = config.selectedFPS ?? null
          },
        },
        {
          input: devices.back,
          outputs: [
            { output: previews.back, mirrorMode: 'auto' },
            { output: backFrames.getCameraOutput(), mirrorMode: 'auto' },
            { output: backVideo, mirrorMode: 'auto' },
          ],
          constraints: [
            { fps: candidate.fps },
            { resolutionBias: backVideo },
            { binned: candidate.binned },
          ],
          onSessionConfigSelected: (config) => {
            backFps = config.selectedFPS ?? null
          },
        },
      ]

      let attemptSession: CameraSession | undefined
      try {
        attemptSession = await VisionCamera.createCameraSession(true)
        // Session-health listeners — the JS bridge of AVFoundation's
        // interruption/runtime-error notifications. Role switches at first
        // frame: before it they fail this bring-up attempt (ladder mode,
        // silent); after it they feed the red banner with the actual cause
        // (e.g. 'video-device-not-available-due-to-system-pressure').
        let broughtUp = false
        let failBringUp: (() => void) | undefined
        healthSubs.push(
          attemptSession.addOnErrorListener((error) => {
            if (broughtUp) {
              recordEvent('error', error.message)
              setCameraHealth(`Camera error: ${error.message} — tap to retry`)
            } else {
              failBringUp?.()
            }
          }),
          attemptSession.addOnInterruptionStartedListener((reason) => {
            if (broughtUp) {
              recordEvent('interruption-started', reason)
              setCameraHealth(`Camera interrupted: ${reason} — tap to retry`)
            } else {
              failBringUp?.()
            }
          }),
          attemptSession.addOnInterruptionEndedListener(() => {
            if (broughtUp) {
              recordEvent('interruption-ended', '')
              setCameraHealth(null)
            }
          }),
          attemptSession.addOnStartedListener(() => {
            recordEvent('started', `rung ${candidate.step}`)
            console.log('[camera-health] session started')
          }),
          attemptSession.addOnStoppedListener(() => {
            recordEvent('stopped', '')
            console.log('[camera-health] session stopped')
          }),
        )
        await attemptSession.configure(connections)
        // setOutputSettings is NEVER called: under AVCaptureMultiCamSession
        // it throws an uncatchable ObjC exception on every attempt — binned
        // or non-binned format, h265 listed in getSupportedVideoCodecs() or
        // not (verified across five on-device configurations; vision-camera
        // v5 library bug). The library's default codec is empirically
        // HEVC/hvc1 on this hardware, satisfying GOAL.md §1's "HEVC
        // preferred" — the one-shot log below is the per-run evidence.
        console.log(
          `[camera-config] rung ${candidate.step} codecs — front: ${frontVideo.getSupportedVideoCodecs().join('/')}, ` +
            `back: ${backVideo.getSupportedVideoCodecs().join('/')} ` +
            '(relying on library default; setOutputSettings crashes under multi-cam)',
        )
        if (cancelled) {
          void attemptSession.stop()
          return null
        }
        await attemptSession.start()
        const framesFlowing = await waitForFirstFrames(
          frontFrames,
          backFrames,
          (fail) => {
            failBringUp = fail
          },
        )
        if (!framesFlowing || cancelled) {
          void attemptSession.stop()
          return null
        }
        broughtUp = true
        // Delayed read: currentResolution populates asynchronously after
        // the connections form — an immediate read after start() races it.
        setTimeout(() => {
          console.log(
            `[camera-config] negotiated resolutions — front: ${JSON.stringify(frontVideo.currentResolution)}, back: ${JSON.stringify(backVideo.currentResolution)}, fps — front: ${String(frontFps)}, back: ${String(backFps)}`,
          )
        }, 3000)
        session = attemptSession
        return {
          previews,
          recordingDeps: {
            frontFrames,
            backFrames,
            frontVideo,
            backVideo,
            fps:
              frontFps != null && backFps != null
                ? { front: frontFps, back: backFps }
                : null,
            cameraConfig: {
              step: candidate.step,
              degraded: candidate.degraded,
              binned: candidate.binned,
            },
            sessionEvents: () => [...eventsRef.current],
          },
        }
      } catch (error: unknown) {
        console.log(
          `[camera-config] rung ${candidate.step} failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        void attemptSession?.stop()
        return null
      }
    }

    const setup = async (): Promise<void> => {
      const cameraGranted =
        VisionCamera.cameraPermissionStatus === 'authorized' ||
        (await VisionCamera.requestCameraPermission())
      if (!cameraGranted) {
        setStatus('Camera permission denied — enable it in Settings.')
        return
      }
      void ExpoGps.requestPermission()

      if (!VisionCamera.supportsMultiCamSessions) {
        setStatus(
          'This device does not support simultaneous multi-camera capture.',
        )
        return
      }

      // Only hardware-supported device combinations can share one multi-cam
      // session — never pair devices manually. Among the front+back
      // combinations, the LAST one is used: it's the configuration that
      // verifiably negotiated 1920×1440@30 on device (the first combo
      // reported no currentResolution under identical constraints).
      const deviceFactory = await VisionCamera.createDeviceFactory()
      const frontBackCombos =
        deviceFactory.supportedMultiCamDeviceCombinations.filter(
          (combo) =>
            combo.some((device) => device.position === 'front') &&
            combo.some((device) => device.position === 'back'),
        )
      const combination = frontBackCombos[frontBackCombos.length - 1]
      const frontDevice = combination?.find(
        (device) => device.position === 'front',
      )
      const backDevice = combination?.find(
        (device) => device.position === 'back',
      )
      if (frontDevice == null || backDevice == null) {
        setStatus(
          'No supported front + back camera combination on this device.',
        )
        return
      }

      // Degradation ladder for intermittent hardwareCost failures
      // (-11872) at bring-up: ideal config first, then Apple's documented
      // mitigations. Symbolic tiers, not device pixel values — see
      // docs/design/2026-07-16-camera-config-ladder.md.
      const ladder = buildCandidateLadder(targetFps, [
        CommonResolutions.HIGHEST_4_3,
        CommonResolutions.FHD_4_3,
      ])
      let failures = 0
      let candidate = nextCandidate(ladder, failures)
      while (candidate != null && !cancelled) {
        const rigForCandidate = await attemptCandidate(candidate, {
          front: frontDevice,
          back: backDevice,
        })
        if (rigForCandidate != null) {
          if (candidate.degraded) {
            console.log(
              `[camera-config] ideal config failed at bring-up; running degraded rung ${candidate.step} (binned: ${String(candidate.binned)})`,
            )
          }
          setRig(rigForCandidate)
          setStatus('')
          return
        }
        failures += 1
        candidate = nextCandidate(ladder, failures)
      }
      if (!cancelled) {
        // Every rung failed — only now does the failure reach the user.
        // The banner's manual tap restarts the whole ladder from rung 1.
        setStatus('')
        setCameraHealth('Camera not responding — tap to retry')
      }
    }

    setup().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      for (const sub of healthSubs) sub.remove()
      if (toastTimerRef.current != null) clearTimeout(toastTimerRef.current)
      if (timerRef.current != null) clearInterval(timerRef.current)
      void recordingRef.current?.stop()
      ExpoGps.stop()
      void session?.stop()
    }
    // Re-running on fps change or a health-banner retry tears the camera
    // session down and negotiates fresh — only reachable between recordings
    // (the debug screen that hosts the setting is hidden while recording,
    // and the banner is hidden too), never a live renegotiation.
  }, [targetFps, retryNonce])

  const toggleRecording = async (): Promise<void> => {
    if (rig == null) return
    if (recordingRef.current == null) {
      // Claimed synchronously BEFORE the await: a second tap while the
      // session is still starting must not launch a concurrent session over
      // the same native buffers (double-tap race found in the checkpoint 9
      // duplicate-keys investigation).
      if (startingRef.current) return
      startingRef.current = true
      let recording: ActiveRecording
      try {
        recording = await startRecordingSession(rig.recordingDeps)
      } finally {
        startingRef.current = false
      }
      recordingRef.current = recording
      setElapsedS(0)
      timerRef.current = setInterval(() => {
        setElapsedS(Math.round((Date.now() - recording.epochMs) / 1000))
      }, 1000)
    } else {
      const active = recordingRef.current
      recordingRef.current = null
      if (timerRef.current != null) clearInterval(timerRef.current)
      timerRef.current = null
      setElapsedS(null)
      await active.stop()
    }
  }

  const isRecording = elapsedS != null
  if (showDebug) {
    return (
      <GestureHandlerRootView style={styles.container}>
        <SafeAreaProvider>
          <SessionDebugScreen
            onClose={() => setShowDebug(false)}
            targetFps={targetFps}
            onChangeTargetFps={(fps) => {
              // A pending health banner is stale once the session is about
              // to renegotiate (the effect re-runs on this change).
              setCameraHealth(null)
              setTargetFps(fps)
            }}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    )
  }
  return (
    <View style={styles.container}>
      {rig != null ? (
        <>
          <NativePreviewView
            style={styles.preview}
            previewOutput={rig.previews.back}
          />
          <NativePreviewView
            style={styles.preview}
            previewOutput={rig.previews.front}
          />
          {isRecording && (
            <View style={styles.timer}>
              <Text style={styles.timerText}>
                {`${Math.floor(elapsedS / 60)}:${String(elapsedS % 60).padStart(2, '0')}`}
              </Text>
            </View>
          )}
          <Pressable
            style={styles.recordButton}
            onPress={() => {
              toggleRecording().catch((error: unknown) => {
                setStatus(
                  error instanceof Error ? error.message : String(error),
                )
              })
            }}
          >
            <View style={isRecording ? styles.stopIcon : styles.recordIcon} />
          </Pressable>
        </>
      ) : (
        <Text style={styles.status}>{status}</Text>
      )}
      {rig != null && status !== '' && (
        <Text style={styles.errorBanner}>{status}</Text>
      )}
      {toast != null && isRecording && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
      {cameraHealth != null && !isRecording && (
        <Pressable
          style={styles.healthBanner}
          onPress={() => {
            setCameraHealth(null)
            setRetryNonce((nonce) => nonce + 1)
          }}
        >
          <Text style={styles.healthText}>{cameraHealth}</Text>
        </Pressable>
      )}
      {!isRecording && (
        <Pressable style={styles.debugEntry} onPress={() => setShowDebug(true)}>
          <Text style={styles.debugEntryText}>Sessions</Text>
        </Pressable>
      )}
      <StatusBar style="light" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  preview: {
    flex: 1,
  },
  status: {
    color: '#fff',
    textAlign: 'center',
    padding: 24,
  },
  errorBanner: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    color: '#f66',
    paddingHorizontal: 16,
  },
  timer: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  timerText: {
    color: '#fff',
    fontVariant: ['tabular-nums'],
    fontSize: 18,
  },
  recordButton: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e33',
  },
  toast: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    backgroundColor: 'rgba(40,40,44,0.92)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '85%',
  },
  toastText: {
    color: '#ffb84d',
    fontSize: 13,
    textAlign: 'center',
  },
  healthBanner: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(200,40,40,0.9)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  healthText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  debugEntry: {
    position: 'absolute',
    top: 60,
    right: 16,
  },
  debugEntryText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
  },
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#e33',
  },
})
