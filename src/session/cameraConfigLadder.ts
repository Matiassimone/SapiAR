interface ResolutionTarget {
  width: number
  height: number
}

export interface CameraConfigCandidate {
  /** 1-based rung number, exported to metadata.json for transparency. */
  step: number
  degraded: boolean
  targetResolution: ResolutionTarget
  binned: boolean
  fps: number
}

/**
 * Ordered degradation ladder for AVCaptureMultiCamSession bring-up
 * failures (hardwareCost over budget, error -11872). Ideal config first,
 * then Apple's documented mitigations, binned at the same target, then
 * one tier down still binned. The user-selected fps is preserved on every
 * rung. The ladder degrades resolution and binning, never the explicit rate
 * choice. Tiers are symbolic negotiation targets (see the design note),
 * device-agnostic because targetResolution asks for "this class or the
 * nearest supported," never a literal device format.
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
