interface CameraResolution {
  width: number
  height: number
}

/**
 * Camera-session event surfaced by iOS (interruption, runtime error,
 * start/stop). timestampMs is Date.now() bookkeeping, same legal status as
 * epochMs. No hardware clock exists for an OS notification, and these
 * never substitute for a data-row timestamp.
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
   * null when the outputs never reported one. Exported so the debug screen
   * can show what actually recorded without opening the video files.
   */
  resolution: { front: CameraResolution; back: CameraResolution } | null
  /**
   * Config-ladder rung this session ran on (cameraConfigLadder.ts).
   * degraded=true means the ideal config failed at bring-up and a fallback
   * recorded this session.
   */
  cameraConfig: { step: number; degraded: boolean; binned: boolean } | null
  /**
   * iOS-surfaced events during this recording. Always written, an empty
   * array means "clean as far as iOS reported" (silent degradation with no
   * system event is invisible here). Absent only in pre-logging sessions.
   */
  events: SessionEvent[]
}

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
