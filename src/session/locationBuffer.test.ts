import type { GpsSample } from 'expo-gps'

import { createLocationBuffer } from './locationBuffer'

const mockWrites: string[] = []
const mockHandleClose = jest.fn()

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(...args: unknown[]) {
      this.uri = String(args[0])
    }
    create() {}
    open() {
      return {
        writeBytes: (bytes: Uint8Array) => {
          mockWrites.push(new TextDecoder().decode(bytes))
        },
        close: mockHandleClose,
      }
    }
  },
  FileMode: { Append: 'wa' },
}))

function fix(timestampMs: number, lat = 0): GpsSample {
  return {
    timestampMs,
    lat,
    long: 0,
    speedMs: -1,
    courseDeg: -1,
    courseAccuracyDeg: -1,
    horizontalAccuracyM: 10,
    verticalAccuracyM: 8,
    errorCode: null,
    errorDomain: null,
  }
}

function flushedContent(): string {
  return mockWrites.join('')
}

beforeEach(() => {
  mockWrites.length = 0
  mockHandleClose.mockClear()
})

describe('createLocationBuffer', () => {
  it('writes the header exactly once, on the first flush', () => {
    const buffer = createLocationBuffer('file:///s/loc.csv', 0, 3000)
    buffer.appendSamples([fix(1000)])
    buffer.flush()
    buffer.appendSamples([fix(2000)])
    buffer.flush()
    const content = flushedContent()
    expect(content.startsWith('Timestamp_unix_ms,')).toBe(true)
    expect(content.match(/Timestamp_unix_ms/g)).toHaveLength(1)
  })

  it('does nothing on flush with no pending samples', () => {
    const buffer = createLocationBuffer('file:///s/loc.csv', 0, 3000)
    buffer.flush()
    expect(mockWrites).toHaveLength(0)
  })

  it('drops pre-session cached fixes BEFORE interpolation — no synthetic points anchored on them', () => {
    // Cached fix 40s before the epoch, then two session fixes 2s apart.
    // Wrong ordering (interpolate first) would fabricate INTERP rows from the
    // cached anchor; correct ordering yields zero INTERP rows.
    const epochMs = 100000
    const buffer = createLocationBuffer('file:///s/loc.csv', epochMs, 3000)
    buffer.appendSamples([
      fix(epochMs - 40000),
      fix(epochMs + 2000),
      fix(epochMs + 4000),
    ])
    buffer.flush()
    const content = flushedContent()
    expect(content).not.toContain('INTERP')
    expect(content).not.toContain(String(epochMs - 40000))
    expect(buffer.counts()).toEqual({ real: 2, interpolated: 0, error: 0 })
  })

  it('interpolates gaps that span flush windows via the carried-over last fix', () => {
    const buffer = createLocationBuffer('file:///s/loc.csv', 0, 3000)
    buffer.appendSamples([fix(1000)])
    buffer.flush()
    buffer.appendSamples([fix(11000)])
    buffer.flush()
    // 10s gap across the two windows -> ceil(10/3)-1 = 3 INTERP rows.
    const interpRows = flushedContent()
      .split('\n')
      .filter((line) => line.endsWith('INTERP'))
    expect(interpRows).toHaveLength(3)
    expect(buffer.counts()).toEqual({ real: 2, interpolated: 3, error: 0 })
  })

  it('never writes the carried-over fix a second time', () => {
    const buffer = createLocationBuffer('file:///s/loc.csv', 0, 3000)
    buffer.appendSamples([fix(1000, 10)])
    buffer.flush()
    buffer.appendSamples([fix(11000, 20)])
    buffer.flush()
    const rows = flushedContent()
      .split('\n')
      .filter((line) => line.startsWith('1000,'))
    // The flush-N fix re-enters flush N+1 as interpolation context only —
    // its row must exist exactly once, from flush N.
    expect(rows).toHaveLength(1)
  })

  it('counts and writes ERROR sentinel rows', () => {
    const buffer = createLocationBuffer('file:///s/loc.csv', 0, 3000)
    buffer.appendSamples([
      fix(1000),
      {
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
      },
    ])
    buffer.flush()
    expect(flushedContent()).toContain('-1,-1,-1,-1,-1,-1,-1,-1,0,ERROR')
    expect(buffer.counts().error).toBe(1)
  })
})
