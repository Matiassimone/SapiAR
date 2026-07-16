import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
// Legacy Swipeable on purpose. ReanimatedSwipeable needs
// react-native-reanimated (babel plugin + worklets runtime), too heavy a
// dependency for one swipe gesture on internal tooling.
import { Swipeable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DebugSettingsSheet } from './DebugSettingsSheet'
import { SessionDetail } from './SessionDetail'
import { styles } from './sessionDebug.styles'
import { useSessionBrowser } from './useSessionBrowser'

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
          Sessions
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
