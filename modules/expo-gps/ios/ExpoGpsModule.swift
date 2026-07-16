import CoreLocation
import ExpoModulesCore

/// One raw GPS entry, either a location fix or a hardware error, in one
/// chronological stream. All values pass through unclassified: CoreLocation
/// already encodes "unavailable" as negative numbers, and mapping those to
/// the spec's `-1`/quality_flag semantics is TS data-assembly work
/// (see CLAUDE.md architecture table and the checkpoint-4 design doc).
struct GpsSample: Record {
  @Field var timestampMs: Double?
  @Field var lat: Double?
  @Field var long: Double?
  @Field var speedMs: Double?
  @Field var courseDeg: Double?
  @Field var courseAccuracyDeg: Double?
  @Field var horizontalAccuracyM: Double?
  @Field var verticalAccuracyM: Double?
  /// Non-nil marks a hardware-error entry (raw CLError code).
  @Field var errorCode: Int?
  @Field var errorDomain: String?
}

public class ExpoGpsModule: Module {
  private let capture = GpsCapture()

  public func definition() -> ModuleDefinition {
    Name("ExpoGps")

    AsyncFunction("requestPermission") { (promise: Promise) in
      self.capture.requestPermission(promise: promise)
    }.runOnQueue(.main)

    Function("start") {
      self.capture.start()
    }

    Function("stop") {
      self.capture.stop()
    }

    Function("drain") { () -> [GpsSample] in
      return self.capture.drain()
    }

    Property("count") {
      return self.capture.count
    }
  }
}

/// Owns the CLLocationManager and the sample buffer. Lives on the main
/// thread: CLLocationManager requires a run-loop thread for its delegate
/// callbacks, and main is the only one guaranteed alive for the app's
/// lifetime. Buffer appends/reads are NSLock-guarded because `drain()` and
/// `count` arrive from the JS thread.
private final class GpsCapture: NSObject, CLLocationManagerDelegate {
  private var manager: CLLocationManager?
  private var pendingPermission: Promise?

  private let lock = NSLock()
  private var samples: [GpsSample] = []

  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return samples.count
  }

  func drain() -> [GpsSample] {
    lock.lock()
    defer { lock.unlock() }
    let drained = samples
    samples = []
    return drained
  }

  func requestPermission(promise: Promise) {
    let manager = ensureManager()
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      promise.resolve(true)
    case .denied, .restricted:
      promise.resolve(false)
    case .notDetermined:
      // Resolved in locationManagerDidChangeAuthorization once iOS reports
      // the user's choice. The request API itself returns immediately.
      pendingPermission = promise
      manager.requestWhenInUseAuthorization()
    @unknown default:
      promise.resolve(false)
    }
  }

  func start() {
    // Dispatched to main: CLLocationManager needs a run-loop thread, and
    // sync expo Functions arrive on the JS thread (`runOnQueue` is only
    // available on AsyncFunction in this expo-modules version).
    DispatchQueue.main.async {
      let manager = self.ensureManager()
      // Every available update at best precision (GOAL.md §3): no distance
      // gating, and no silent auto-pause. iOS may otherwise stop the stream
      // when it judges the user stationary, which breaks a continuous log.
      manager.desiredAccuracy = kCLLocationAccuracyBest
      manager.distanceFilter = kCLDistanceFilterNone
      manager.pausesLocationUpdatesAutomatically = false
      manager.startUpdatingLocation()
    }
  }

  func stop() {
    DispatchQueue.main.async {
      self.manager?.stopUpdatingLocation()
    }
  }

  private func ensureManager() -> CLLocationManager {
    if let manager {
      return manager
    }
    let created = CLLocationManager()
    created.delegate = self
    manager = created
    return created
  }

  // MARK: CLLocationManagerDelegate

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard let promise = pendingPermission else { return }
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      pendingPermission = nil
      promise.resolve(true)
    case .denied, .restricted:
      pendingPermission = nil
      promise.resolve(false)
    case .notDetermined:
      // Fires once on delegate assignment before the user has chosen,
      // keep waiting for the real outcome.
      break
    @unknown default:
      pendingPermission = nil
      promise.resolve(false)
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // CoreLocation can deliver several queued fixes in one callback and every
    // element is an update the spec wants (GOAL.md: every available update).
    let entries = locations.map { location -> GpsSample in
      let sample = GpsSample()
      sample.timestampMs = location.timestamp.timeIntervalSince1970 * 1000.0
      sample.lat = location.coordinate.latitude
      sample.long = location.coordinate.longitude
      sample.speedMs = location.speed
      sample.courseDeg = location.course
      sample.courseAccuracyDeg = location.courseAccuracy
      sample.horizontalAccuracyM = location.horizontalAccuracy
      sample.verticalAccuracyM = location.verticalAccuracy
      return sample
    }
    lock.lock()
    samples.append(contentsOf: entries)
    lock.unlock()
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // Recorded in the same chronological buffer, never dropped. Transient
    // errors (kCLErrorLocationUnknown) keep the manager running. Whether an
    // entry becomes an ERROR sentinel row is downstream TS policy.
    let sample = GpsSample()
    let nsError = error as NSError
    sample.errorCode = nsError.code
    sample.errorDomain = nsError.domain
    lock.lock()
    samples.append(sample)
    lock.unlock()
  }
}
