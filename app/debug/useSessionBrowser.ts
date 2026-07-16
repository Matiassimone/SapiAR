import { Directory, File, Paths } from 'expo-file-system'
import { useState } from 'react'

import {
  countByQualityFlag,
  deriveGapRuns,
  parseFrameCounts,
  parseLocationCsv,
  parseRawRows,
  type GapRun,
  type LocationRow,
  type QualityFlag,
} from '../../src/csv/csvReader'
import type { SessionMetadata } from '../../src/session/metadata'

export interface SessionSummary {
  epochMs: number
  rootUri: string
  frames: { front: number; back: number }
  flagCounts: Record<QualityFlag, number>
  gaps: GapRun[]
  track: LocationRow[]
  locationRaw: string[][]
  frameRaw: string[][]
  metadata: SessionMetadata | null
  metadataJson: string
  videoSizes: { front: number | null; back: number | null }
}

function listSessions(): { ids: number[]; error: string | null } {
  try {
    const entries = new Directory(Paths.document).list()
    const ids = entries
      .map((entry) => /(\d+)_Session\/?$/.exec(entry.uri)?.[1])
      .filter((id): id is string => id != null)
      .map(Number)
      .sort((a, b) => b - a)
    return { ids, error: null }
  } catch (listError: unknown) {
    return {
      ids: [],
      error: listError instanceof Error ? listError.message : String(listError),
    }
  }
}

function sessionRootUri(epochMs: number): string {
  return `${Paths.document.uri.replace(/\/$/, '')}/${epochMs}_Session`
}

/**
 * Owns the session folder browsing state. Listing, the opened session's
 * parsed summary, and whole-folder deletion. Everything a summary holds is
 * read or grouped from the already-written CSVs, nothing is recomputed
 * from the pipeline's inputs.
 */
export function useSessionBrowser() {
  const [listing, setListing] = useState(listSessions)
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openSession = async (epochMs: number): Promise<void> => {
    try {
      const root = sessionRootUri(epochMs)
      const location = await new File(
        `${root}/${epochMs}_LocationData.csv`,
      ).text()
      const frames = await new File(`${root}/${epochMs}_FrameData.csv`).text()
      let metadata: SessionMetadata | null = null
      let metadataJson = '(missing)'
      try {
        metadataJson = await new File(`${root}/metadata.json`).text()
        metadata = JSON.parse(metadataJson) as SessionMetadata
      } catch {
        // A crashed or interrupted session may lack metadata. The viewer
        // still shows everything else rather than refusing to open.
      }
      const sizeOf = (name: string): number | null => {
        try {
          return new File(`${root}/${name}`).size
        } catch {
          return null
        }
      }
      const track = parseLocationCsv(location)
      setSummary({
        epochMs,
        rootUri: root,
        frames: parseFrameCounts(frames),
        flagCounts: countByQualityFlag(track),
        gaps: deriveGapRuns(track),
        track,
        locationRaw: parseRawRows(location),
        frameRaw: parseRawRows(frames),
        metadata,
        metadataJson,
        videoSizes: {
          front: sizeOf(`${epochMs}_FrontVideo.mov`),
          back: sizeOf(`${epochMs}_BackVideo.mov`),
        },
      })
    } catch (readError: unknown) {
      setError(
        readError instanceof Error ? readError.message : String(readError),
      )
    }
  }

  const removeSession = (epochMs: number): void => {
    try {
      new Directory(sessionRootUri(epochMs)).delete()
      setSummary(null)
      setListing(listSessions())
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : String(deleteError),
      )
    }
  }

  const closeSummary = (): void => {
    setSummary(null)
  }

  return { listing, summary, error, openSession, removeSession, closeSummary }
}
