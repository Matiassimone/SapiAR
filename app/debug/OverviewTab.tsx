import { useVideoPlayer, VideoView } from 'expo-video'
import { ScrollView, Text, View } from 'react-native'
import MapView, { Marker, Polyline } from 'react-native-maps'

import { formatResolution } from './formatResolution'
import { styles } from './sessionDebug.styles'
import { InfoRow } from '../components/InfoRow'
import { InfoSection } from '../components/InfoSection'
import type { SessionSummary } from './useSessionBrowser'
import { ValidationCard } from './ValidationCard'

export function OverviewTab({ summary }: { summary: SessionSummary }) {
  const frontPlayer = useVideoPlayer(
    `${summary.rootUri}/${summary.epochMs}_FrontVideo.mov`,
  )
  const backPlayer = useVideoPlayer(
    `${summary.rootUri}/${summary.epochMs}_BackVideo.mov`,
  )

  const positioned = summary.track.filter((row) => row.timestampMs >= 0)
  const synthetic = positioned.filter((row) => row.isInterpolated)
  const realFixes = positioned.filter((row) => !row.isInterpolated)
  const latitudes = positioned.map((row) => row.lat)
  const longitudes = positioned.map((row) => row.long)
  const region = {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    latitudeDelta: Math.max(
      (Math.max(...latitudes) - Math.min(...latitudes)) * 1.5,
      0.002,
    ),
    longitudeDelta: Math.max(
      (Math.max(...longitudes) - Math.min(...longitudes)) * 1.5,
      0.002,
    ),
  }

  const megabytes = (bytes: number | null): string =>
    bytes == null ? '?' : `${(bytes / 1024 / 1024).toFixed(1)} MB`
  const total = summary.track.length
  const percent = (count: number): string =>
    total > 0 ? ` (${((count / total) * 100).toFixed(0)}%)` : ''

  return (
    <ScrollView>
      <MapView style={styles.map} initialRegion={region}>
        <Polyline
          coordinates={positioned.map((row) => ({
            latitude: row.lat,
            longitude: row.long,
          }))}
          strokeColor="#4a90d9"
          strokeWidth={2}
        />
        {realFixes.map((row, index) => (
          <Marker
            key={`real-${index}`}
            coordinate={{ latitude: row.lat, longitude: row.long }}
            pinColor="#4a90d9"
          />
        ))}
        {synthetic.map((row, index) => (
          <Marker
            key={`interp-${index}`}
            coordinate={{ latitude: row.lat, longitude: row.long }}
            pinColor="#ff9500"
          />
        ))}
      </MapView>

      <View style={styles.videoRow}>
        <View style={styles.videoBox}>
          <Text style={styles.videoLabel}>
            Front ({megabytes(summary.videoSizes.front)})
          </Text>
          <VideoView style={styles.video} player={frontPlayer} nativeControls />
        </View>
        <View style={styles.videoBox}>
          <Text style={styles.videoLabel}>
            Back ({megabytes(summary.videoSizes.back)})
          </Text>
          <VideoView style={styles.video} player={backPlayer} nativeControls />
        </View>
      </View>

      <ValidationCard summary={summary} />

      <InfoSection title="Frames">
        {summary.metadata?.resolution != null && (
          <InfoRow
            kind="pass"
            label="Resolution"
            value={formatResolution(summary.metadata.resolution)}
          />
        )}
        <InfoRow label="Front" value={String(summary.frames.front)} />
        <InfoRow label="Back" value={String(summary.frames.back)} />
      </InfoSection>

      <InfoSection title="GPS">
        <InfoRow
          kind="pass"
          label="OK"
          value={`${summary.flagCounts.OK}${percent(summary.flagCounts.OK)}`}
        />
        <InfoRow
          kind="neutral"
          label="LOW_ACCURACY"
          value={String(summary.flagCounts.LOW_ACCURACY)}
        />
        <InfoRow
          kind={summary.flagCounts.ERROR > 0 ? 'fail' : 'neutral'}
          label="ERROR"
          value={String(summary.flagCounts.ERROR)}
        />
        <InfoRow
          kind="info"
          label="INTERP"
          value={`${summary.flagCounts.INTERP}${percent(summary.flagCounts.INTERP)}`}
        />
      </InfoSection>

      <InfoSection title={`Gaps filled (${summary.gaps.length})`}>
        {summary.gaps.length === 0 && (
          <InfoRow
            kind="neutral"
            label="No gaps above threshold"
            value="none"
          />
        )}
        {summary.gaps.map((gap, index) => (
          <InfoRow
            key={`gap-${index}`}
            label={`+${((gap.startMs - summary.epochMs) / 1000).toFixed(1)}s → +${((gap.endMs - summary.epochMs) / 1000).toFixed(1)}s`}
            value={`${(gap.durationMs / 1000).toFixed(1)}s · ${gap.interpCount} synthetic`}
            valueColor="#ff9500"
          />
        ))}
      </InfoSection>
    </ScrollView>
  )
}
