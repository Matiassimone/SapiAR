import type { LocationRow } from '../csv/csvReader'

export interface FrameCountResult {
  expected: number | null
  actual: number
  pass: boolean | null
}

export interface ContinuityResult {
  maxGapMs: number
  thresholdMs: number
  pass: boolean
}

export interface SentinelResult {
  errorRowCount: number
  exercised: boolean
  pass: boolean | null
}

// ponytail: tolerance = max(5 frames, 1%) — recorder start/stop boundary
// slop measured at ±4 frames on a 64s session (0.2%); a real drop pattern
// is an order of magnitude above this. Revisit against longer recordings.
function frameCheck(
  fps: number | null,
  durationMs: number,
  actual: number,
): FrameCountResult {
  if (fps == null) return { expected: null, actual, pass: null }
  const expected = Math.round((fps * durationMs) / 1000)
  const tolerance = Math.max(5, Math.round(expected * 0.01))
  return { expected, actual, pass: Math.abs(actual - expected) <= tolerance }
}

export function checkFrameCounts(
  metadata: { durationMs: number; fps: { front: number; back: number } | null },
  actual: { front: number; back: number },
): { front: FrameCountResult; back: FrameCountResult } {
  return {
    front: frameCheck(
      metadata.fps?.front ?? null,
      metadata.durationMs,
      actual.front,
    ),
    back: frameCheck(
      metadata.fps?.back ?? null,
      metadata.durationMs,
      actual.back,
    ),
  }
}

/**
 * CLAUDE.md Validation Strategy's continuity check, run live against the
 * file instead of assumed from the algorithm's construction.
 */
export function checkGpsContinuity(
  rows: readonly LocationRow[],
  thresholdMs: number,
): ContinuityResult {
  const times = rows.map((row) => row.timestampMs).filter((ms) => ms >= 0)
  let maxGapMs = 0
  for (let i = 1; i < times.length; i++) {
    const current = times[i]
    const previous = times[i - 1]
    if (current != null && previous != null) {
      maxGapMs = Math.max(maxGapMs, current - previous)
    }
  }
  return { maxGapMs, thresholdMs, pass: maxGapMs <= thresholdMs }
}

/**
 * Data Spec ERROR exception: every numeric column, including the timestamp,
 * must be exactly -1 on sentinel rows. Reports "not exercised" (pass: null)
 * when a session simply had no hardware errors — absence of evidence isn't
 * a pass.
 */
export function checkSentinelRows(
  rawRows: readonly string[][],
): SentinelResult {
  const errorRows = rawRows.filter((columns) => columns[9] === 'ERROR')
  if (errorRows.length === 0) {
    return { errorRowCount: 0, exercised: false, pass: null }
  }
  const allValid = errorRows.every(
    (columns) =>
      columns.slice(0, 8).every((value) => value === '-1') &&
      columns[8] === '0',
  )
  return { errorRowCount: errorRows.length, exercised: true, pass: allValid }
}
