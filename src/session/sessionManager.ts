import { Directory, Paths } from 'expo-file-system'

export interface SessionPaths {
  rootUri: string
  frontVideoUri: string
  backVideoUri: string
  frameDataUri: string
  locationDataUri: string
  metadataUri: string
}

export interface Session {
  epochMs: number
  paths: SessionPaths
}

/**
 * Every prefixed name is derived
 * from the one epochMs passed in, generated once and never re-derived per
 * file. Separated from the filesystem call so naming is unit-testable
 * without a device.
 */
export function buildSessionPaths(
  epochMs: number,
  containerUri: string,
): SessionPaths {
  const rootUri = `${containerUri.replace(/\/$/, '')}/${epochMs}_Session`
  return {
    rootUri,
    frontVideoUri: `${rootUri}/${epochMs}_FrontVideo.mov`,
    backVideoUri: `${rootUri}/${epochMs}_BackVideo.mov`,
    frameDataUri: `${rootUri}/${epochMs}_FrameData.csv`,
    locationDataUri: `${rootUri}/${epochMs}_LocationData.csv`,
    metadataUri: `${rootUri}/metadata.json`,
  }
}

/**
 * Generates the session identity and creates its folder. `Date.now()` here
 * is session bookkeeping (the folder-naming epoch GOAL.md §6 defines as
 * "the moment recording started"), not a data timestamp. Every row in the
 * CSVs still carries only native hardware clocks, this is the one
 * deliberate exception to that rule, scoped to session identity only.
 */
export function startSession(): Session {
  const epochMs = Date.now()
  const paths = buildSessionPaths(epochMs, Paths.document.uri)
  new Directory(paths.rootUri).create()
  return { epochMs, paths }
}
