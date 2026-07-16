import { useRef, useState, type RefObject } from 'react'

import {
  startRecordingSession,
  type ActiveRecording,
} from '../../src/session/recordingSession'
import type { CameraRig } from './useCameraPipeline'

export function useRecording(
  rig: CameraRig | null,
  recordingRef: RefObject<ActiveRecording | null>,
  timerRef: RefObject<ReturnType<typeof setInterval> | null>,
) {
  const [elapsedS, setElapsedS] = useState<number | null>(null)
  const startingRef = useRef(false)

  const toggleRecording = async (): Promise<void> => {
    if (rig == null) return

    if (recordingRef.current == null) {
      // Claimed before the await. A second tap mid-start must not launch a
      // concurrent session over the same native buffers. Double-tap race
      // found on device, checkpoint 9.
      if (startingRef.current) return

      startingRef.current = true
      let recording: ActiveRecording

      try {
        recording = await startRecordingSession(rig.recordingDeps)
      } finally {
        startingRef.current = false
      }

      recordingRef.current = recording
      setElapsedS(0)

      timerRef.current = setInterval(() => {
        setElapsedS(Math.round((Date.now() - recording.epochMs) / 1000))
      }, 1000)
    } else {
      const active = recordingRef.current
      recordingRef.current = null

      if (timerRef.current != null) clearInterval(timerRef.current)

      timerRef.current = null
      setElapsedS(null)
      await active.stop()
    }
  }

  return { elapsedS, toggleRecording }
}
