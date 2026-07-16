import { File } from 'expo-file-system'
import { ExpoGps } from 'expo-gps'
import type { FrameTimestampController } from 'frame-timestamp-plugin'
import type { CameraVideoOutput, Recorder } from 'react-native-vision-camera'

import { GPS_GAP_THRESHOLD_MS } from '../interpolation/gpsInterpolation'
import { createFrameBuffer } from './frameBuffer'
import { createLocationBuffer } from './locationBuffer'
import { buildMetadataJson, type SessionMetadata } from './metadata'
import { startSession } from './sessionManager'

export interface RecordingDeps {
  frontFrames: FrameTimestampController
  backFrames: FrameTimestampController
  frontVideo: CameraVideoOutput
  backVideo: CameraVideoOutput
  fps: { front: number; back: number } | null
}

export interface ActiveRecording {
  epochMs: number
  stop(): Promise<SessionMetadata>
}

/** RecorderSettings.filePath wants a filesystem path, not a file:// URL. */
function toFilesystemPath(uri: string): string {
  return uri.replace(/^file:\/\//, '')
}

function recordUntilStopped(recorder: Recorder): {
  finished: Promise<void>
  start: () => Promise<void>
} {
  let resolveFinished: () => void
  let rejectFinished: (error: Error) => void
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve
    rejectFinished = reject
  })
  return {
    finished,
    start: () =>
      recorder.startRecording(
        () => resolveFinished(),
        (error) => rejectFinished(error),
      ),
  }
}

/**
 * Owns everything session-scoped: folder + paths, the two recorders, GPS
 * start/stop, the drain/flush cadence, and metadata. The UI hands over the
 * mount-time camera objects and gets back a start/stop surface — no
 * precision logic ever lives in the UI layer (CLAUDE.md Architecture).
 */
export async function startRecordingSession(
  deps: RecordingDeps,
): Promise<ActiveRecording> {
  const session = startSession()
  const { epochMs, paths } = session

  // FileHandle's Append mode opens-but-never-creates (found on device, first
  // real recording) — the empty CSVs must exist before the first flush.
  // Created here, not in sessionManager: readying the pipeline to record is
  // orchestration, and sessionManager stays paths-and-folder only
  // (checkpoint 5 boundary). Truly empty — headers remain buffer-owned,
  // written on first flush (checkpoint 7). The .mov files need no
  // counterpart: the Recorder creates its own output file.
  new File(paths.frameDataUri).create()
  new File(paths.locationDataUri).create()

  const frameBuffer = createFrameBuffer(paths.frameDataUri)
  const locationBuffer = createLocationBuffer(
    paths.locationDataUri,
    epochMs,
    GPS_GAP_THRESHOLD_MS,
  )

  // The timestamp controllers have been buffering since the preview
  // mounted — none of that belongs to this session. GPS hasn't started yet,
  // but a previous session may have left a tail behind.
  deps.frontFrames.drain()
  deps.backFrames.drain()
  ExpoGps.drain()

  const frontRecorder = await deps.frontVideo.createRecorder({
    filePath: toFilesystemPath(paths.frontVideoUri),
  })
  const backRecorder = await deps.backVideo.createRecorder({
    filePath: toFilesystemPath(paths.backVideoUri),
  })
  const front = recordUntilStopped(frontRecorder)
  const back = recordUntilStopped(backRecorder)
  await Promise.all([front.start(), back.start()])

  ExpoGps.start()

  const drainIntoBuffers = (): void => {
    // Second belt for the record-start boundary: a frame captured between
    // the discard above and the recorders spinning up predates the session.
    const inSession = (timestampMs: number): boolean => timestampMs >= epochMs
    frameBuffer.appendFrames(
      deps.frontFrames.drain().filter(inSession),
      'Front',
    )
    frameBuffer.appendFrames(deps.backFrames.drain().filter(inSession), 'Back')
    locationBuffer.appendSamples(ExpoGps.drain())
    frameBuffer.flush()
    locationBuffer.flush()
  }

  // One 1s cadence for drain+append+flush: ~60 frame rows per write is
  // already "periodic, not per-row" (CLAUDE.md) without a second timer.
  const interval = setInterval(drainIntoBuffers, 1000)

  return {
    epochMs,
    async stop() {
      clearInterval(interval)
      const stopping = Promise.all([front.finished, back.finished])
      await Promise.all([
        frontRecorder.stopRecording(),
        backRecorder.stopRecording(),
      ])
      await stopping
      ExpoGps.stop()
      drainIntoBuffers()

      // Read at stop, not at mount: currentResolution populates
      // asynchronously after the outputs connect (an immediate read races
      // it — checkpoint 8's delayed log). By session end it has been
      // stable for the whole recording.
      const frontResolution = deps.frontVideo.currentResolution
      const backResolution = deps.backVideo.currentResolution
      const metadata: SessionMetadata = {
        epochMs,
        // Bookkeeping duration, same legal status as epochMs (checkpoint 5) —
        // data rows only ever carry native hardware clocks.
        durationMs: Date.now() - epochMs,
        frames: frameBuffer.counts(),
        gps: locationBuffer.counts(),
        fps: deps.fps,
        resolution:
          frontResolution != null && backResolution != null
            ? {
                front: {
                  width: frontResolution.width,
                  height: frontResolution.height,
                },
                back: {
                  width: backResolution.width,
                  height: backResolution.height,
                },
              }
            : null,
      }
      const metadataFile = new File(paths.metadataUri)
      metadataFile.create()
      metadataFile.write(buildMetadataJson(metadata))
      return metadata
    },
  }
}
