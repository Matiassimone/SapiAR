import { Directory, File, Paths } from 'expo-file-system'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useState } from 'react'
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
// Legacy Animated-based Swipeable on purpose: ReanimatedSwipeable requires
// react-native-reanimated (babel plugin + worklets runtime) — too heavy a
// native dependency for a swipe gesture on internal tooling.
import { Swipeable } from 'react-native-gesture-handler'
import MapView, { Marker, Polyline } from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  countByQualityFlag,
  deriveGapRuns,
  parseFrameCounts,
  parseLocationCsv,
  parseRawRows,
  type GapRun,
  type LocationRow,
  type QualityFlag,
} from '../src/csv/csvReader'
import { GPS_GAP_THRESHOLD_MS } from '../src/interpolation/gpsInterpolation'
import type { SessionMetadata } from '../src/session/metadata'
import {
  checkFrameCounts,
  checkGpsContinuity,
  checkSentinelRows,
} from '../src/session/sessionValidation'
import {
  DataCard,
  InfoRow,
  InfoSection,
  type GlyphKind,
} from './session-debug-ui'

const LOCATION_COLUMNS = [
  'Timestamp_unix_ms',
  'Lat',
  'Long',
  'Speed_m_s',
  'Course_deg',
  'CourseAccuracy_deg',
  'HorizontalAccuracy_m',
  'VerticalAccuracy_m',
  'is_interpolated',
  'quality_flag',
]

const FPS_OPTIONS = [24, 30, 60]

interface SessionSummary {
  epochMs: number
  rootUri: string
  frames: { front: number; back: number }
  flagCounts: Record<QualityFlag, number>
  gaps: GapRun[]
  track: LocationRow[]
  locationRaw: string[][]
  frameRaw: string[][]
  metadata: SessionMetadata | null
  metadataJson: string
  videoSizes: { front: number | null; back: number | null }
}

function listSessions(): { ids: number[]; error: string | null } {
  try {
    const entries = new Directory(Paths.document).list()
    const ids = entries
      .map((entry) => /(\d+)_Session\/?$/.exec(entry.uri)?.[1])
      .filter((id): id is string => id != null)
      .map(Number)
      .sort((a, b) => b - a)
    return { ids, error: null }
  } catch (listError: unknown) {
    return {
      ids: [],
      error: listError instanceof Error ? listError.message : String(listError),
    }
  }
}

function sessionRootUri(epochMs: number): string {
  return `${Paths.document.uri.replace(/\/$/, '')}/${epochMs}_Session`
}

/**
 * Development/debug viewer (CLAUDE.md: not part of the evaluated UI).
 * Read-only over already-written session folders — every value shown is
 * read or grouped from the CSVs; nothing is recomputed from the pipeline's
 * inputs. Sole exception per amended Architecture Rule #7: whole-session
 * folder deletion via swipe on a list row (the gesture is iOS's own
 * confirmation friction; there is deliberately no second delete path).
 */
