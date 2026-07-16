import { Modal, Pressable, Text, View } from 'react-native'

import { FPS_OPTIONS } from './sessionDebug.constants'
import { styles } from './sessionDebug.styles'

export function DebugSettingsSheet({
  visible,
  targetFps,
  onChangeTargetFps,
  onClose,
}: {
  visible: boolean
  targetFps: number
  onChangeTargetFps: (fps: number) => void
  onClose: () => void
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.settingsCard}>
          <Text style={styles.settingsLabel}>Recording FPS</Text>
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
        </View>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeText}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  )
}
