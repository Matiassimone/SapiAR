import { requireNativeModule } from 'expo-modules-core'

/**
 * One raw GPS entry (fix or hardware error) in one chronological stream.
 * Unclassified pass-through: CoreLocation encodes "unavailable" as
 * negatives, error entries have non-null errorCode and null location
 * fields. The -1/quality_flag mapping is TS assembly work (checkpoints 6/7).
 */
export interface GpsSample {
  timestampMs: number | null
  lat: number | null
  long: number | null
  speedMs: number | null
  courseDeg: number | null
  courseAccuracyDeg: number | null
  horizontalAccuracyM: number | null
  verticalAccuracyM: number | null
  errorCode: number | null
  errorDomain: string | null
}

interface ExpoGpsModule {
  requestPermission(): Promise<boolean>
  start(): void
  stop(): void
  drain(): GpsSample[]
  readonly count: number
}

export const ExpoGps = requireNativeModule<ExpoGpsModule>('ExpoGps')
