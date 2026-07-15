import { ExpoGps, type GpsSample } from 'expo-gps'
import { StatusBar } from 'expo-status-bar'
import {
  createFrameTimestampController,
  type FrameTimestampController,
} from 'frame-timestamp-plugin'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  NativePreviewView,
  VisionCamera,
  type CameraPreviewOutput,
  type CameraSession,
  type CameraSessionConnection,
} from 'react-native-vision-camera'

interface DualPreviews {
  front: CameraPreviewOutput
  back: CameraPreviewOutput
}

interface CameraFrameStats {
  count: number
  dropped: number
  fps: number | null
}

/**
 * Checkpoint-3/4 verification readout (temporary — replaced by the record UI
 * in checkpoint 8): per-camera captured/dropped/expected frame counts plus
 * GPS buffer state, with one-shot drains proving the buffers are readable
 * from TS and timestamp spans match the elapsed window. See CLAUDE.md
 * Validation Strategy.
 */
interface FrameVerification {
  elapsedS: number
  front: CameraFrameStats
  back: CameraFrameStats
  drainSummary: string | null
  gpsCount: number
  gpsDrainSummary: string | null
}

function expectedFrames(stats: CameraFrameStats, elapsedS: number): string {
  if (stats.fps == null) return '?'
  return String(Math.round(stats.fps * elapsedS))
}

