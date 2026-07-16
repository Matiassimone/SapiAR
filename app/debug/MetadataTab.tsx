import { ScrollView, Text, View } from 'react-native'

import { formatResolution } from './formatResolution'
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
      <InfoSection title="Recording quality">
        {metadata.resolution == null ? (
          <InfoRow
            kind="neutral"
            label="Resolution"
            value="not recorded (pre-export session)"
          />
        ) : (
          <View style={styles.qualityHeadline}>
            <Text style={styles.qualityValue}>
              {formatResolution(metadata.resolution)}
            </Text>
          </View>
        )}
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
      <InfoSection title="Frames">
        <InfoRow label="front" value={String(metadata.frames.front)} />
        <InfoRow label="back" value={String(metadata.frames.back)} />
        {metadata.frames.frontDropped != null && (
          <>
            <InfoRow
              kind={metadata.frames.frontDropped > 0 ? 'fail' : 'pass'}
              label="front dropped"
              value={String(metadata.frames.frontDropped)}
            />
            <InfoRow
              kind={metadata.frames.backDropped > 0 ? 'fail' : 'pass'}
              label="back dropped"
              value={String(metadata.frames.backDropped)}
            />
          </>
        )}
      </InfoSection>
      <InfoSection title="GPS">
        <InfoRow label="real" value={String(metadata.gps.real)} />
        <InfoRow
          label="interpolated"
          value={String(metadata.gps.interpolated)}
        />
        <InfoRow label="error" value={String(metadata.gps.error)} />
      </InfoSection>
      <InfoSection title="FPS">
        {metadata.fps == null ? (
          <InfoRow kind="neutral" label="fps" value="not recorded" />
        ) : (
          <>
            <InfoRow label="front" value={String(metadata.fps.front)} />
            <InfoRow label="back" value={String(metadata.fps.back)} />
          </>
        )}
      </InfoSection>
    </ScrollView>
  )
}
