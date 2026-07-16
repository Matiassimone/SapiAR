interface CameraResolution {
  width: number
  height: number
}

/**
 * A camera-session event surfaced by iOS during the app run
 * (interruption, runtime error, session start/stop), captured by the
 * native listeners in App.tsx. timestampMs is Date.now() bookkeeping,
 * same legal status as epochMs and durationMs (checkpoint 5). There is no
 * hardware clock for "the OS delivered a notification," and these never
 * substitute for a data-row timestamp.
 */
export interface SessionEvent {
  timestampMs: number
  type:
    | 'started'
    | 'stopped'
    | 'interruption-started'
    | 'interruption-ended'
    | 'error'
  detail: string
}

export interface SessionMetadata {
  epochMs: number
  durationMs: number
  frames: { front: number; back: number }
  gps: { real: number; interpolated: number; error: number }
  /** Negotiated fps per camera, null when the session never learned them. */
  fps: { front: number; back: number } | null
  /**
   * Negotiated recording resolution per camera in sensor-native pixels,
   * null when the outputs never reported one. Exported so validation can
   * cross-check the videos without probing the files (checkpoint 9 gap).
   */
  resolution: { front: CameraResolution; back: CameraResolution } | null
  /**
   * Which config-ladder rung this session ran on (see
   * cameraConfigLadder.ts). degraded=true means the ideal config failed
   * at bring-up and a fallback recorded this session. Exported so a
   * reviewer can tell a self-selected compromise from full quality.
   */
  cameraConfig: { step: number; degraded: boolean; binned: boolean } | null
  /**
   * iOS-surfaced session events during this recording, chronological.
   * Always written. An empty array is the "clean session" signal (as far
   * as iOS reported, silent degradation with no system event is invisible
   * here). Absent only in sessions predating event logging.
   */
  events: SessionEvent[]
}

// ponytail: GOAL.md requires metadata.json but leaves the schema open. This
// is the minimum a downstream analyst needs to sanity-check a session
// (identity, duration, row counts to cross-check the CSVs, fps/resolution
// for the frame-count and quality validation). Extend only when a consumer
// actually needs more.
export function buildMetadataJson(metadata: SessionMetadata): string {
  const { fps, resolution, cameraConfig, ...base } = metadata
  // events stays in base, always serialized, empty array included.
  return JSON.stringify(
    {
      ...base,
      ...(fps == null ? {} : { fps }),
      ...(resolution == null ? {} : { resolution }),
      ...(cameraConfig == null ? {} : { cameraConfig }),
    },
    null,
    2,
  )
}