export default function SessionDebugScreen({
  onClose,
  targetFps,
  onChangeTargetFps,
}: {
  onClose: () => void
  targetFps: number
  onChangeTargetFps: (fps: number) => void
}) {
  const insets = useSafeAreaInsets()
  const [listing, setListing] = useState(listSessions)
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const openSession = async (epochMs: number): Promise<void> => {
    try {
      const root = sessionRootUri(epochMs)
      const location = await new File(
        `${root}/${epochMs}_LocationData.csv`,
      ).text()
      const frames = await new File(`${root}/${epochMs}_FrameData.csv`).text()
      let metadata: SessionMetadata | null = null
      let metadataJson = '(missing)'
      try {
        metadataJson = await new File(`${root}/metadata.json`).text()
        metadata = JSON.parse(metadataJson) as SessionMetadata
      } catch {
        // A crashed/interrupted session may lack metadata — the viewer still
        // shows everything else rather than refusing to open.
      }
      const sizeOf = (name: string): number | null => {
        try {
          return new File(`${root}/${name}`).size
        } catch {
          return null
        }
      }
      const track = parseLocationCsv(location)
      setSummary({
        epochMs,
        rootUri: root,
        frames: parseFrameCounts(frames),
        flagCounts: countByQualityFlag(track),
        gaps: deriveGapRuns(track),
        track,
        locationRaw: parseRawRows(location),
        frameRaw: parseRawRows(frames),
        metadata,
        metadataJson,
        videoSizes: {
          front: sizeOf(`${epochMs}_FrontVideo.mov`),
          back: sizeOf(`${epochMs}_BackVideo.mov`),
        },
      })
    } catch (readError: unknown) {
      setError(
        readError instanceof Error ? readError.message : String(readError),
      )
    }
  }

  const removeSession = (epochMs: number): void => {
    try {
      new Directory(sessionRootUri(epochMs)).delete()
      setSummary(null)
      setListing(listSessions())
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : String(deleteError),
      )
    }
  }

  if (summary != null) {
    return (
      <SessionDetail
        summary={summary}
        bottomInset={insets.bottom}
        onBack={() => setSummary(null)}
      />
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerSide} />
        <Text style={[styles.headerTitle, styles.headerTitleRow]}>
          Sessions (debug)
        </Text>
        <Pressable
          style={styles.headerSide}
          hitSlop={8}
          onPress={() => setShowSettings(true)}
        >
          <Text style={styles.gearGlyph}>⚙︎</Text>
        </Pressable>
      </View>
      {(error ?? listing.error) != null && (
        <Text style={styles.error}>{error ?? listing.error}</Text>
      )}
      <ScrollView>
        {listing.ids.map((id) => (
          <Swipeable
            key={id}
            renderRightActions={() => (
              <Pressable
                style={styles.swipeDelete}
                onPress={() => removeSession(id)}
              >
                <Text style={styles.swipeDeleteText}>Delete</Text>
              </Pressable>
            )}
          >
            <Pressable style={styles.row} onPress={() => void openSession(id)}>
              <Text style={styles.rowText}>
                {new Date(id).toLocaleString()} — {id}_Session
              </Text>
            </Pressable>
          </Swipeable>
        ))}
        {listing.ids.length === 0 && (
          <Text style={styles.empty}>No recorded sessions on this device.</Text>
        )}
      </ScrollView>
      <Pressable
        style={[styles.closeButton, { paddingBottom: 16 + insets.bottom }]}
        onPress={onClose}
      >
        <Text style={styles.closeText}>Close</Text>
      </Pressable>

      <Modal
        visible={showSettings}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.sheet}>
          <Text style={styles.headerTitle}>Debug settings</Text>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsLabel}>
              Recording FPS (next session)
            </Text>
            <View style={styles.segmentRow}>
              {FPS_OPTIONS.map((fps) => (
                <Pressable
                  key={fps}
                  style={[
                    styles.segment,
                    targetFps === fps && styles.segmentActive,
                  ]}
                  onPress={() => onChangeTargetFps(fps)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      targetFps === fps && styles.segmentTextActive,
                    ]}
                  >
                    {fps}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.settingsNote}>
              Applies when the camera session reconfigures (on leaving the debug
              screens). A requested rate may negotiate lower — metadata.json
              records what was actually negotiated. No resolution setting on
              purpose: 1920×1440 is this 6-output multi-cam topology&apos;s
              practical ceiling (the Camera app&apos;s 4K is single-camera).
            </Text>
          </View>
          <Pressable
            style={styles.closeButton}
            onPress={() => setShowSettings(false)}
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

type DetailTab = 'Overview' | 'Frames' | 'GPS' | 'Metadata' | 'Events'
const DETAIL_TABS: DetailTab[] = [
  'Overview',
  'Frames',
  'GPS',
  'Metadata',
  'Events',
]

// Fixed card heights (content height + 8 marginBottom) so both virtualized
// lists can use getItemLayout for instant arbitrary scrolling.
const FRAME_ROW_HEIGHT = 80
const GPS_ROW_HEIGHT = 172

function SessionDetail({
  summary,
  bottomInset,
  onBack,
}: {
  summary: SessionSummary
  bottomInset: number
  onBack: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('Overview')

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>{summary.epochMs}_Session</Text>
      <View style={styles.segmentRow}>
        {DETAIL_TABS.map((name) => (
          <Pressable
            key={name}
            style={[styles.segment, tab === name && styles.segmentActive]}
            onPress={() => setTab(name)}
          >
            <Text
              style={[
                styles.segmentText,
                tab === name && styles.segmentTextActive,
              ]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'Overview' && <OverviewTab summary={summary} />}
      {tab === 'Frames' && (
        <FlatList
          data={summary.frameRaw}
          keyExtractor={(_, index) => String(index)}
          initialNumToRender={12}
          getItemLayout={(_, index) => ({
            length: FRAME_ROW_HEIGHT,
            offset: FRAME_ROW_HEIGHT * index,
            index,
          })}
          renderItem={({ item, index }) => (
            <DataCard
              title={`#${index} — ${item[1] ?? '?'}`}
              height={FRAME_ROW_HEIGHT - 8}
              fields={[
                { label: 'Timestamp', value: item[0] ?? '' },
                { label: 'Source', value: item[1] ?? '' },
              ]}
            />
          )}
        />
      )}
      {tab === 'GPS' && (
        <FlatList
          data={summary.locationRaw}
          keyExtractor={(_, index) => String(index)}
          initialNumToRender={8}
          getItemLayout={(_, index) => ({
            length: GPS_ROW_HEIGHT,
            offset: GPS_ROW_HEIGHT * index,
            index,
          })}
          renderItem={({ item, index }) => (
            <DataCard
              title={`#${index} — ${item[9] ?? '?'}`}
              height={GPS_ROW_HEIGHT - 8}
              accentColor={
                item[9] === 'INTERP'
                  ? '#ff9500'
                  : item[9] === 'ERROR'
                    ? '#ff453a'
                    : undefined
              }
              fields={LOCATION_COLUMNS.slice(0, 8).map((name, column) => ({
                label: name,
                value: item[column] ?? '',
              }))}
            />
          )}
        />
      )}
      {tab === 'Metadata' && <MetadataTab summary={summary} />}
      {tab === 'Events' && <EventsTab summary={summary} />}
      <Pressable
        style={[styles.closeButton, { paddingBottom: 16 + bottomInset }]}
        onPress={onBack}
      >
        <Text style={styles.closeText}>Back</Text>
      </Pressable>
    </View>
  )
}

function OverviewTab({ summary }: { summary: SessionSummary }) {
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
      <ValidationCard summary={summary} />
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

      <InfoSection title="Frames">
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
          <InfoRow kind="neutral" label="No gaps above threshold" value="—" />
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

function ValidationCard({ summary }: { summary: SessionSummary }) {
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

function MetadataTab({ summary }: { summary: SessionSummary }) {
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

const EVENT_ACCENT: Record<string, string | undefined> = {
  error: '#ff453a',
  'interruption-started': '#ff9500',
}

function EventsTab({ summary }: { summary: SessionSummary }) {
  const events = summary.metadata?.events
  const caveat = (
    <Text style={styles.eventsCaveat}>
      Only events iOS chose to surface. Silent frame-count degradation with no
      accompanying system event is not detected here (stall detection is
      deliberately out of scope — see the Decision Log).
    </Text>
  )
  if (events == null) {
    return (
      <ScrollView>
        <InfoSection title="Session events">
          <InfoRow
            kind="neutral"
            label="Not recorded"
            value="session predates event logging"
          />
        </InfoSection>
        {caveat}
      </ScrollView>
    )
  }
  if (events.length === 0) {
    return (
      <ScrollView>
        <InfoSection title="Session events">
          <InfoRow
            kind="pass"
            label="No events recorded"
            value="clean session"
            valueColor="#34c759"
          />
        </InfoSection>
        {caveat}
      </ScrollView>
    )
  }
  return (
    <ScrollView>
      {events.map((event, index) => (
        <DataCard
          key={`event-${index}`}
          title={`#${index} — ${event.type}`}
          accentColor={EVENT_ACCENT[event.type]}
          fields={[
            {
              label: 'Time',
              value: `${event.timestampMs} (+${((event.timestampMs - summary.epochMs) / 1000).toFixed(1)}s)`,
            },
            {
              label: 'Detail',
              value: event.detail === '' ? '—' : event.detail,
            },
          ]}
        />
      ))}
      {caveat}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    paddingTop: 60,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerSide: { width: 32, alignItems: 'center' },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  // Only inside headerRow: fill the space between the side slots.
  headerTitleRow: { flex: 1 },
  gearGlyph: { color: '#4a90d9', fontSize: 20, marginBottom: 8 },
  error: { color: '#f66', textAlign: 'center', padding: 8 },
  sheet: {
    flex: 1,
    backgroundColor: '#111',
    paddingTop: 24,
  },
  settingsCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
  },
  settingsLabel: { color: '#ddd', fontSize: 13, marginBottom: 8 },
  settingsNote: { color: '#777', fontSize: 11, marginTop: 8, lineHeight: 15 },
  segmentRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  segment: {
    flex: 1,
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: '#4a90d9', borderColor: '#4a90d9' },
  segmentText: { color: '#aaa', fontSize: 13 },
  segmentTextActive: { color: '#fff', fontWeight: '600' },
  row: {
    padding: 14,
    backgroundColor: '#111',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  rowText: { color: '#ddd' },
  empty: { color: '#888', textAlign: 'center', padding: 24 },
  swipeDelete: {
    backgroundColor: '#c0392b',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  swipeDeleteText: { color: '#fff', fontWeight: '600' },
  map: { height: 300 },
  videoRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginTop: 16,
    marginBottom: 14,
  },
  videoBox: { flex: 1 },
  videoLabel: { color: '#ddd', fontSize: 13, marginBottom: 4 },
  video: { height: 160, backgroundColor: '#000', borderRadius: 8 },
  eventsCaveat: {
    color: '#777',
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  rawFallback: {
    color: '#999',
    fontFamily: 'Menlo',
    fontSize: 11,
    padding: 12,
  },
  closeButton: { padding: 16, alignItems: 'center' },
  closeText: { color: '#4a90d9', fontSize: 16 },
})
