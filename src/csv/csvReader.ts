export type QualityFlag = 'OK' | 'LOW_ACCURACY' | 'ERROR' | 'INTERP'

export interface LocationRow {
  timestampMs: number
  lat: number
  long: number
  isInterpolated: boolean
  qualityFlag: QualityFlag
}

/**
 * A contiguous run of INTERP rows bounded by two real fixes, read back from
 * the CSV structure gpsInterpolation.ts already produced (this module never
 * re-runs gap detection, it only groups what is_interpolated=1 rows exist).
 */
export interface GapRun {
  startMs: number
  endMs: number
  durationMs: number
  interpCount: number
}

function dataLines(content: string): string[] {
  return content
    .split('\n')
    .slice(1)
    .filter((line) => line.length > 0)
}

export function parseLocationCsv(content: string): LocationRow[] {
  return dataLines(content).map((line) => {
    const columns = line.split(',')
    return {
      timestampMs: Number(columns[0]),
      lat: Number(columns[1]),
      long: Number(columns[2]),
      isInterpolated: columns[8] === '1',
      qualityFlag: (columns[9] ?? 'ERROR') as QualityFlag,
    }
  })
}

export function countByQualityFlag(
  rows: readonly LocationRow[],
): Record<QualityFlag, number> {
  const counts: Record<QualityFlag, number> = {
    OK: 0,
    LOW_ACCURACY: 0,
    ERROR: 0,
    INTERP: 0,
  }
  for (const row of rows) counts[row.qualityFlag]++
  return counts
}

export function deriveGapRuns(rows: readonly LocationRow[]): GapRun[] {
  const runs: GapRun[] = []
  let lastFix: LocationRow | null = null
  let pendingInterp = 0

  for (const row of rows) {
    if (row.qualityFlag === 'INTERP') {
      pendingInterp++
    } else if (row.qualityFlag !== 'ERROR') {
      if (pendingInterp > 0 && lastFix != null) {
        runs.push({
          startMs: lastFix.timestampMs,
          endMs: row.timestampMs,
          durationMs: row.timestampMs - lastFix.timestampMs,
          interpCount: pendingInterp,
        })
      }
      pendingInterp = 0
      lastFix = row
    }
    // ERROR rows carry no timestamp, so they neither bound nor break a run.
  }
  return runs
}

export function parseFrameCounts(content: string): {
  front: number
  back: number
} {
  let front = 0
  let back = 0
  for (const line of dataLines(content)) {
    if (line.endsWith(',Front')) front++
    else if (line.endsWith(',Back')) back++
  }
  return { front, back }
}

/** Raw data rows as column arrays. The row viewer renders these verbatim. */
export function parseRawRows(content: string): string[][] {
  return dataLines(content).map((line) => line.split(','))
}
