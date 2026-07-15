import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  NativePreviewView,
  VisionCamera,
  type CameraPreviewOutput,
  type CameraSession,
  type CameraSessionConnection,
} from 'react-native-vision-camera'

interface DualPreviews {
  front: CameraPreviewOutput
  back: CameraPreviewOutput
}

export default function App() {
  const [previews, setPreviews] = useState<DualPreviews | null>(null)
  const [status, setStatus] = useState('Starting cameras…')

  useEffect(() => {
    let session: CameraSession | undefined
    let cancelled = false

    const setup = async (): Promise<void> => {
      const granted =
        VisionCamera.cameraPermissionStatus === 'authorized' ||
        (await VisionCamera.requestCameraPermission())
      if (!granted) {
        setStatus('Camera permission denied — enable it in Settings.')
        return
      }
      if (!VisionCamera.supportsMultiCamSessions) {
        setStatus(
          'This device does not support simultaneous multi-camera capture.',
        )
        return
      }

      // Only hardware-supported device combinations can share one multi-cam
      // session; pick the first combination that offers a front + back pair
      // rather than pairing arbitrary devices ourselves.
      const deviceFactory = await VisionCamera.createDeviceFactory()
      const combination =
        deviceFactory.supportedMultiCamDeviceCombinations.find(
          (combo) =>
            combo.some((device) => device.position === 'front') &&
            combo.some((device) => device.position === 'back'),
        )
      const frontDevice = combination?.find(
        (device) => device.position === 'front',
      )
      const backDevice = combination?.find(
        (device) => device.position === 'back',
      )
      if (frontDevice == null || backDevice == null) {
        setStatus(
          'No supported front + back camera combination on this device.',
        )
        return
      }

      const front = VisionCamera.createPreviewOutput()
      const back = VisionCamera.createPreviewOutput()
      // ponytail: preview-only connections, default formats (constraints: []).
      // Recording outputs + HEVC/format constraints land in checkpoint 3+.
      const connections: CameraSessionConnection[] = [
        {
          input: frontDevice,
          outputs: [{ output: front, mirrorMode: 'auto' }],
          constraints: [],
        },
        {
          input: backDevice,
          outputs: [{ output: back, mirrorMode: 'auto' }],
          constraints: [],
        },
      ]
      session = await VisionCamera.createCameraSession(true)
      await session.configure(connections)
      if (cancelled) return
      await session.start()
      setPreviews({ front, back })
    }

    setup().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      void session?.stop()
    }
  }, [])

  return (
    <View style={styles.container}>
      {previews != null ? (
        <>
          <NativePreviewView
            style={styles.preview}
            previewOutput={previews.back}
          />
          <NativePreviewView
            style={styles.preview}
            previewOutput={previews.front}
          />
        </>
      ) : (
        <Text style={styles.status}>{status}</Text>
      )}
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  preview: {
    flex: 1,
  },
  status: {
    color: '#fff',
    textAlign: 'center',
    padding: 24,
  },
})
