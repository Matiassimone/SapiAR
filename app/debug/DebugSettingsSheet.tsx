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
        <Text style={styles.headerTitle}>Debug settings</Text>
        <View style={styles.settingsCard}>
          <Text style={styles.settingsLabel}>Recording FPS (next session)</Text>
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
            Applies when the camera session reconfigures, on leaving the debug
            screens. A requested rate may negotiate lower and metadata.json
            records what was actually negotiated. There is no resolution setting
            on purpose, 1920×1440 is the practical ceiling of this 6-output
            multi-cam topology. The Camera app&apos;s 4K is single-camera.
          </Text>
        </View>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeText}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  )
}
