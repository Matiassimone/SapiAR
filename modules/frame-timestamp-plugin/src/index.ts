import { NitroModules } from 'react-native-nitro-modules'
import type { FrameTimestampController } from './FrameTimestampController.nitro'

export type { FrameTimestampController }

/**
 * Creates one native timestamp-capture controller. Instantiate one per camera
 * and append its `getCameraOutput()` to that camera's connection outputs in
 * `session.configure()`.
 */
export function createFrameTimestampController(): FrameTimestampController {
  return NitroModules.createHybridObject<FrameTimestampController>(
    'FrameTimestampController',
  )
}
