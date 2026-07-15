export interface SessionMetadata {
  epochMs: number
  durationMs: number
  frames: { front: number; back: number }
  gps: { real: number; interpolated: number; error: number }
  /** Negotiated fps per camera; null when the session never learned them. */
  fps: { front: number; back: number } | null
}

// ponytail: GOAL.md requires metadata.json but leaves the schema open. This
// is the minimum a downstream analyst needs to sanity-check a session
// (identity, duration, row counts to cross-check the CSVs, fps for the
// frame-count validation). Extend only when a consumer actually needs more.
export function buildMetadataJson(metadata: SessionMetadata): string {
  const { fps, ...base } = metadata
  return JSON.stringify(fps == null ? base : { ...base, fps }, null, 2)
}
