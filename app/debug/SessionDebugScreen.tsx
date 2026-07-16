import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
// Legacy Animated-based Swipeable. ReanimatedSwipeable requires
// react-native-reanimated with its babel plugin and worklets runtime, too
// heavy a native dependency for a swipe gesture on internal tooling.
import { Swipeable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DebugSettingsSheet } from './DebugSettingsSheet'
import { SessionDetail } from './SessionDetail'
import { styles } from './sessionDebug.styles'
import { useSessionBrowser } from './useSessionBrowser'

/**
 * Development and debug viewer, not part of the evaluated UI per CLAUDE.md.
 * Read-only over already-written session folders. Every value shown is
 * read or grouped from the CSVs, nothing is recomputed from the pipeline's
 * inputs. The sole exception, per amended Architecture Rule #7, is
 * whole-session folder deletion via swipe on a list row. The gesture is
 * iOS's own confirmation friction and there is no second delete path.
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
  const [showSettings, setShowSettings] = useState(false)
  const { listing, summary, error, openSession, removeSession, closeSummary } =
    useSessionBrowser()

  if (summary != null) {
    return (
      <SessionDetail
        summary={summary}
        bottomInset={insets.bottom}
        onBack={closeSummary}
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
                {new Date(id).toLocaleString()} · {id}_Session
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

      <DebugSettingsSheet
        visible={showSettings}
        targetFps={targetFps}
        onChangeTargetFps={onChangeTargetFps}
        onClose={() => setShowSettings(false)}
      />
    </View>
  )
}
