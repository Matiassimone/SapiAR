import { useRef, useState } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { DEFAULT_FPS } from './app/record/camera.constants'
import RecordScreen from './app/record/RecordScreen'
import { styles } from './app/record/recordScreen.styles'
import { useCameraPipeline } from './app/record/useCameraPipeline'
import { useRecording } from './app/record/useRecording'
import { useSessionEvents } from './app/record/useSessionEvents'
import SessionDebugScreen from './app/debug/SessionDebugScreen'
import type { ActiveRecording } from './src/session/recordingSession'

export default function App() {
  const [showDebug, setShowDebug] = useState(false)
  const [targetFps, setTargetFps] = useState(DEFAULT_FPS)

  const recordingRef = useRef<ActiveRecording | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { toast, dismissToast, toastTimerRef, eventsRef, recordEvent } =
    useSessionEvents(recordingRef)

  const { rig, status, setStatus, cameraHealth, clearHealth, retryBringUp } =
    useCameraPipeline({
      targetFps,
      recordEvent,
      eventsRef,
      toastTimerRef,
      timerRef,
      recordingRef,
    })

  const { elapsedS, toggleRecording } = useRecording(
    rig,
    recordingRef,
    timerRef,
  )

  if (showDebug) {
    return (
      <GestureHandlerRootView style={styles.container}>
        <SafeAreaProvider>
          <SessionDebugScreen
            onClose={() => setShowDebug(false)}
            targetFps={targetFps}
            onChangeTargetFps={(fps) => {
              clearHealth()
              setTargetFps(fps)
            }}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    )
  }
  return (
    <RecordScreen
      rig={rig}
      status={status}
      elapsedS={elapsedS}
      toast={toast}
      cameraHealth={cameraHealth}
      onToggleRecording={toggleRecording}
      onRecordingError={setStatus}
      onDismissToast={dismissToast}
      onRetryBringUp={retryBringUp}
      onOpenDebug={() => setShowDebug(true)}
    />
  )
}
