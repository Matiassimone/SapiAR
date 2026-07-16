import { StatusBar } from 'expo-status-bar'
import { Pressable, Text, View } from 'react-native'
import { NativePreviewView } from 'react-native-vision-camera'

import { styles } from './recordScreen.styles'
import type { CameraRig } from './useCameraPipeline'

/**
 * The evaluated minimal UI per GOAL.md §7. Dual preview, one record/stop
 * button, a timer, plus the health banner, the event toast, and the
 * debug-screen entry. Purely presentational, every piece of state comes
 * from the hooks composed in App.
 */
export default function RecordScreen({
  rig,
  status,
  elapsedS,
  toast,
  cameraHealth,
  onToggleRecording,
  onRecordingError,
  onDismissToast,
  onRetryBringUp,
  onOpenDebug,
}: {
  rig: CameraRig | null
  status: string
  elapsedS: number | null
  toast: string | null
  cameraHealth: string | null
  onToggleRecording: () => Promise<void>
  onRecordingError: (message: string) => void
  onDismissToast: () => void
  onRetryBringUp: () => void
  onOpenDebug: () => void
}) {
  const isRecording = elapsedS != null
  return (
    <View style={styles.container}>
      {rig != null ? (
        <>
          <NativePreviewView
            style={styles.preview}
            previewOutput={rig.previews.back}
          />
          <NativePreviewView
            style={styles.preview}
            previewOutput={rig.previews.front}
          />
          {isRecording && (
            <View style={styles.timer}>
              <Text style={styles.timerText}>
                {`${Math.floor(elapsedS / 60)}:${String(elapsedS % 60).padStart(2, '0')}`}
              </Text>
            </View>
          )}
          <Pressable
            style={styles.recordButton}
            onPress={() => {
              onToggleRecording().catch((error: unknown) => {
                onRecordingError(
                  error instanceof Error ? error.message : String(error),
                )
              })
            }}
          >
            <View style={isRecording ? styles.stopIcon : styles.recordIcon} />
          </Pressable>
        </>
      ) : (
        <Text style={styles.status}>{status}</Text>
      )}
      {rig != null && status !== '' && (
        <Text style={styles.errorBanner}>{status}</Text>
      )}
      {toast != null && isRecording && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
          <Pressable hitSlop={10} onPress={onDismissToast}>
            <Text style={styles.toastClose}>✕</Text>
          </Pressable>
        </View>
      )}
      {cameraHealth != null && !isRecording && (
        <Pressable style={styles.healthBanner} onPress={onRetryBringUp}>
          <Text style={styles.healthText}>{cameraHealth}</Text>
        </Pressable>
      )}
      {!isRecording && (
        <Pressable style={styles.debugEntry} onPress={onOpenDebug}>
          <Text style={styles.debugEntryText}>Sessions</Text>
        </Pressable>
      )}
      <StatusBar style="light" />
    </View>
  )
}
