interface CameraResolution {
  width: number
  height: number
}

export interface SessionMetadata {
  epochMs: number
  durationMs: number
  frames: { front: number; back: number }
  gps: { real: number; interpolated: number; error: number }
  /** Negotiated fps per camera; null when the session never learned them. */
  fps: { front: number; back: number } | null
  /**
   * Negotiated recording resolution per camera (sensor-native pixels);
   * null when the outputs never reported one. Exported so validation can
   * cross-check the videos without probing the files (checkpoint 9 gap).
   */
  resolution: { front: CameraResolution; back: CameraResolution } | null
}

// ponytail: GOAL.md requires metadata.json but leaves the schema open. This
// is the minimum a downstream analyst needs to sanity-check a session
// (identity, duration, row counts to cross-check the CSVs, fps/resolution
// for the frame-count and quality validation). Extend only when a consumer
// actually needs more.
export function buildMetadataJson(metadata: SessionMetadata): string {
  const { fps, resolution, ...base } = metadata
  return JSON.stringify(
    {
      ...base,
      ...(fps == null ? {} : { fps }),
      ...(resolution == null ? {} : { resolution }),
    },
    null,
    2,
  )
}
