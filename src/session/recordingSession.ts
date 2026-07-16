import { File } from 'expo-file-system'
import { ExpoGps } from 'expo-gps'
import type { FrameTimestampController } from 'frame-timestamp-plugin'
import type { CameraVideoOutput, Recorder } from 'react-native-vision-camera'

import { GPS_GAP_THRESHOLD_MS } from '../interpolation/gpsInterpolation'
import { createFrameBuffer } from './frameBuffer'
import { createLocationBuffer } from './locationBuffer'
import {
  buildMetadataJson,
  type SessionEvent,
  type SessionMetadata,
} from './metadata'
import { startSession } from './sessionManager'

export interface RecordingDeps {
  frontFrames: FrameTimestampController
  backFrames: FrameTimestampController
  frontVideo: CameraVideoOutput
  backVideo: CameraVideoOutput
  fps: { front: number; back: number } | null
  cameraConfig: { step: number; degraded: boolean; binned: boolean } | null
  /**
   * Returns every session event collected since app mount. stop() scopes
   * them to this recording by timestamp, with no lifecycle coupling to the
   * UI-owned collector (observability only, never influences recording).
   */
  sessionEvents: () => SessionEvent[]
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
 * Owns everything session-scoped. Folder and paths, the two recorders, GPS
 * start/stop, the drain/flush cadence, and metadata. The UI hands over the
 * mount-time camera objects and gets back a start/stop surface. No
 * precision logic ever lives in the UI layer (CLAUDE.md Architecture).
 */
export async function startRecordingSession(
  deps: RecordingDeps,
): Promise<ActiveRecording> {
  const session = startSession()
  const { epochMs, paths } = session

  // FileHandle Append opens but never creates (device-found bug, first real
  // recording). The CSVs must exist before the first flush. Created here,
  // not in sessionManager (checkpoint 5 keeps it paths-and-folder only).
  // Truly empty, headers stay buffer-owned (checkpoint 7). The .mov files
  // need no counterpart, the Recorder creates its own file.
  new File(paths.frameDataUri).create()
  new File(paths.locationDataUri).create()

  const frameBuffer = createFrameBuffer(paths.frameDataUri)
  const locationBuffer = createLocationBuffer(
    paths.locationDataUri,
    epochMs,
    GPS_GAP_THRESHOLD_MS,
  )

  // Controllers have buffered since preview mount, none of it is this
  // session's. GPS is not started yet but a previous session may have left
  // a tail.
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
    // A frame captured between the discard above and the recorders spinning
    // up predates the session. Second belt for the start boundary.
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

  // One 1s cadence drains all three natives and flushes. ~60 rows per write
  // already satisfies "periodic, not per-row" (CLAUDE.md), no second timer.
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

      // Read at stop, not mount. currentResolution populates async after
      // connect (a mount-time read races it, checkpoint 8). By stop it has
      // been stable all session.
      const frontResolution = deps.frontVideo.currentResolution
      const backResolution = deps.backVideo.currentResolution
      const metadata: SessionMetadata = {
        epochMs,
        // Bookkeeping, same legal status as epochMs (checkpoint 5). Data
        // rows only ever carry native hardware clocks.
        durationMs: Date.now() - epochMs,
        frames: {
          ...frameBuffer.counts(),
          frontDropped: deps.frontFrames.droppedCount,
          backDropped: deps.backFrames.droppedCount,
        },
        gps: locationBuffer.counts(),
        fps: deps.fps,
        cameraConfig: deps.cameraConfig,
        events: deps
          .sessionEvents()
          .filter((event) => event.timestampMs >= epochMs),
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
