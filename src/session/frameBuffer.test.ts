import { createFrameBuffer } from './frameBuffer'

const mockWrites: string[] = []

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
        close: jest.fn(),
      }
    }
  },
  FileMode: { Append: 'wa' },
}))

beforeEach(() => {
  mockWrites.length = 0
})

describe('createFrameBuffer', () => {
  it('writes header once, then appends formatted rows per flush', () => {
    const buffer = createFrameBuffer('file:///s/frames.csv')
    buffer.appendFrames([100.2, 116.9], 'Front')
    buffer.appendFrames([105.5], 'Back')
    buffer.flush()
    buffer.appendFrames([133.4], 'Front')
    buffer.flush()

    const content = mockWrites.join('')
    expect(content.startsWith('Timestamp,Source\n')).toBe(true)
    expect(content).toContain('100,Front\n')
    expect(content).toContain('117,Front\n')
    expect(content).toContain('106,Back\n')
    expect(content).toContain('133,Front\n')
    expect(content.match(/Timestamp,Source/g)).toHaveLength(1)
  })

  it('tracks per-source counts and flushes nothing when empty', () => {
    const buffer = createFrameBuffer('file:///s/frames.csv')
    buffer.flush()
    expect(mockWrites).toHaveLength(0)
    buffer.appendFrames([1, 2, 3], 'Front')
    buffer.appendFrames([4], 'Back')
    expect(buffer.counts()).toEqual({ front: 3, back: 1 })
  })
})
