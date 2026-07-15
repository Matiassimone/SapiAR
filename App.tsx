import { ExpoGps } from 'expo-gps'
import { StatusBar } from 'expo-status-bar'
import { createFrameTimestampController } from 'frame-timestamp-plugin'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  CommonResolutions,
  NativePreviewView,
  VisionCamera,
  type CameraPreviewOutput,
  type CameraSession,
  type CameraSessionConnection,
  type CameraVideoOutput,
} from 'react-native-vision-camera'

import {
  startRecordingSession,
  type ActiveRecording,
  type RecordingDeps,
} from './src/session/recordingSession'

interface CameraRig {
  previews: { front: CameraPreviewOutput; back: CameraPreviewOutput }
  recordingDeps: RecordingDeps
}

// ponytail: fps fixed at 30 for both cameras — iPhone 12 Pro multi-cam
// formats cap there in practice, and a uniform rate keeps the frame-count
// validation arithmetic (fps × duration × 2) uniform. Revisit per-device
// if Sapios targets hardware with higher multi-cam ceilings.
const TARGET_FPS = 30

export default function App() {
  const [rig, setRig] = useState<CameraRig | null>(null)
  const [status, setStatus] = useState('Starting cameras…')
  const [elapsedS, setElapsedS] = useState<number | null>(null)
  const recordingRef = useRef<ActiveRecording | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let session: CameraSession | undefined
    let cancelled = false

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

      const previews = {
        front: VisionCamera.createPreviewOutput(),
        back: VisionCamera.createPreviewOutput(),
      }
      const frontFrames = createFrameTimestampController()
      const backFrames = createFrameTimestampController()

      // HIGHEST_4_3 expresses GOAL.md's "highest available quality" as
      // negotiation intent — multi-cam formats on this hardware are 4:3
      // sensor-native families. The target alone is NOT enough: without the
      // resolutionBias + binned:false constraints below, the multi-cam
      // negotiator settles on its smallest binned format (640×480, verified
      // on device) regardless of any output's target resolution.
      const createVideo = (): CameraVideoOutput =>
        VisionCamera.createVideoOutput({
          targetResolution: CommonResolutions.HIGHEST_4_3,
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
          input: frontDevice,
          outputs: [
            { output: previews.front, mirrorMode: 'auto' },
            { output: frontFrames.getCameraOutput(), mirrorMode: 'auto' },
            { output: frontVideo, mirrorMode: 'auto' },
          ],
          constraints: [
            { fps: TARGET_FPS },
            { resolutionBias: frontVideo },
            { binned: false },
          ],
          onSessionConfigSelected: (config) => {
            frontFps = config.selectedFPS ?? null
          },
        },
        {
          input: backDevice,
          outputs: [
            { output: previews.back, mirrorMode: 'auto' },
            { output: backFrames.getCameraOutput(), mirrorMode: 'auto' },
            { output: backVideo, mirrorMode: 'auto' },
          ],
          constraints: [
            { fps: TARGET_FPS },
            { resolutionBias: backVideo },
            { binned: false },
          ],
          onSessionConfigSelected: (config) => {
            backFps = config.selectedFPS ?? null
          },
        },
      ]
      session = await VisionCamera.createCameraSession(true)
      await session.configure(connections)
      // setOutputSettings is NEVER called: under AVCaptureMultiCamSession it
      // throws an uncatchable ObjC exception on every attempt — binned or
      // non-binned format, h265 listed in getSupportedVideoCodecs() or not
      // (verified across five on-device configurations; vision-camera v5
      // library bug). The library's default codec is empirically HEVC/hvc1
      // on this hardware, satisfying GOAL.md §1's "HEVC preferred" — the
      // one-shot log below is the per-run evidence for that reliance.
      console.log(
        `[camera-config] codecs — front: ${frontVideo.getSupportedVideoCodecs().join('/')}, ` +
          `back: ${backVideo.getSupportedVideoCodecs().join('/')} ` +
          '(relying on library default; setOutputSettings crashes under multi-cam)',
      )
      if (cancelled) return
      await session.start()
      // Delayed read: currentResolution populates asynchronously after the
      // connections form — an immediate read after start() races it.
      setTimeout(() => {
        console.log(
          `[camera-config] negotiated resolutions — front: ${JSON.stringify(frontVideo.currentResolution)}, back: ${JSON.stringify(backVideo.currentResolution)}, fps — front: ${String(frontFps)}, back: ${String(backFps)}`,
        )
      }, 3000)

      setRig({
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
        },
      })
      setStatus('')
    }

    setup().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      if (timerRef.current != null) clearInterval(timerRef.current)
      void recordingRef.current?.stop()
      ExpoGps.stop()
      void session?.stop()
    }
  }, [])

  const toggleRecording = async (): Promise<void> => {
    if (rig == null) return
    if (recordingRef.current == null) {
      const recording = await startRecordingSession(rig.recordingDeps)
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
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#e33',
  },
})
