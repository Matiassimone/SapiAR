import type { SessionMetadata } from '../../src/session/metadata'

export function formatResolution(
  resolution: NonNullable<SessionMetadata['resolution']>,
): string {
  const { front, back } = resolution
  if (front.width === back.width && front.height === back.height) {
    return `${front.width}×${front.height}`
  }
  return `front ${front.width}×${front.height} · back ${back.width}×${back.height}`
}
