import { buildMetadataJson } from './metadata'

describe('buildMetadataJson', () => {
  const input = {
    epochMs: 1752576000000,
    durationMs: 32500,
    frames: { front: 1950, back: 780 },
    gps: { real: 31, interpolated: 4, error: 1 },
    fps: { front: 60, back: 24 },
    resolution: {
      front: { width: 1920, height: 1440 },
      back: { width: 1920, height: 1440 },
    },
    cameraConfig: { step: 1, degraded: false, binned: false },
    events: [
      {
        timestampMs: 1752576001000,
        type: 'interruption-started' as const,
        detail: 'video-device-not-available-due-to-system-pressure',
      },
      {
        timestampMs: 1752576003000,
        type: 'interruption-ended' as const,
        detail: '',
      },
    ],
  }

  it('serializes the session summary as parseable JSON', () => {
    const parsed: unknown = JSON.parse(buildMetadataJson(input))
    expect(parsed).toEqual(input)
  })

  it('omits fps when the session recorded none', () => {
    const parsed: unknown = JSON.parse(
      buildMetadataJson({ ...input, fps: null }),
    )
    expect(parsed).toEqual({
      epochMs: input.epochMs,
      durationMs: input.durationMs,
      frames: input.frames,
      gps: input.gps,
      resolution: input.resolution,
      cameraConfig: input.cameraConfig,
      events: input.events,
    })
  })

  it('omits resolution when the session never learned it', () => {
    const parsed: unknown = JSON.parse(
      buildMetadataJson({ ...input, resolution: null }),
    )
    expect(parsed).toEqual({
      epochMs: input.epochMs,
      durationMs: input.durationMs,
      frames: input.frames,
      gps: input.gps,
      fps: input.fps,
      cameraConfig: input.cameraConfig,
      events: input.events,
    })
  })

  it('always serializes events, an empty array is the "clean session" signal rather than an omission', () => {
    const parsed = JSON.parse(buildMetadataJson({ ...input, events: [] })) as {
      events: unknown
    }
    expect(parsed.events).toEqual([])
  })

  it('records a degraded ladder rung verbatim and omits cameraConfig when null', () => {
    const degraded = buildMetadataJson({
      ...input,
      cameraConfig: { step: 2, degraded: true, binned: true },
    })
    expect(JSON.parse(degraded)).toMatchObject({
      cameraConfig: { step: 2, degraded: true, binned: true },
    })
    const withoutConfig: unknown = JSON.parse(
      buildMetadataJson({ ...input, cameraConfig: null }),
    )
    expect(withoutConfig).toEqual({
      epochMs: input.epochMs,
      durationMs: input.durationMs,
      frames: input.frames,
      gps: input.gps,
      fps: input.fps,
      resolution: input.resolution,
      events: input.events,
    })
  })
})
