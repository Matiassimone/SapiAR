import type { GpsSample } from 'expo-gps'

import type { InterpolatedPoint } from '../interpolation/gpsInterpolation'
import {
  FRAME_CSV_HEADER,
  LOCATION_CSV_HEADER,
  filterPreSessionSamples,
  formatFrameRow,
  formatLocationRow,
} from './csvWriter'

function fix(overrides: Partial<GpsSample>): GpsSample {
  return {
    timestampMs: 1000,
    lat: -34.6,
    long: -58.4,
    speedMs: 1.5,
    courseDeg: 90,
    courseAccuracyDeg: 5,
    horizontalAccuracyM: 10,
    verticalAccuracyM: 8,
    errorCode: null,
    errorDomain: null,
    ...overrides,
  }
}

const errorEntry: GpsSample = {
  timestampMs: 5000,
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

const interpPoint: InterpolatedPoint = {
  timestampMs: 2500,
  lat: -34.61,
  long: -58.41,
  speedMs: -1,
  courseDeg: -1,
  courseAccuracyDeg: -1,
  horizontalAccuracyM: -1,
  verticalAccuracyM: -1,
  isInterpolated: true,
  qualityFlag: 'INTERP',
}

describe('headers', () => {
  it('match the GOAL.md column spec exactly', () => {
    expect(FRAME_CSV_HEADER).toBe('Timestamp,Source')
    expect(LOCATION_CSV_HEADER).toBe(
      'Timestamp_unix_ms,Lat,Long,Speed_m_s,Course_deg,CourseAccuracy_deg,HorizontalAccuracy_m,VerticalAccuracy_m,is_interpolated,quality_flag',
    )
  })
})

describe('formatFrameRow', () => {
  it('formats both camera sources and rounds to integer ms', () => {
    expect(formatFrameRow(1752576000123.4, 'Front')).toBe('1752576000123,Front')
    expect(formatFrameRow(1752576000456.6, 'Back')).toBe('1752576000457,Back')
  })
})

describe('formatLocationRow real entries', () => {
  it('classifies OK at exactly 20m (boundary is ≤)', () => {
    const row = formatLocationRow(fix({ horizontalAccuracyM: 20 }))
    expect(row.endsWith(',0,OK')).toBe(true)
  })

  it('classifies LOW_ACCURACY strictly above 20m', () => {
    const row = formatLocationRow(fix({ horizontalAccuracyM: 20.01 }))
    expect(row.endsWith(',0,LOW_ACCURACY')).toBe(true)
  })

  it('writes full precision lat/long and rounds the timestamp', () => {
    const row = formatLocationRow(
      fix({ timestampMs: 1000.6, lat: -34.60372221, long: -58.38161944 }),
    )
    expect(row.startsWith('1001,-34.60372221,-58.38161944,')).toBe(true)
  })

  it('maps CoreLocation negative "unavailable" kinematics to -1', () => {
    const row = formatLocationRow(
      fix({ speedMs: -1.5, courseDeg: -3, courseAccuracyDeg: -2 }),
    )
    const cols = row.split(',')
    expect(cols[3]).toBe('-1')
    expect(cols[4]).toBe('-1')
    expect(cols[5]).toBe('-1')
  })

  it('treats a negative horizontal accuracy as LOW_ACCURACY with -1 written', () => {
    const row = formatLocationRow(fix({ horizontalAccuracyM: -1 }))
    const cols = row.split(',')
    expect(cols[6]).toBe('-1')
    expect(cols[9]).toBe('LOW_ACCURACY')
  })
})

describe('formatLocationRow ERROR sentinel', () => {
  it('sets every numeric field to -1, including the timestamp', () => {
    expect(formatLocationRow(errorEntry)).toBe(
      '-1,-1,-1,-1,-1,-1,-1,-1,0,ERROR',
    )
  })
})

describe('formatLocationRow INTERP entries', () => {
  it('passes synthetic points through without reclassification', () => {
    expect(formatLocationRow(interpPoint)).toBe(
      '2500,-34.61,-58.41,-1,-1,-1,-1,-1,1,INTERP',
    )
  })
})

describe('filterPreSessionSamples', () => {
  const epochMs = 10000

  it('drops fixes timestamped before the session epoch', () => {
    const cached = fix({ timestampMs: 9999 })
    const inSession = fix({ timestampMs: 10001 })
    expect(filterPreSessionSamples([cached, inSession], epochMs)).toEqual([
      inSession,
    ])
  })

  it('keeps a fix timestamped exactly at the epoch', () => {
    const atEpoch = fix({ timestampMs: 10000 })
    expect(filterPreSessionSamples([atEpoch], epochMs)).toEqual([atEpoch])
  })

  it('keeps hardware-error entries because they occurred during the session', () => {
    const error = { ...errorEntry, timestampMs: null }
    expect(filterPreSessionSamples([error], epochMs)).toEqual([error])
  })
})
