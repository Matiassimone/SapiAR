import { File, FileMode } from 'expo-file-system'
import type { GpsSample } from 'expo-gps'

import {
  LOCATION_CSV_HEADER,
  filterPreSessionSamples,
  formatLocationRow,
} from '../csv/csvWriter'
import {
  interpolateGpsGaps,
  isInterpolatedPoint,
} from '../interpolation/gpsInterpolation'

export interface LocationBuffer {
  appendSamples(samples: readonly GpsSample[]): void
  flush(): void
  counts(): { real: number; interpolated: number; error: number }
}

/**
 * Accumulates raw GPS samples and, per flush, runs the assembly pipeline in
 * the only correct order: pre-session filter FIRST, then gap interpolation,
 * then row formatting — a cached pre-session fix that reached the
 * interpolator would become a false anchor and fabricate synthetic points
 * (checkpoint 4's 80.2s-span finding).
 *
 * The last real fix of each flush is carried into the next window so a gap
 * spanning two flushes is still detected and filled, keeping the file
 * append-only (no rewrites).
 */
export function createLocationBuffer(
  fileUri: string,
  epochMs: number,
  gapThresholdMs: number,
): LocationBuffer {
  const pending: GpsSample[] = []
  let carriedFix: GpsSample | null = null
  let headerWritten = false
  let real = 0
  let interpolated = 0
  let error = 0

  return {
    appendSamples(samples) {
      pending.push(...samples)
    },
    flush() {
      if (pending.length === 0) return
      const window = filterPreSessionSamples(pending.splice(0), epochMs)
      if (window.length === 0) return

      const withCarry = carriedFix == null ? window : [carriedFix, ...window]
      const entries = interpolateGpsGaps(withCarry, gapThresholdMs)
      const newEntries =
        carriedFix == null ? entries : entries.filter((e) => e !== carriedFix)

      const lastFix = [...window]
        .reverse()
        .find(
          (sample) => sample.errorCode == null && sample.timestampMs != null,
        )
      if (lastFix != null) carriedFix = lastFix

      for (const entry of newEntries) {
        if (isInterpolatedPoint(entry)) interpolated++
        else if (entry.errorCode != null) error++
        else real++
      }

      const handle = new File(fileUri).open(FileMode.Append)
      if (!headerWritten) {
        handle.writeBytes(new TextEncoder().encode(`${LOCATION_CSV_HEADER}\n`))
        headerWritten = true
      }
      handle.writeBytes(
        new TextEncoder().encode(
          `${newEntries.map((entry) => formatLocationRow(entry)).join('\n')}\n`,
        ),
      )
      handle.close()
    },
    counts() {
      return { real, interpolated, error }
    },
  }
}
