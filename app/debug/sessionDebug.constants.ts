export const LOCATION_COLUMNS = [
  'Timestamp_unix_ms',
  'Lat',
  'Long',
  'Speed_m_s',
  'Course_deg',
  'CourseAccuracy_deg',
  'HorizontalAccuracy_m',
  'VerticalAccuracy_m',
  'is_interpolated',
  'quality_flag',
]

export const FPS_OPTIONS = [24, 30, 60]

export type DetailTab = 'Overview' | 'Frames' | 'GPS' | 'Metadata' | 'Events'
export const DETAIL_TABS: DetailTab[] = [
  'Overview',
  'Frames',
  'GPS',
  'Metadata',
  'Events',
]

// Fixed card heights (content height + 8 marginBottom) so both virtualized
// lists can use getItemLayout for instant arbitrary scrolling.
export const FRAME_ROW_HEIGHT = 80
export const GPS_ROW_HEIGHT = 172

export const EVENT_ACCENT: Record<string, string | undefined> = {
  error: '#ff453a',
  'interruption-started': '#ff9500',
}
