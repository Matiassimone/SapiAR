import AVFoundation
import Foundation
import NitroModules
import VisionCamera

/// JS-facing entry point (Nitro Module).
/// Owns one timestamp-capture output and exposes its buffer to TS. One per
/// camera, `Source` is implicit because TS knows which camera it attached.
final class FrameTimestampController: HybridFrameTimestampControllerSpec {
  private let cameraOutput = FrameTimestampCameraOutput()

  var count: Double {
    return Double(cameraOutput.delegate.snapshotCount())
  }

  var droppedCount: Double {
    return Double(cameraOutput.delegate.snapshotDroppedCount())
  }

  func drain() throws -> [Double] {
    return cameraOutput.delegate.drain()
  }

  func getCameraOutput() throws -> any HybridCameraOutputSpec {
    return cameraOutput
  }
}

/// Captures every frame's hardware `presentationTimeStamp` on the capture
/// thread and buffers it as Unix ms. Uses vision-camera's public
/// `NativeCameraOutput` extension point.
private final class FrameTimestampCameraOutput: HybridCameraOutputSpec, NativeCameraOutput {
  let delegate = TimestampDelegate()
  private let queue = DispatchQueue(
    label: "com.simdevelop.sapiar.frametimestamp",
    qos: .userInteractive)

  // MARK: NativeCameraOutput

  let output = AVCaptureVideoDataOutput()
  let requiresAudioInput = false
  let requiresDepthFormat = false

  // MARK: ResolutionNegotiationParticipant

  /// `.any`: timestamps are resolution-independent, so this output must never
  /// influence the format negotiated for preview/recording outputs.
  let targetResolution: ResolutionRule = .any
  let streamType: StreamType = .video

  // MARK: HybridCameraOutputSpec

  let mediaType: MediaType = .video
  /// Stored but unapplied. Orientation is meaningless for timestamp capture.
  var outputOrientation: CameraOrientation = .up
  /// Metadata-only output: no pixel consumer, nothing meaningful to report.
  let currentResolution: Size? = nil

  override init() {
    super.init()
    // Every frame must produce a row, and this delegate's work is ~ns, so
    // late-frame pressure isn't a realistic risk here.
    output.alwaysDiscardsLateVideoFrames = false

    // Never set deliversPreviewSizedOutputBuffers here, it crashes on a
    // data-only output with no preview layer. Recording uses
    // AVCaptureMovieFileOutput separately, so this output never needs
    // the bandwidth saving anyway.
    output.setSampleBufferDelegate(delegate, queue: queue)
  }

  func configure(config: OutputConfiguration) {
    // Mirroring and orientation don't affect timestamps, nothing to apply.
  }
}

/// Receives sample buffers on the capture queue and buffers their
/// presentation timestamps converted to Unix ms.
private final class TimestampDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  /// Converts frame timestamps (time since boot) to Unix ms (real world time).
  /// Computed once: read both clocks back-to-back, the gap between them tells
  /// us what Unix time it was when the boot clock hit zero. After that, any
  /// frame's timestamp just needs this offset added, no repeated clock reads.
  private let epochOffsetMs: Double = {
    var wall = timespec()
    clock_gettime(CLOCK_REALTIME, &wall)
    let host = CMClockGetTime(CMClockGetHostTimeClock())
    let wallMs = Double(wall.tv_sec) * 1000.0 + Double(wall.tv_nsec) / 1_000_000.0
    return wallMs - host.seconds * 1000.0
  }()

  // NSLock instead of the newer OSAllocatedUnfairLock: this project
  // supports iOS 15, that API needs iOS 16+.
  private let lock = NSLock()
  private var timestampsMs: [Double] = []
  private var dropped: Int = 0

  func captureOutput(
    _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    let unixMs = sampleBuffer.presentationTimeStamp.seconds * 1000.0 + epochOffsetMs
    lock.lock()
    timestampsMs.append(unixMs)
    lock.unlock()
  }

  func captureOutput(
    _ output: AVCaptureOutput, didDrop sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    lock.lock()
    dropped += 1
    lock.unlock()
  }

  func snapshotCount() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return timestampsMs.count
  }

  func snapshotDroppedCount() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return dropped
  }

  func drain() -> [Double] {
    lock.lock()
    defer { lock.unlock() }
    let drained = timestampsMs
    timestampsMs = []
    return drained
  }
}