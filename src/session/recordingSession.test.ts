import type { GpsSample } from 'expo-gps'

import { startRecordingSession } from './recordingSession'

const mockFileWrites: Record<string, string[]> = {}
let mockEvents: { timestampMs: number; type: 'error'; detail: string }[] = []
const mockSessionEvents = () => mockEvents
const mockFileCreates: string[] = []
const mockGpsQueue: GpsSample[][] = []
const mockGpsStart = jest.fn()
const mockGpsStop = jest.fn()

jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///docs/' } },
  FileMode: { Append: 'wa' },
  Directory: class {
    uri: string
    constructor(mockUri: string) {
      this.uri = mockUri
    }
    create() {}
  },
  File: class {
    uri: string
    constructor(mockUri: string) {
      this.uri = mockUri
    }
    create() {
      mockFileCreates.push(this.uri)
    }
    write(text: string) {
      ;(mockFileWrites[this.uri] ??= []).push(text)
    }
    open() {
      const mockOpenUri = this.uri
      return {
        writeBytes: (bytes: Uint8Array) => {
          ;(mockFileWrites[mockOpenUri] ??= []).push(
            new TextDecoder().decode(bytes),
          )
        },
        close: () => {},
      }
    }
  },
}))

jest.mock('expo-gps', () => ({
  ExpoGps: {
    start: () => mockGpsStart(),
    stop: () => mockGpsStop(),
    drain: () => mockGpsQueue.shift() ?? [],
    count: 0,
  },
}))

interface FakeController {
  drain: jest.Mock
}

function fakeController(queues: number[][]): FakeController {
  const pending = [...queues]
  return { drain: jest.fn(() => pending.shift() ?? []) }
}

function fakeVideoOutput(
  // null = "never reported a resolution" (an explicit undefined argument
  // would just re-trigger the default value)
  currentResolution: { width: number; height: number } | null = {
    width: 1920,
    height: 1440,
  },
) {
  const stopRecording = jest.fn(async () => {
    finishRecording()
  })
  let onFinished: ((path: string, reason: string) => void) | undefined
  const finishRecording = () => onFinished?.('/tmp/x.mov', 'stopped')
  const recorder = {
    startRecording: jest.fn(async (finished: typeof onFinished) => {
      onFinished = finished
    }),
    stopRecording,
  }
  return {
    currentResolution: currentResolution ?? undefined,
    createRecorder: jest.fn(async (settings: { filePath: string }) => {
      return { ...recorder, settings }
    }),
    recorder,
  }
}

function gpsFix(timestampMs: number): GpsSample {
  return {
    timestampMs,
    lat: 1,
    long: 2,
    speedMs: -1,
    courseDeg: -1,
    courseAccuracyDeg: -1,
    horizontalAccuracyM: 5,
    verticalAccuracyM: 5,
    errorCode: null,
    errorDomain: null,
  }
}

function contentOf(uriSuffix: string): string {
  const uri = Object.keys(mockFileWrites).find((key) => key.endsWith(uriSuffix))
  return uri == null ? '' : (mockFileWrites[uri]?.join('') ?? '')
}

