import { buildSessionPaths, startSession } from './sessionManager'

const mockCreate = jest.fn()
const mockDirectoryCtorArgs: unknown[][] = []

jest.mock('expo-file-system', () => ({
  Paths: {
    document: { uri: 'file:///var/mobile/Documents/' },
  },
  Directory: class {
    uri: string
    constructor(...args: unknown[]) {
      mockDirectoryCtorArgs.push(args)
      this.uri = String(args[0])
    }
    create = mockCreate
  },
}))

describe('buildSessionPaths', () => {
  const paths = buildSessionPaths(1752576000000, 'file:///docs/')

  it('names the session folder {epochMs}_Session under the container', () => {
    expect(paths.rootUri).toBe('file:///docs/1752576000000_Session')
  })

  it('names every file exactly per GOAL.md §6', () => {
    expect(paths.frontVideoUri).toBe(
      'file:///docs/1752576000000_Session/1752576000000_FrontVideo.mov',
    )
    expect(paths.backVideoUri).toBe(
      'file:///docs/1752576000000_Session/1752576000000_BackVideo.mov',
    )
    expect(paths.frameDataUri).toBe(
      'file:///docs/1752576000000_Session/1752576000000_FrameData.csv',
    )
    expect(paths.locationDataUri).toBe(
      'file:///docs/1752576000000_Session/1752576000000_LocationData.csv',
    )
  })

  it('names metadata.json without the epochMs prefix', () => {
    expect(paths.metadataUri).toBe(
      'file:///docs/1752576000000_Session/metadata.json',
    )
  })

  it('threads one epochMs through every prefixed name — never re-derived', () => {
    const prefixed = [
      paths.rootUri,
      paths.frontVideoUri,
      paths.backVideoUri,
      paths.frameDataUri,
      paths.locationDataUri,
    ]
    for (const uri of prefixed) {
      expect(uri).toContain('1752576000000_')
    }
  })

  it('is pure: same input, same output; container trailing slash is normalized', () => {
    expect(buildSessionPaths(42, 'file:///docs/')).toEqual(
      buildSessionPaths(42, 'file:///docs'),
    )
  })
})

describe('startSession', () => {
  beforeEach(() => {
    mockCreate.mockClear()
    mockDirectoryCtorArgs.length = 0
  })

  it('generates epochMs exactly once, at record-start, from the clock', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1752576000123)
    const session = startSession()
    expect(session.epochMs).toBe(1752576000123)
    expect(nowSpy).toHaveBeenCalledTimes(1)
    nowSpy.mockRestore()
  })

  it('creates the session folder on disk', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1752576000123)
    const session = startSession()
    expect(mockDirectoryCtorArgs).toHaveLength(1)
    expect(String(mockDirectoryCtorArgs[0]?.[0])).toBe(session.paths.rootUri)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    jest.restoreAllMocks()
  })

  it('derives all paths from that single epochMs', () => {
    jest.spyOn(Date, 'now').mockReturnValue(999)
    const session = startSession()
    expect(session.paths.frameDataUri).toContain('999_FrameData.csv')
    expect(session.paths.rootUri).toContain('999_Session')
    jest.restoreAllMocks()
  })
})