export default function App() {
  const [previews, setPreviews] = useState<DualPreviews | null>(null)
  const [status, setStatus] = useState('Starting cameras…')
  const [verification, setVerification] = useState<FrameVerification | null>(
    null,
  )
  const drainSummaryRef = useRef<string | null>(null)
  const gpsDrainSummaryRef = useRef<string | null>(null)
  const [gpsStatus, setGpsStatus] = useState<string | null>(null)

  useEffect(() => {
    let session: CameraSession | undefined
    let interval: ReturnType<typeof setInterval> | undefined
    let gpsInterval: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    // GPS capture is independent of the cameras — started first, and its
    // verification ticks on its own interval, so it runs on devices (and the
    // simulator, via simctl simulated location) where multi-cam is
    // unavailable and the camera setup exits early.
    const setupGps = async (): Promise<void> => {
      const gpsGranted = await ExpoGps.requestPermission()
      if (!gpsGranted) {
        console.log('[gps-check] location permission denied — GPS capture off')
        return
      }
      ExpoGps.start()
      const gpsStartedAtMs = Date.now()
      gpsInterval = setInterval(() => {
        const elapsedS = (Date.now() - gpsStartedAtMs) / 1000
        if (elapsedS >= 20 && gpsDrainSummaryRef.current == null) {
          gpsDrainSummaryRef.current = summarizeGpsDrain(ExpoGps.drain())
        }
        const line =
          `[gps-check] t=${elapsedS.toFixed(0)}s buffered=${ExpoGps.count}` +
          (gpsDrainSummaryRef.current != null
            ? ` | ${gpsDrainSummaryRef.current}`
            : '')
        // Both channels on purpose: Metro logs for remote reading, on-screen
        // text so verification survives a broken dev-client log socket
        // (observed during this checkpoint) and works via screenshot.
        console.log(line)
        setGpsStatus(line)
      }, 1000)
    }

    const setup = async (): Promise<void> => {
      const granted =
        VisionCamera.cameraPermissionStatus === 'authorized' ||
        (await VisionCamera.requestCameraPermission())
      if (!granted) {
        setStatus('Camera permission denied — enable it in Settings.')
        return
      }
      if (!VisionCamera.supportsMultiCamSessions) {
        setStatus(
          'This device does not support simultaneous multi-camera capture.',
        )
        return
      }

      // Only hardware-supported device combinations can share one multi-cam
      // session; pick the first combination that offers a front + back pair
      // rather than pairing arbitrary devices ourselves.
      const deviceFactory = await VisionCamera.createDeviceFactory()
      const combination =
        deviceFactory.supportedMultiCamDeviceCombinations.find(
          (combo) =>
            combo.some((device) => device.position === 'front') &&
            combo.some((device) => device.position === 'back'),
        )
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

      const front = VisionCamera.createPreviewOutput()
      const back = VisionCamera.createPreviewOutput()
      const frontTimestamps = createFrameTimestampController()
      const backTimestamps = createFrameTimestampController()
      let frontFps: number | null = null
      let backFps: number | null = null
      // ponytail: preview + timestamp outputs only, default formats
      // (constraints: []). Recording outputs + HEVC constraints land later.
      const connections: CameraSessionConnection[] = [
        {
          input: frontDevice,
          outputs: [
            { output: front, mirrorMode: 'auto' },
            { output: frontTimestamps.getCameraOutput(), mirrorMode: 'auto' },
          ],
          constraints: [],
          onSessionConfigSelected: (config) => {
            frontFps = config.selectedFPS ?? null
          },
        },
        {
          input: backDevice,
          outputs: [
            { output: back, mirrorMode: 'auto' },
            { output: backTimestamps.getCameraOutput(), mirrorMode: 'auto' },
          ],
          constraints: [],
          onSessionConfigSelected: (config) => {
            backFps = config.selectedFPS ?? null
          },
        },
      ]
      session = await VisionCamera.createCameraSession(true)
      await session.configure(connections)
      if (cancelled) return
      await session.start()
      setPreviews({ front, back })

      // Elapsed here is verification arithmetic for the readout, not a data
      // timestamp — frame rows only ever carry the native hardware clock.
      const startedAtMs = Date.now()
      interval = setInterval(() => {
        const elapsedS = (Date.now() - startedAtMs) / 1000
        if (elapsedS >= 15 && drainSummaryRef.current == null) {
          drainSummaryRef.current = summarizeDrain(
            frontTimestamps,
            backTimestamps,
          )
        }
        const snapshot: FrameVerification = {
          elapsedS,
          front: {
            count: frontTimestamps.count,
            dropped: frontTimestamps.droppedCount,
            fps: frontFps,
          },
          back: {
            count: backTimestamps.count,
            dropped: backTimestamps.droppedCount,
            fps: backFps,
          },
          drainSummary: drainSummaryRef.current,
          gpsCount: ExpoGps.count,
          gpsDrainSummary: gpsDrainSummaryRef.current,
        }
        setVerification(snapshot)
        // Mirrored to Metro so the frame-count check can be read off-device
        // during development (CLAUDE.md Validation Strategy). Temporary, like
        // the overlay itself — removed with it in checkpoint 8.
        console.log(
          `[frame-check] t=${elapsedS.toFixed(0)}s ` +
            `back=${snapshot.back.count}/exp ${expectedFrames(snapshot.back, elapsedS)} (drop ${snapshot.back.dropped}) ` +
            `front=${snapshot.front.count}/exp ${expectedFrames(snapshot.front, elapsedS)} (drop ${snapshot.front.dropped})` +
            (snapshot.drainSummary != null
              ? ` | ${snapshot.drainSummary}`
              : ''),
        )
      }, 1000)
    }

    setupGps().catch((error: unknown) => {
      console.log(
        `[gps-check] setup failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    setup().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      if (interval != null) clearInterval(interval)
      if (gpsInterval != null) clearInterval(gpsInterval)
      ExpoGps.stop()
      void session?.stop()
    }
  }, [])

  return (
    <View style={styles.container}>
      {previews != null ? (
        <>
          <NativePreviewView
            style={styles.preview}
            previewOutput={previews.back}
          />
          <NativePreviewView
            style={styles.preview}
            previewOutput={previews.front}
          />
        </>
      ) : (
        <Text style={styles.status}>
          {status}
          {gpsStatus != null ? `\n\n${gpsStatus}` : ''}
        </Text>
      )}
      {verification != null && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>
            {`t=${verification.elapsedS.toFixed(0)}s\n` +
              `Back:  ${verification.back.count} frames (exp ${expectedFrames(verification.back, verification.elapsedS)}, drop ${verification.back.dropped})\n` +
              `Front: ${verification.front.count} frames (exp ${expectedFrames(verification.front, verification.elapsedS)}, drop ${verification.front.dropped})\n` +
              `GPS:   ${verification.gpsCount} buffered` +
              (verification.drainSummary != null
                ? `\n${verification.drainSummary}`
                : '') +
              (verification.gpsDrainSummary != null
                ? `\n${verification.gpsDrainSummary}`
                : '')}
          </Text>
        </View>
      )}
      <StatusBar style="auto" />
    </View>
  )
}

/**
 * One-shot GPS drain summary for checkpoint-4 verification: fix/error split,
 * timestamp monotonicity, span, and what CoreLocation's raw "unavailable"
 * negatives look like when stationary.
 */
function summarizeGpsDrain(samples: GpsSample[]): string {
  const fixes = samples.filter((sample) => sample.errorCode == null)
  const errors = samples.length - fixes.length
  const timestamps = fixes
    .map((sample) => sample.timestampMs)
    .filter((ms): ms is number => ms != null)
  const monotonic = timestamps.every(
    (ms, index) => index === 0 || ms >= (timestamps[index - 1] ?? 0),
  )
  const spanS =
    timestamps.length > 1
      ? ((timestamps[timestamps.length - 1] ?? 0) - (timestamps[0] ?? 0)) / 1000
      : 0
  const negativeSpeed = fixes.filter(
    (sample) => (sample.speedMs ?? 0) < 0,
  ).length
  const negativeCourse = fixes.filter(
    (sample) => (sample.courseDeg ?? 0) < 0,
  ).length
  const first = fixes[0]
  const firstCoords =
    first?.lat != null && first.long != null
      ? `(${first.lat}, ${first.long})`
      : 'n/a'
  const accuracies = fixes
    .map((sample) => sample.horizontalAccuracyM)
    .filter((meters): meters is number => meters != null)
  const accuracyRange =
    accuracies.length > 0
      ? `${Math.min(...accuracies).toFixed(0)}-${Math.max(...accuracies).toFixed(0)}m`
      : 'n/a'
  return (
    `gps drained @20s — ${fixes.length} fixes, ${errors} errors, ` +
    `monotonic=${monotonic}, span ${spanS.toFixed(1)}s, ` +
    `speed<0: ${negativeSpeed}, course<0: ${negativeCourse}, ` +
    `hAcc ${accuracyRange}, first ${firstCoords}`
  )
}

function summarizeDrain(
  frontOutput: FrameTimestampController,
  backOutput: FrameTimestampController,
): string {
  const frontMs = frontOutput.drain()
  const backMs = backOutput.drain()
  const frontSpanS =
    frontMs.length > 1
      ? ((frontMs[frontMs.length - 1] ?? 0) - (frontMs[0] ?? 0)) / 1000
      : 0
  const backSpanS =
    backMs.length > 1
      ? ((backMs[backMs.length - 1] ?? 0) - (backMs[0] ?? 0)) / 1000
      : 0
  return (
    `drained @15s — Back: ${backMs.length} rows, span ${backSpanS.toFixed(2)}s | ` +
    `Front: ${frontMs.length} rows, span ${frontSpanS.toFixed(2)}s`
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
  overlay: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 8,
  },
  overlayText: {
    color: '#0f0',
    fontFamily: 'Menlo',
    fontSize: 12,
  },
})
