import type { GpsSample } from 'expo-gps'

import {
  GPS_GAP_THRESHOLD_MS,
  interpolateGpsGaps,
  isInterpolatedPoint,
  type InterpolatedPoint,
} from './gpsInterpolation'

function fix(
  overrides: Partial<GpsSample> & { timestampMs: number },
): GpsSample {
  return {
    lat: 0,
    long: 0,
    speedMs: 1,
    courseDeg: 90,
    courseAccuracyDeg: 5,
    horizontalAccuracyM: 10,
    verticalAccuracyM: 8,
    errorCode: null,
    errorDomain: null,
    ...overrides,
  }
}

function errorEntry(): GpsSample {
  return {
    timestampMs: null,
    lat: null,
    long: null,
    speedMs: null,
    courseDeg: null,
    courseAccuracyDeg: null,
    horizontalAccuracyM: null,
    verticalAccuracyM: null,
    errorCode: 0,
    errorDomain: 'kCLErrorDomain',
  }
}

function syntheticsOf(entries: readonly unknown[]): InterpolatedPoint[] {
  return entries.filter(isInterpolatedPoint)
}

describe('interpolateGpsGaps', () => {
  it('exports a 3s default threshold (3× the verified 1Hz cadence)', () => {
    expect(GPS_GAP_THRESHOLD_MS).toBe(3000)
  })

  it('passes a gap-free stream through unchanged, same references', () => {
    const samples = [
      fix({ timestampMs: 0 }),
      fix({ timestampMs: 1000 }),
      fix({ timestampMs: 2000 }),
    ]
    const result = interpolateGpsGaps(samples, 3000)
    expect(result).toEqual(samples)
    expect(result[0]).toBe(samples[0])
  })

  it('does not interpolate a gap exactly at the threshold — only above triggers', () => {
    const samples = [fix({ timestampMs: 0 }), fix({ timestampMs: 3000 })]
    expect(interpolateGpsGaps(samples, 3000)).toEqual(samples)
  })

  it('fills a gap above threshold with evenly spaced synthetic points', () => {
    const samples = [
      fix({ timestampMs: 0, lat: 10, long: 20 }),
      fix({ timestampMs: 10000, lat: 20, long: 40 }),
    ]
    const result = interpolateGpsGaps(samples, 3000)
    const synthetics = syntheticsOf(result)

    // ceil(10000/3000) - 1 = 3 points -> four 2500ms segments, all <= 3000
    expect(synthetics).toHaveLength(3)
    expect(synthetics.map((p) => p.timestampMs)).toEqual([2500, 5000, 7500])
    expect(result).toHaveLength(5)
    expect(result[0]).toBe(samples[0])
    expect(result[4]).toBe(samples[1])
  })

  it('interpolates lat/long linearly between the bounding real points', () => {
    const samples = [
      fix({ timestampMs: 0, lat: 10, long: 20 }),
      fix({ timestampMs: 10000, lat: 20, long: 40 }),
    ]
    const synthetics = syntheticsOf(interpolateGpsGaps(samples, 3000))
    expect(synthetics[0]).toMatchObject({ lat: 12.5, long: 25 })
    expect(synthetics[1]).toMatchObject({ lat: 15, long: 30 })
    expect(synthetics[2]).toMatchObject({ lat: 17.5, long: 35 })
  })

  it('marks synthetic points INTERP and sets unmeasured fields to -1', () => {
    const samples = [fix({ timestampMs: 0 }), fix({ timestampMs: 7000 })]
    const [synthetic] = syntheticsOf(interpolateGpsGaps(samples, 3000))
    expect(synthetic).toMatchObject({
      isInterpolated: true,
      qualityFlag: 'INTERP',
      speedMs: -1,
      courseDeg: -1,
      courseAccuracyDeg: -1,
      horizontalAccuracyM: -1,
      verticalAccuracyM: -1,
    })
  })

  it('fills multiple independent gaps', () => {
    const samples = [
      fix({ timestampMs: 0 }),
      fix({ timestampMs: 7000 }),
      fix({ timestampMs: 8000 }),
      fix({ timestampMs: 15000 }),
    ]
    const result = interpolateGpsGaps(samples, 3000)
    // gap 0->7000: ceil(7/3)-1 = 2 synthetics; gap 8000->15000: 2 synthetics
    expect(syntheticsOf(result)).toHaveLength(4)
    expect(result).toHaveLength(8)
  })

  it('never leaves a consecutive positioned-point delta above the threshold', () => {
    const samples = [
      fix({ timestampMs: 0 }),
      fix({ timestampMs: 9500 }),
      fix({ timestampMs: 21000 }),
    ]
    const result = interpolateGpsGaps(samples, 3000)
    const times = result
      .map((entry) => entry.timestampMs)
      .filter((ms): ms is number => ms != null)
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeLessThanOrEqual(3000)
    }
  })

  it('does not treat a hardware-error entry as a gap boundary', () => {
    const samples = [
      fix({ timestampMs: 0, lat: 10, long: 20 }),
      errorEntry(),
      fix({ timestampMs: 10000, lat: 20, long: 40 }),
    ]
    const result = interpolateGpsGaps(samples, 3000)
    // The error passes through in arrival order; the gap is still measured
    // between the two real fixes and still filled.
    expect(syntheticsOf(result)).toHaveLength(3)
    expect(result[1]).toBe(samples[1])
    expect(result).toHaveLength(6)
  })

  it('passes error-only, single-fix, and empty inputs through untouched', () => {
    expect(interpolateGpsGaps([], 3000)).toEqual([])
    const single = [fix({ timestampMs: 0 })]
    expect(interpolateGpsGaps(single, 3000)).toEqual(single)
    const errorsOnly = [errorEntry(), errorEntry()]
    expect(interpolateGpsGaps(errorsOnly, 3000)).toEqual(errorsOnly)
  })

  it('passes leading/trailing error entries through without extrapolating', () => {
    const samples = [
      errorEntry(),
      fix({ timestampMs: 5000 }),
      fix({ timestampMs: 6000 }),
      errorEntry(),
    ]
    const result = interpolateGpsGaps(samples, 3000)
    expect(result).toEqual(samples)
  })

  it('does not mutate its input', () => {
    const samples = [fix({ timestampMs: 0 }), fix({ timestampMs: 10000 })]
    const copy = samples.map((sample) => ({ ...sample }))
    interpolateGpsGaps(samples, 3000)
    expect(samples).toEqual(copy)
  })
})
