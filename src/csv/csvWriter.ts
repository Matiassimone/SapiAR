import type { GpsSample } from 'expo-gps'

import {
  isInterpolatedPoint,
  type GpsStreamEntry,
} from '../interpolation/gpsInterpolation'

export const FRAME_CSV_HEADER = 'Timestamp,Source'
export const LOCATION_CSV_HEADER =
  'Timestamp_unix_ms,Lat,Long,Speed_m_s,Course_deg,CourseAccuracy_deg,HorizontalAccuracy_m,VerticalAccuracy_m,is_interpolated,quality_flag'

export type FrameSource = 'Front' | 'Back'

/**
 * Timestamps are written as integer ms. GOAL.md's unit is Unix milliseconds,
 * and sub-ms fractions from the hardware clocks are below both sensors'
 * meaningful resolution.
 */
export function formatFrameRow(
  timestampMs: number,
  source: FrameSource,
): string {
  return `${Math.round(timestampMs)},${source}`
}

/**
 * CoreLocation encodes "unavailable" as negative values. The spec wants
 * those written as exactly -1.
 */
function numericColumn(value: number | null): number {
  return value == null || value < 0 ? -1 : value
}

export function formatLocationRow(entry: GpsStreamEntry): string {
  if (isInterpolatedPoint(entry)) {
    return `${Math.round(entry.timestampMs)},${entry.lat},${entry.long},-1,-1,-1,-1,-1,1,INTERP`
  }
  if (entry.errorCode != null) {
    // GOAL.md wants the sentinel row with ALL numeric fields -1, including the
    // timestamp, even though the native module knows when the error arrived.
    return '-1,-1,-1,-1,-1,-1,-1,-1,0,ERROR'
  }
  const horizontalAccuracy = numericColumn(entry.horizontalAccuracyM)
  // An invalid fix (accuracy < 0) can't claim ≤20m confidence, so it can
  // never be OK. An edge GOAL.md doesn't address, decided here.
  const quality =
    horizontalAccuracy >= 0 && horizontalAccuracy <= 20 ? 'OK' : 'LOW_ACCURACY'
  return [
    entry.timestampMs == null ? -1 : Math.round(entry.timestampMs),
    entry.lat ?? -1,
    entry.long ?? -1,
    numericColumn(entry.speedMs),
    numericColumn(entry.courseDeg),
    numericColumn(entry.courseAccuracyDeg),
    horizontalAccuracy,
    numericColumn(entry.verticalAccuracyM),
    0,
    quality,
  ].join(',')
}

/**
 * Drops fixes timestamped before the session epoch. CoreLocation's first
 * delivery is often a cached pre-session location, confirmed on device
 * (an 80.2s-old fix inside a 20s-old session). Must run before
 * interpolation, or that cached fix anchors synthetic points that never
 * happened. Error entries carry no timestamp and are kept regardless,
 * they still owe a sentinel row.
 */
export function filterPreSessionSamples(
  samples: readonly GpsSample[],
  epochMs: number,
): GpsSample[] {
  return samples.filter(
    (sample) => sample.timestampMs == null || sample.timestampMs >= epochMs,
  )
}
