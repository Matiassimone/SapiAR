import { ScrollView, Text } from 'react-native'

import { styles } from './sessionDebug.styles'
import { InfoRow } from '../components/InfoRow'
import { InfoSection } from '../components/InfoSection'
import type { SessionSummary } from './useSessionBrowser'

export function MetadataTab({ summary }: { summary: SessionSummary }) {
  const metadata = summary.metadata
  if (metadata == null) {
    return (
      <ScrollView>
        <InfoSection title="Metadata">
          <InfoRow kind="fail" label="metadata.json" value="missing/invalid" />
        </InfoSection>
        <Text style={styles.rawFallback}>{summary.metadataJson}</Text>
      </ScrollView>
    )
  }
  return (
    <ScrollView>
      <InfoSection title="Session">
        <InfoRow label="epochMs" value={String(metadata.epochMs)} />
        <InfoRow
          label="durationMs"
          value={`${metadata.durationMs} (${(metadata.durationMs / 1000).toFixed(1)}s)`}
        />
      </InfoSection>
      <InfoSection title="Frames">
        <InfoRow label="front" value={String(metadata.frames.front)} />
        <InfoRow label="back" value={String(metadata.frames.back)} />
      </InfoSection>
      <InfoSection title="GPS">
        <InfoRow label="real" value={String(metadata.gps.real)} />
        <InfoRow
          label="interpolated"
          value={String(metadata.gps.interpolated)}
        />
        <InfoRow label="error" value={String(metadata.gps.error)} />
      </InfoSection>
      <InfoSection title="FPS (negotiated)">
        {metadata.fps == null ? (
          <InfoRow kind="neutral" label="fps" value="not recorded" />
        ) : (
          <>
            <InfoRow label="front" value={String(metadata.fps.front)} />
            <InfoRow label="back" value={String(metadata.fps.back)} />
          </>
        )}
      </InfoSection>
      <InfoSection title="Camera config">
        {metadata.cameraConfig == null ? (
          <InfoRow
            kind="neutral"
            label="config ladder"
            value="not recorded (pre-ladder session)"
          />
        ) : (
          <>
            <InfoRow
              kind={metadata.cameraConfig.degraded ? 'neutral' : 'pass'}
              label={
                metadata.cameraConfig.degraded
                  ? 'Degraded fallback config'
                  : 'Ideal config'
              }
              value={`rung ${metadata.cameraConfig.step}`}
              valueColor={
                metadata.cameraConfig.degraded ? '#ff9500' : '#34c759'
              }
            />
            <InfoRow
              label="binned"
              value={String(metadata.cameraConfig.binned)}
            />
          </>
        )}
      </InfoSection>
    </ScrollView>
  )
}
