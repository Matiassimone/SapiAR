import { File, FileMode } from 'expo-file-system'

import {
  FRAME_CSV_HEADER,
  formatFrameRow,
  type FrameSource,
} from '../csv/csvWriter'

export interface FrameBuffer {
  appendFrames(timestampsMs: readonly number[], source: FrameSource): void
  flush(): void
  counts(): { front: number; back: number }
}

/**
 * Accumulates formatted frame rows in memory and appends them to
 * FrameData.csv on flush. Batched (not per-row) so file I/O never sits in
 * the same cadence as capture. See the CLAUDE.md Architecture table.
 */
export function createFrameBuffer(fileUri: string): FrameBuffer {
  const pending: string[] = []
  let headerWritten = false
  let front = 0
  let back = 0

  return {
    appendFrames(timestampsMs, source) {
      for (const timestampMs of timestampsMs) {
        pending.push(formatFrameRow(timestampMs, source))
      }
      if (source === 'Front') front += timestampsMs.length
      else back += timestampsMs.length
    },
    flush() {
      if (pending.length === 0) return
      const rows = pending.splice(0)
      const handle = new File(fileUri).open(FileMode.Append)
      if (!headerWritten) {
        handle.writeBytes(new TextEncoder().encode(`${FRAME_CSV_HEADER}\n`))
        headerWritten = true
      }
      handle.writeBytes(new TextEncoder().encode(`${rows.join('\n')}\n`))
      handle.close()
    },
    counts() {
      return { front, back }
    },
  }
}
