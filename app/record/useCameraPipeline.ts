import { ExpoGps } from 'expo-gps'
import { createFrameTimestampController } from 'frame-timestamp-plugin'
import { useEffect, useState, type RefObject } from 'react'
import {
  CommonResolutions,
  VisionCamera,
  type CameraDevice,
  type CameraPreviewOutput,
  type CameraSession,
  type CameraSessionConnection,
  type CameraVideoOutput,
  type ListenerSubscription,
} from 'react-native-vision-camera'

import {
  buildCandidateLadder,
  nextCandidate,
  type CameraConfigCandidate,
} from '../../src/session/cameraConfigLadder'
import type { SessionEvent } from '../../src/session/metadata'
import type {
  ActiveRecording,
  RecordingDeps,
} from '../../src/session/recordingSession'

export interface CameraRig {
  previews: { front: CameraPreviewOutput; back: CameraPreviewOutput }
  recordingDeps: RecordingDeps
}

interface CameraPipelineArgs {
  targetFps: number
  recordEvent: (type: SessionEvent['type'], detail: string) => void
  eventsRef: RefObject<SessionEvent[]>
  toastTimerRef: RefObject<ReturnType<typeof setTimeout> | null>
  timerRef: RefObject<ReturnType<typeof setInterval> | null>
  recordingRef: RefObject<ActiveRecording | null>
}

export function useCameraPipeline({
  targetFps,
  recordEvent,
  eventsRef,
  toastTimerRef,
  timerRef,
  recordingRef,
}: CameraPipelineArgs) {
  const [rig, setRig] = useState<CameraRig | null>(null)
  const [status, setStatus] = useState('Starting cameras…')
  const [cameraHealth, setCameraHealth] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // The exhaustive-deps rule cannot see that the incoming refs are stable
  // useRef values from the composition root. The effect must re-run only on
  // targetFps or retryNonce (fps change or manual retry).
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let session: CameraSession | undefined
    let cancelled = false
    const healthSubs: ListenerSubscription[] = []

    // First-frame gate, same zero-count signal as the health watchdog.
    // True once both cameras delivered a frame. False on the 5 s deadline,
    // cancellation, or interruption/error during bring-up.
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

    // One bring-up attempt per ladder candidate. Fresh outputs and session
    // each time, never reused after failure. Null return advances the ladder.
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

      // Target resolution alone isn't enough on this hardware (4:3 multi-cam
      // families). Without resolutionBias + binned below, vision-camera
      // silently negotiates its smallest binned format (640x480, verified on
      // device) no matter what target is set. Found via 5 device experiments,
      // checkpoint 8. Don't remove these constraints as "redundant" with target.
      const createVideo = (): CameraVideoOutput =>
        VisionCamera.createVideoOutput({
          targetResolution: candidate.targetResolution,
        })
      const frontVideo = createVideo()
      const backVideo = createVideo()

      let frontFps: number | null = null
      let backFps: number | null = null

      // Video outputs join at mount. Reconfiguring a running session
      // re-negotiates formats and glitches the preview. An idle recorder
      // output does no encoding work (checkpoint 8 design doc).
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
        // AVFoundation interruption/error listeners. Until first frame they
        // fail the attempt silently (ladder mode). After it they feed the
        // banner with the cause, e.g.
        // 'video-device-not-available-due-to-system-pressure'.
        let broughtUp = false
        let failBringUp: (() => void) | undefined
        healthSubs.push(
          attemptSession.addOnErrorListener((error) => {
            if (broughtUp) {
              recordEvent('error', error.message)
              setCameraHealth(`Camera error (${error.message}). Tap to retry`)
            } else {
              failBringUp?.()
            }
          }),
          attemptSession.addOnInterruptionStartedListener((reason) => {
            if (broughtUp) {
              recordEvent('interruption-started', reason)
              setCameraHealth(`Camera interrupted (${reason}). Tap to retry`)
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
        // Never call setOutputSettings under AVCaptureMultiCamSession. It
        // throws an uncatchable ObjC exception in every config tested (5
        // device experiments, h265 listed as supported or not), a
        // vision-camera v5 bug. The default codec is already HEVC/hvc1 on
        // this hardware. The log below is the per-run evidence.
        console.log(
          `[camera-config] rung ${candidate.step} codecs front ${frontVideo.getSupportedVideoCodecs().join('/')}, ` +
            `back ${backVideo.getSupportedVideoCodecs().join('/')} ` +
            '(relying on library default, setOutputSettings crashes under multi-cam)',
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
        // currentResolution populates async after connections form. Reading
        // right after start() races it, hence the delay.
        setTimeout(() => {
          console.log(
            `[camera-config] negotiated resolutions front ${JSON.stringify(frontVideo.currentResolution)}, back ${JSON.stringify(backVideo.currentResolution)}, fps front ${String(frontFps)}, back ${String(backFps)}`,
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
          `[camera-config] rung ${candidate.step} failed with ${error instanceof Error ? error.message : String(error)}`,
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
        setStatus('Camera permission denied. Enable it in Settings.')
        return
      }
      void ExpoGps.requestPermission()

      if (!VisionCamera.supportsMultiCamSessions) {
        setStatus(
          'This device does not support simultaneous multi-camera capture.',
        )
        return
      }

      // Never pair devices manually, only reported combinations can share a
      // multi-cam session. The LAST front+back combo is used on purpose. It
      // negotiated 1920x1440@30 on device, the first combo reported no
      // currentResolution under identical constraints.
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

      // hardwareCost degradation ladder (-11872). Ideal first, then Apple's
      // documented mitigations. See cameraConfigLadder.ts and its design note.
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
              `[camera-config] ideal config failed at bring-up, running degraded rung ${candidate.step} (binned ${String(candidate.binned)})`,
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
        // Every rung failed. The banner's tap restarts the ladder from rung 1.
        setStatus('')
        setCameraHealth('Camera not responding. Tap to retry')
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
    // Re-runs on fps change or banner retry, full teardown + fresh
    // negotiation. Only reachable between recordings (both triggers are
    // hidden while recording), never a live renegotiation.
  }, [targetFps, retryNonce])
  /* eslint-enable react-hooks/exhaustive-deps */

  const retryBringUp = (): void => {
    setCameraHealth(null)
    setRetryNonce((nonce) => nonce + 1)
  }

  const clearHealth = (): void => {
    setCameraHealth(null)
  }

  return { rig, status, setStatus, cameraHealth, clearHealth, retryBringUp }
}
