import { buildMetadataJson } from './metadata'

describe('buildMetadataJson', () => {
  const input = {
    epochMs: 1752576000000,
    durationMs: 32500,
    frames: { front: 1950, back: 780 },
    gps: { real: 31, interpolated: 4, error: 1 },
    fps: { front: 60, back: 24 },
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
    })
  })
})
