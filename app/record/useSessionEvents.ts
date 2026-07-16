import { useRef, useState, type RefObject } from 'react'

import type { SessionEvent } from '../../src/session/metadata'
import type { ActiveRecording } from '../../src/session/recordingSession'

/**
 * Owns the append-only session event log and the recording toast.
 * Observability only, never read by recording or retry logic.
 * recordingSession scopes the log per session by timestamp at stop().
 * The Date.now() legality note lives on metadata.ts SessionEvent.
 */
export function useSessionEvents(
  recordingRef: RefObject<ActiveRecording | null>,
) {
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventsRef = useRef<SessionEvent[]>([])

  const recordEvent = (type: SessionEvent['type'], detail: string): void => {
    eventsRef.current.push({ timestampMs: Date.now(), type, detail })

    if (recordingRef.current != null) {
      setToast(`${type}${detail === '' ? '' : `: ${detail}`}`)
      if (toastTimerRef.current != null) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToast(null), 4000)
    }
  }

  const dismissToast = (): void => {
    if (toastTimerRef.current != null) {
      clearTimeout(toastTimerRef.current)
    }
    setToast(null)
  }

  return { toast, dismissToast, toastTimerRef, eventsRef, recordEvent }
}