beforeEach(() => {
  mockEvents = []
  jest.useFakeTimers()
  for (const key of Object.keys(mockFileWrites)) delete mockFileWrites[key]
  mockFileCreates.length = 0
  mockGpsQueue.length = 0
  mockGpsStart.mockClear()
  mockGpsStop.mockClear()
  jest.spyOn(Date, 'now').mockReturnValue(100000)
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function startWith(
  front: FakeController,
  back: FakeController,
  frontVideo = fakeVideoOutput(),
  backVideo = fakeVideoOutput(),
) {
  return await startRecordingSession({
    frontFrames: front as never,
    backFrames: back as never,
    frontVideo: frontVideo as never,
    backVideo: backVideo as never,
    fps: { front: 30, back: 30 },
    cameraConfig: { step: 1, degraded: false, binned: false },
    sessionEvents: mockSessionEvents,
  })
}

describe('startRecordingSession', () => {
  it('creates both empty CSV files at start because Append mode never creates', async () => {
    await startWith(fakeController([[]]), fakeController([[]]))
    // Before any flush has happened (no timer ticks yet):
    expect(mockFileCreates).toContain(
      'file:///docs/100000_Session/100000_FrameData.csv',
    )
    expect(mockFileCreates).toContain(
      'file:///docs/100000_Session/100000_LocationData.csv',
    )
    // Truly empty, the header remains buffer-owned, written on first flush.
    expect(mockFileWrites).toEqual({})
  })

  it('discards whatever the native buffers accumulated before record-start', async () => {
    const front = fakeController([[90001, 90002], [100500]])
    const back = fakeController([[90003], [100600]])
    mockGpsQueue.push([], [gpsFix(100200)])

    const session = await startWith(front, back)
    jest.advanceTimersByTime(1000)
    await session.stop()

    const frames = contentOf('FrameData.csv')
    expect(frames).not.toContain('90001')
    expect(frames).not.toContain('90003')
    expect(frames).toContain('100500,Front')
    expect(frames).toContain('100600,Back')
  })

  it('filters frame timestamps older than the session epoch', async () => {
    const front = fakeController([[], [99999, 100010]])
    const back = fakeController([[], []])
    const session = await startWith(front, back)
    jest.advanceTimersByTime(1000)
    await session.stop()

    const frames = contentOf('FrameData.csv')
    expect(frames).not.toContain('99999')
    expect(frames).toContain('100010,Front')
  })

  it('records to the session video paths and finalizes on stop', async () => {
    const frontVideo = fakeVideoOutput()
    const backVideo = fakeVideoOutput()
    const session = await startWith(
      fakeController([[]]),
      fakeController([[]]),
      frontVideo,
      backVideo,
    )

    expect(frontVideo.createRecorder).toHaveBeenCalledWith({
      filePath: '/docs/100000_Session/100000_FrontVideo.mov',
    })
    expect(backVideo.createRecorder).toHaveBeenCalledWith({
      filePath: '/docs/100000_Session/100000_BackVideo.mov',
    })
    expect(frontVideo.recorder.startRecording).toHaveBeenCalled()

    await session.stop()
    expect(frontVideo.recorder.stopRecording).toHaveBeenCalled()
    expect(backVideo.recorder.stopRecording).toHaveBeenCalled()
  })

  it('starts GPS on start, stops it on stop, and flushes GPS rows', async () => {
    mockGpsQueue.push([], [gpsFix(100100)], [gpsFix(101100)])
    const session = await startWith(fakeController([[]]), fakeController([[]]))
    expect(mockGpsStart).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(2000)
    await session.stop()

    expect(mockGpsStop).toHaveBeenCalledTimes(1)
    const locations = contentOf('LocationData.csv')
    expect(locations).toContain('100100,1,2,')
    expect(locations).toContain('101100,1,2,')
  })

  it('writes metadata.json with counts, duration, fps, and resolution on stop', async () => {
    const front = fakeController([[], [100010, 100020]])
    const back = fakeController([[], [100030]])
    mockGpsQueue.push([], [gpsFix(100100)])

    const session = await startWith(front, back)
    jest.advanceTimersByTime(1000)
    ;(Date.now as jest.Mock).mockReturnValue(132500)
    await session.stop()

    const metadata: unknown = JSON.parse(contentOf('metadata.json'))
    expect(metadata).toEqual({
      epochMs: 100000,
      durationMs: 32500,
      frames: { front: 2, back: 1 },
      gps: { real: 1, interpolated: 0, error: 0 },
      fps: { front: 30, back: 30 },
      resolution: {
        front: { width: 1920, height: 1440 },
        back: { width: 1920, height: 1440 },
      },
      cameraConfig: { step: 1, degraded: false, binned: false },
      events: [],
    })
  })

  it('scopes session events to the recording window by timestamp', async () => {
    mockEvents = [
      { timestampMs: 99000, type: 'error', detail: 'pre-session noise' },
      { timestampMs: 100500, type: 'error', detail: 'mid-recording drop' },
    ]
    const session = await startWith(fakeController([[]]), fakeController([[]]))
    await session.stop()

    const metadata = JSON.parse(contentOf('metadata.json')) as {
      events: { detail: string }[]
    }
    expect(metadata.events).toEqual([
      { timestampMs: 100500, type: 'error', detail: 'mid-recording drop' },
    ])
  })

  it('omits resolution from metadata when an output never reported one', async () => {
    const session = await startWith(
      fakeController([[]]),
      fakeController([[]]),
      fakeVideoOutput(null),
    )
    await session.stop()

    const metadata = JSON.parse(contentOf('metadata.json')) as Record<
      string,
      unknown
    >
    expect(metadata.resolution).toBeUndefined()
  })
})
