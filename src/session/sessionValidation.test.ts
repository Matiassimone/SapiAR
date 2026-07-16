import type { LocationRow } from '../csv/csvReader'
import {
  checkFrameCounts,
  checkGpsContinuity,
  checkSentinelRows,
} from './sessionValidation'

function fix(timestampMs: number): LocationRow {
  return {
    timestampMs,
    lat: 0,
    long: 0,
    isInterpolated: false,
    qualityFlag: 'OK',
  }
}

describe('checkFrameCounts', () => {
  const metadata = { durationMs: 64404, fps: { front: 30, back: 30 } }

  it('passes when actual is within tolerance of fps × duration', () => {
    const result = checkFrameCounts(metadata, { front: 1928, back: 1929 })
    expect(result.front).toMatchObject({
      expected: 1932,
      actual: 1928,
      pass: true,
    })
    expect(result.back.pass).toBe(true)
  })

  it('fails on a large shortfall (dropped frames)', () => {
    const result = checkFrameCounts(metadata, { front: 1700, back: 1929 })
    expect(result.front.pass).toBe(false)
    expect(result.back.pass).toBe(true)
  })

  it('reports unknown when metadata carries no fps', () => {
    const result = checkFrameCounts(
      { durationMs: 64404, fps: null },
      { front: 10, back: 10 },
    )
    expect(result.front.expected).toBeNull()
    expect(result.front.pass).toBeNull()
  })
})

describe('checkGpsContinuity', () => {
  it('passes when no positioned-row delta exceeds the threshold', () => {
    const rows = [fix(0), fix(2500), fix(5000)]
    expect(checkGpsContinuity(rows, 3000)).toMatchObject({
      maxGapMs: 2500,
      thresholdMs: 3000,
      pass: true,
    })
  })

  it('fails when a delta exceeds the threshold', () => {
    const rows = [fix(0), fix(5000)]
    expect(checkGpsContinuity(rows, 3000)).toMatchObject({
      maxGapMs: 5000,
      pass: false,
    })
  })

  it('skips ERROR rows (timestamp -1) without breaking the sequence', () => {
    const rows = [
      fix(0),
      { ...fix(-1), qualityFlag: 'ERROR' as const },
      fix(2000),
    ]
    expect(checkGpsContinuity(rows, 3000)).toMatchObject({
      maxGapMs: 2000,
      pass: true,
    })
  })

  it('passes vacuously with fewer than two positioned rows', () => {
    expect(checkGpsContinuity([fix(0)], 3000).pass).toBe(true)
  })
})

describe('checkSentinelRows', () => {
  const validSentinel = [
    '-1',
    '-1',
    '-1',
    '-1',
    '-1',
    '-1',
    '-1',
    '-1',
    '0',
    'ERROR',
  ]
  const okRow = ['1000', '-38', '-57', '0', '-1', '-1', '9', '20', '0', 'OK']

  it('reports not-exercised when the session has no ERROR rows', () => {
    expect(checkSentinelRows([okRow])).toMatchObject({
      errorRowCount: 0,
      exercised: false,
      pass: null,
    })
  })

  it('passes when every ERROR row has all numeric fields at -1', () => {
    expect(checkSentinelRows([okRow, validSentinel])).toMatchObject({
      errorRowCount: 1,
      exercised: true,
      pass: true,
    })
  })

  it('fails when an ERROR row leaks a real value (e.g. timestamp)', () => {
    const leaky = [
      '5000',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '0',
      'ERROR',
    ]
    expect(checkSentinelRows([leaky])).toMatchObject({
      errorRowCount: 1,
      exercised: true,
      pass: false,
    })
  })
})
