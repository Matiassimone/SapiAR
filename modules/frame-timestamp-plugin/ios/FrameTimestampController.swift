import AVFoundation
import Foundation
import NitroModules
import VisionCamera

/// Owns one timestamp-capture camera output and exposes its buffer to TS.
/// One instance per camera. `Source` is implicit because TS knows which camera each
/// controller was attached to.
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

/// A vision-camera v5 custom output that captures every frame's hardware
/// `presentationTimeStamp` on the capture thread and buffers it as Unix ms.
///
/// Conforms to vision-camera's public `HybridCameraOutputSpec` +
/// `NativeCameraOutput` (the documented custom-output extension point) with
/// no overrides. Spec inheritance is avoided entirely, see the design doc.
///
/// Per CLAUDE.md Architecture Rule #2, the per-frame callback does the minimum
/// possible work. One clock read already inside the sample buffer, one add,
/// one array append under a lock. No file I/O, no serialization, no JSI.
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
    // Every frame must produce a row (CLAUDE.md: frame-count check demands
    // completeness). Our delegate work is ~ns, so late-frame pressure from
    // this output is not a realistic risk.
    output.alwaysDiscardsLateVideoFrames = false
    // `deliversPreviewSizedOutputBuffers` must never be set here. It
    // throws NSInvalidArgumentException on data-only outputs with no preview
    // layer (uncatchable from Swift, crashed on device, checkpoint 8), and
    // the bandwidth concern it targeted doesn't apply: recording uses
    // AVCaptureMovieFileOutput, which adds no frame-streaming consumer.
    output.setSampleBufferDelegate(delegate, queue: queue)
  }

  func configure(config: OutputConfiguration) {
    // Mirroring and orientation don't affect timestamps, nothing to apply.
  }
}

/// Receives sample buffers on the capture queue and buffers their
/// presentation timestamps converted to Unix ms.
private final class TimestampDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  /// Host-clock → Unix-epoch anchor, computed once per output. Both readings
  /// are taken back-to-back (µs skew), so frame-to-frame deltas still come
  /// 100% from the hardware clock. The anchor only positions the series on
  /// the epoch. This is not a per-frame `Date()` read (see design doc).
  private let epochOffsetMs: Double = {
    var wall = timespec()
    clock_gettime(CLOCK_REALTIME, &wall)
    let host = CMClockGetTime(CMClockGetHostTimeClock())
    let wallMs = Double(wall.tv_sec) * 1000.0 + Double(wall.tv_nsec) / 1_000_000.0
    return wallMs - host.seconds * 1000.0
  }()

  // NSLock over OSAllocatedUnfairLock: the pod's deployment target (RN's
  // 15.1 floor) predates iOS 16, and lock traffic is ~60/s, so contention is
  // not a factor at this rate.
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
