import { ScrollView } from 'react-native'

import { EVENT_ACCENT } from './sessionDebug.constants'
import { DataCard } from '../components/DataCard'
import { InfoRow } from '../components/InfoRow'
import { InfoSection } from '../components/InfoSection'
import type { SessionSummary } from './useSessionBrowser'

export function EventsTab({ summary }: { summary: SessionSummary }) {
  const events = summary.metadata?.events

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
      </ScrollView>
    )
  }
  return (
    <ScrollView>
      {events.map((event, index) => (
        <DataCard
          key={`event-${index}`}
          title={`#${index} · ${event.type}`}
          accentColor={EVENT_ACCENT[event.type]}
          fields={[
            {
              label: 'Time',
              value: `${event.timestampMs} (+${((event.timestampMs - summary.epochMs) / 1000).toFixed(1)}s)`,
            },
            {
              label: 'Detail',
              value: event.detail === '' ? 'none' : event.detail,
            },
          ]}
        />
      ))}
    </ScrollView>
  )
}
