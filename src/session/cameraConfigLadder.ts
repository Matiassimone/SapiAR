interface ResolutionTarget {
  width: number
  height: number
}

export interface CameraConfigCandidate {
  step: number
  degraded: boolean
  targetResolution: ResolutionTarget
  binned: boolean
  fps: number
}

/**
 * Fallback ladder for multi-cam bring-up failures (hardwareCost over
 * budget, error -11872). Rung 2 keeps the same resolution but binned,
 * Apple's documented fix for this error. Rung 3 drops a tier too. fps
 * never changes across rungs. Tiers are symbolic targets ("this class
 * or nearest supported"), never hardcoded device pixel values, so the
 * ladder adapts to whatever hardware it runs on.
 */
export function buildCandidateLadder(
  fps: number,
  tiers: readonly ResolutionTarget[],
): CameraConfigCandidate[] {
  const [ideal, lower] = tiers
  if (ideal == null) return []
  const ladder: CameraConfigCandidate[] = [
    { step: 1, degraded: false, targetResolution: ideal, binned: false, fps },
    { step: 2, degraded: true, targetResolution: ideal, binned: true, fps },
  ]
  if (lower != null) {
    ladder.push({
      step: 3,
      degraded: true,
      targetResolution: lower,
      binned: true,
      fps,
    })
  }
  return ladder
}

export function nextCandidate(
  ladder: readonly CameraConfigCandidate[],
  failureCount: number,
): CameraConfigCandidate | null {
  return ladder[failureCount] ?? null
}
