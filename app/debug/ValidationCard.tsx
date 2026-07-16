import { GPS_GAP_THRESHOLD_MS } from '../../src/interpolation/gpsInterpolation'
import {
  checkFrameCounts,
  checkGpsContinuity,
  checkSentinelRows,
} from '../../src/session/sessionValidation'
import { type GlyphKind } from '../components/Glyph'
import { InfoRow } from '../components/InfoRow'
import { InfoSection } from '../components/InfoSection'
import type { SessionSummary } from './useSessionBrowser'

export function ValidationCard({ summary }: { summary: SessionSummary }) {
  const rows: { kind: GlyphKind; label: string; value: string }[] = []
  if (summary.metadata != null) {
    const frames = checkFrameCounts(summary.metadata, summary.frames)
    for (const camera of ['front', 'back'] as const) {
      const result = frames[camera]
      rows.push(
        result.pass == null
          ? {
              kind: 'neutral',
              label: `Frames ${camera}`,
              value: 'no fps in metadata',
            }
          : {
              kind: result.pass ? 'pass' : 'fail',
              label: `Frames ${camera}`,
              value: `${result.actual}/${result.expected}`,
            },
      )
    }
  } else {
    rows.push({ kind: 'fail', label: 'Frames', value: 'metadata.json missing' })
  }
  const continuity = checkGpsContinuity(summary.track, GPS_GAP_THRESHOLD_MS)
  rows.push({
    kind: continuity.pass ? 'pass' : 'fail',
    label: 'GPS continuity',
    value: `max ${continuity.maxGapMs}ms ≤ ${continuity.thresholdMs}ms`,
  })
  const sentinel = checkSentinelRows(summary.locationRaw)
  rows.push(
    sentinel.pass == null
      ? { kind: 'neutral', label: 'Sentinel rows', value: 'not exercised' }
      : {
          kind: sentinel.pass ? 'pass' : 'fail',
          label: 'Sentinel rows',
          value: `${sentinel.errorRowCount} ERROR row(s)`,
        },
  )

  return (
    <InfoSection title="Validation">
      {rows.map((row) => (
        <InfoRow
          key={row.label}
          kind={row.kind}
          label={row.label}
          value={row.value}
          valueColor={
            row.kind === 'pass'
              ? '#34c759'
              : row.kind === 'fail'
                ? '#ff453a'
                : undefined
          }
        />
      ))}
    </InfoSection>
  )
}
