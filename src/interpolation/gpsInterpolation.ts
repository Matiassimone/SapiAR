import type { GpsSample } from 'expo-gps'

/**
 * A synthetic point created by gap interpolation. Real and hardware-error
 * entries pass through `interpolateGpsGaps` unchanged — OK/LOW_ACCURACY and
 * ERROR classification belong to CSV assembly (checkpoint 7), so this module
 * only ever assigns the one flag it owns: INTERP.
 */
export interface InterpolatedPoint {
  timestampMs: number
  lat: number
  long: number
  speedMs: number
  courseDeg: number
  courseAccuracyDeg: number
  horizontalAccuracyM: number
  verticalAccuracyM: number
  isInterpolated: true
  qualityFlag: 'INTERP'
}

export type GpsStreamEntry = GpsSample | InterpolatedPoint

// ponytail: 3000ms = 3× the 1Hz cadence verified on-device in checkpoint 4.
// One missed update (2s silence) is normal jitter; two or more is a real gap.
// Revisit if Sapios targets a different update rate or tighter continuity.
export const GPS_GAP_THRESHOLD_MS = 3000

export function isInterpolatedPoint(
  entry: unknown,
): entry is InterpolatedPoint {
  return (
    typeof entry === 'object' &&
    entry != null &&
    'isInterpolated' in entry &&
    (entry as InterpolatedPoint).isInterpolated === true
  )
}

interface RealFix {
  timestampMs: number
  lat: number
  long: number
}

function asRealFix(sample: GpsSample): RealFix | null {
  if (
    sample.errorCode == null &&
    sample.timestampMs != null &&
    sample.lat != null &&
    sample.long != null
  ) {
    return {
      timestampMs: sample.timestampMs,
      lat: sample.lat,
      long: sample.long,
    }
  }
  return null
}

/**
 * Fills gaps above `gapThresholdMs` with evenly spaced synthetic points so no
 * consecutive positioned-point delta exceeds the threshold (GOAL.md §4 "no
 * large holes"; CLAUDE.md Validation Strategy checks exactly this property).
 *
 * Gap boundaries are real fixes only — hardware-error entries carry no
 * timestamp or position, so they can't bound an interpolation; they pass
 * through in arrival order. A gap with no real fix on one side (start/end of
 * the array) is left alone: linear interpolation needs two bounds, and
 * extrapolating would fabricate a trajectory.
 */
export function interpolateGpsGaps(
  samples: readonly GpsSample[],
  gapThresholdMs: number = GPS_GAP_THRESHOLD_MS,
): GpsStreamEntry[] {
  const result: GpsStreamEntry[] = []
  let previousFix: RealFix | null = null

  for (const sample of samples) {
    const fix = asRealFix(sample)
    if (fix != null && previousFix != null) {
      result.push(...syntheticPointsBetween(previousFix, fix, gapThresholdMs))
    }
    result.push(sample)
    if (fix != null) previousFix = fix
  }
  return result
}

// ponytail: linear position only — speed/course/accuracies are -1 on
// synthetic rows, not interpolated. They weren't measured, the bounding
// fixes frequently carry -1 themselves (stationary case, checkpoint 4),
// and INTERP + -1 keeps synthetic rows unmistakable downstream. Revisit if
// Sapios wants dead-reckoned kinematics.
function syntheticPointsBetween(
  from: RealFix,
  to: RealFix,
  gapThresholdMs: number,
): InterpolatedPoint[] {
  const gapMs = to.timestampMs - from.timestampMs
  if (gapMs <= gapThresholdMs) return []

  const segments = Math.ceil(gapMs / gapThresholdMs)
  const points: InterpolatedPoint[] = []
  for (let i = 1; i < segments; i++) {
    const fraction = i / segments
    points.push({
      timestampMs: from.timestampMs + gapMs * fraction,
      lat: from.lat + (to.lat - from.lat) * fraction,
      long: from.long + (to.long - from.long) * fraction,
      speedMs: -1,
      courseDeg: -1,
      courseAccuracyDeg: -1,
      horizontalAccuracyM: -1,
      verticalAccuracyM: -1,
      isInterpolated: true,
      qualityFlag: 'INTERP',
    })
  }
  return points
}
