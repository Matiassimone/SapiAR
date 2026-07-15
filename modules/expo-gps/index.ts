import { requireNativeModule } from 'expo-modules-core'

/**
 * One raw GPS entry — a location fix or a hardware error, in one
 * chronological stream. Values are unclassified pass-throughs: CoreLocation
 * encodes "unavailable" as negative numbers, and error entries carry a
 * non-null `errorCode` with all location fields null. Mapping to the spec's
 * `-1`/quality_flag semantics happens in TS data assembly (checkpoints 6/7).
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
