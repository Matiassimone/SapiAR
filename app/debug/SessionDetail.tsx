import { useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'

import { EventsTab } from './EventsTab'
import { MetadataTab } from './MetadataTab'
import { OverviewTab } from './OverviewTab'
import {
  DETAIL_TABS,
  FRAME_ROW_HEIGHT,
  GPS_ROW_HEIGHT,
  LOCATION_COLUMNS,
  type DetailTab,
} from './sessionDebug.constants'
import { styles } from './sessionDebug.styles'
import { DataCard } from '../components/DataCard'
import type { SessionSummary } from './useSessionBrowser'

export function SessionDetail({
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
              title={`#${index} · ${item[1] ?? '?'}`}
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
              title={`#${index} · ${item[9] ?? '?'}`}
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
