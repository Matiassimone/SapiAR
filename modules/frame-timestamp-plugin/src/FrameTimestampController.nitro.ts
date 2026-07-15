import type { HybridObject } from 'react-native-nitro-modules'
import type { CameraOutput } from 'react-native-vision-camera'

/**
 * Owns one native timestamp-capture camera output (one instance per camera).
 *
 * Standalone spec + cross-module method return (`getCameraOutput`) instead of
 * extending vision-camera's `CameraOutput` spec: nitrogen 0.36.1 generates
 * uncompilable Swift for cross-module spec inheritance (`override` of
 * non-`open` members), while external HybridObjects in method returns are the
 * same proven pattern vision-camera itself uses with nitro-image types.
 * See docs/superpowers/specs/2026-07-14-frame-timestamp-plugin-design.md.
 */
export interface FrameTimestampController extends HybridObject<{
  ios: 'swift'
}> {
  /** Number of frame timestamps currently buffered. */
  readonly count: number
  /**
   * Frames AVFoundation reported as dropped for this output since creation.
   * Kept native-side so a frame-count mismatch can be attributed to pipeline
   * drops vs. capture gaps (CLAUDE.md Validation Strategy).
   */
  readonly droppedCount: number
  /** Returns all buffered Unix-ms timestamps and clears the buffer. */
  drain(): number[]
  /**
   * The camera output to append to this camera's connection `outputs` in
   * `session.configure()`. Every frame it sees lands in this controller's
   * buffer.
   */
  getCameraOutput(): CameraOutput
}
