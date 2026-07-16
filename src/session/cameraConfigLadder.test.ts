import { buildCandidateLadder, nextCandidate } from './cameraConfigLadder'

const TIERS = [
  { width: 30000, height: 40000 },
  { width: 1440, height: 1920 },
]

describe('buildCandidateLadder', () => {
  it('orders rungs ideal → binned → lower tier binned', () => {
    const ladder = buildCandidateLadder(30, TIERS)
    expect(ladder).toEqual([
      {
        step: 1,
        degraded: false,
        targetResolution: TIERS[0],
        binned: false,
        fps: 30,
      },
      {
        step: 2,
        degraded: true,
        targetResolution: TIERS[0],
        binned: true,
        fps: 30,
      },
      {
        step: 3,
        degraded: true,
        targetResolution: TIERS[1],
        binned: true,
        fps: 30,
      },
    ])
  })

  it('preserves the user-selected fps on every rung — degradation never overrides it', () => {
    for (const candidate of buildCandidateLadder(60, TIERS)) {
      expect(candidate.fps).toBe(60)
    }
  })

  it('omits the lower-tier rung when only one tier is available', () => {
    const ladder = buildCandidateLadder(30, [TIERS[0]!])
    expect(ladder).toHaveLength(2)
    expect(ladder.map((c) => c.binned)).toEqual([false, true])
  })
})

describe('nextCandidate', () => {
  const ladder = buildCandidateLadder(30, TIERS)

  it('returns rungs in order as failures accumulate', () => {
    expect(nextCandidate(ladder, 0)).toBe(ladder[0])
    expect(nextCandidate(ladder, 1)).toBe(ladder[1])
    expect(nextCandidate(ladder, 2)).toBe(ladder[2])
  })

  it('returns null when the ladder is exhausted', () => {
    expect(nextCandidate(ladder, 3)).toBeNull()
    expect(nextCandidate(ladder, 99)).toBeNull()
  })
})
