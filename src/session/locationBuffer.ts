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
 * Runs the assembly pipeline in the only correct order: filter pre-session
 * samples, then interpolate, then format. A cached fix reaching the
 * interpolator would become a false anchor and fabricate points that
 * don't belong to this session. The last real fix of each flush carries
 * into the next window so gaps spanning two flushes still get filled,
 * without writing that carried fix to the file twice.
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

      // Real entries pass through interpolateGpsGaps by the same reference,
      // never cloned, so this check drops the carried fix without writing
      // it twice. If interpolation ever starts cloning entries, this filter
      // silently breaks and the carried fix gets duplicated in the file.
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
