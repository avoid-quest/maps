package quest.avoid.maps.navigation

import kotlin.math.*

/** Policies consume monotonic elapsed time, never the wall clock. */
class RerouteBudget {
  private data class Attempt(val at: Long, val latitude: Double, val longitude: Double)
  private val attempts = ArrayDeque<Attempt>()
  private var last: Attempt? = null

  @Synchronized
  fun tryAcquire(nowMs: Long, latitude: Double, longitude: Double): Boolean {
    if (nowMs < 0 || !NavigationGeometry.valid(latitude, longitude)) return false
    val previous = last
    if (previous != null && (nowMs < previous.at || nowMs - previous.at < 30_000 ||
        NavigationGeometry.distance(previous.latitude, previous.longitude, latitude, longitude) < 25)) return false
    while (attempts.isNotEmpty() && nowMs - attempts.first().at >= 300_000) attempts.removeFirst()
    if (attempts.size >= 3) return false
    val attempt = Attempt(nowMs, latitude, longitude)
    attempts.addLast(attempt)
    last = attempt
    return true
  }

  @Synchronized
  fun reset() { attempts.clear(); last = null }
}

object FixPolicy {
  fun problem(ageMs: Long, accuracyMeters: Double, hasAccuracy: Boolean, accuracyLimitMeters: Double,
    maximumAgeMs: Long = RoadGuidancePolicy.maximumFixAgeMillis): String? = when {
    ageMs < 0 || ageMs > maximumAgeMs -> "location-stale"
    !hasAccuracy || !accuracyMeters.isFinite() || accuracyMeters <= 0 || accuracyMeters > accuracyLimitMeters -> "location-inaccurate"
    else -> null
  }
}

/**
 * Start watchdog and guidance hysteresis for one session. Pure and clock-injected so the JVM tests
 * cover the same transitions the device runs. [T] is the platform fix retained for a reduced start.
 */
class FixAdmission<T>(private val policy: ModeFixPolicy, nowMs: Long, startedImmediately: Boolean = false) {
  enum class Outcome { ACCEPTED, RECOVERING, REJECTED, DEGRADED, DUPLICATE }
  /** [reducedPrecision]: accepted, but worse than the mode's normal guidance accuracy; shown, never hidden. */
  data class Result(val outcome: Outcome, val problem: String? = null, val reducedStart: Boolean = false,
    val reducedPrecision: Boolean = false)
  sealed interface Tick {
    /** Reduced start from the retained best fix. */
    data class ReducedStart<T>(val fix: T, val accuracyMeters: Double) : Tick
    /** Settled terminal waiting state; emitted once per wait. */
    data class StartTimeout(val problem: String, val bestRejectedAccuracyMeters: Double?) : Tick
    data class Degraded(val problem: String) : Tick
  }
  private data class Candidate<T>(val fix: T, val accuracy: Double, val capturedAtMs: Long, val ageMs: Long)

  var started = startedImmediately; private set
  /** Only an accepted guidance-quality fix makes the position usable. */
  var confident = false; private set
  var waitingSinceMs = nowMs; private set
  /** Distinct fresh samples seen during the current start wait. */
  var fixesSeen = 0; private set
  var duplicatesSkipped = 0; private set
  var bestRejectedAccuracyMeters: Double? = null; private set
  var startTimedOut = false; private set
  private var candidate: Candidate<T>? = null
  /** Consecutive distinct rejected guidance samples (diagnostics). */
  var consecutiveRejected = 0; private set
  private var consecutiveAccepted = 0
  private var lastAcceptedAtMs: Long? = null
  private var lastSampleNanos: Long? = null

  /**
   * [sampleElapsedNanos] is the fix's own monotonic sample time. A sample not newer than the last one
   * by the duplicate window (GPS and fused re-delivering one measurement, or an older interleaved
   * provider sample) is ignored before any counting: it can neither degrade nor complete recovery.
   */
  fun onFix(nowMs: Long, sampleElapsedNanos: Long, ageMs: Long, accuracyMeters: Double, hasAccuracy: Boolean, fix: T,
    implausible: Boolean = false): Result {
    val previous = lastSampleNanos
    if (previous != null && sampleElapsedNanos - previous < policy.duplicateSampleWindowMillis * 1_000_000L) {
      duplicatesSkipped++
      return Result(Outcome.DUPLICATE)
    }
    lastSampleNanos = sampleElapsedNanos
    val fresh = ageMs in 0..policy.maximumFixAgeMillis
    if (!started) {
      if (!fresh) return Result(Outcome.REJECTED, "location-stale")
      fixesSeen++
      val problem = if (implausible) "location-inaccurate" else FixPolicy.problem(ageMs, accuracyMeters, hasAccuracy, policy.startAccuracyMeters, policy.maximumFixAgeMillis)
      if (problem == null) return begin(nowMs, reduced = false, accuracyMeters)
      if (hasAccuracy && accuracyMeters.isFinite() && accuracyMeters > 0) {
        bestRejectedAccuracyMeters = minOf(bestRejectedAccuracyMeters ?: accuracyMeters, accuracyMeters)
        if (!implausible && accuracyMeters <= policy.reducedStartAccuracyMeters) {
          if (reducedStartDue(nowMs)) return begin(nowMs, reduced = true, accuracyMeters)
          val best = candidate
          if (best == null || accuracyMeters <= best.accuracy) candidate = Candidate(fix, accuracyMeters, nowMs, ageMs)
        }
      }
      return Result(Outcome.REJECTED, problem)
    }
    val problem = if (implausible) "location-inaccurate" else FixPolicy.problem(ageMs, accuracyMeters, hasAccuracy, policy.maximumGuidanceAccuracyMeters, policy.maximumFixAgeMillis)
    if (problem == null) {
      consecutiveRejected = 0
      lastAcceptedAtMs = nowMs
      val reduced = accuracyMeters > policy.normalGuidanceAccuracyMeters
      if (confident) return Result(Outcome.ACCEPTED, reducedPrecision = reduced)
      consecutiveAccepted++
      if (consecutiveAccepted < policy.recoverAfterAcceptedFixes) return Result(Outcome.RECOVERING, reducedPrecision = reduced)
      confident = true; consecutiveAccepted = 0
      return Result(Outcome.ACCEPTED, reducedPrecision = reduced)
    }
    consecutiveAccepted = 0
    consecutiveRejected++
    val last = lastAcceptedAtMs
    if (confident && (consecutiveRejected >= policy.degradeAfterRejectedFixes || (last != null && nowMs - last >= policy.degradeAfterMillis))) {
      confident = false
      return Result(Outcome.DEGRADED, problem)
    }
    return Result(Outcome.REJECTED, problem)
  }

  fun onTick(nowMs: Long): Tick? {
    if (!started) {
      val best = candidate
      if (best != null && reducedStartDue(nowMs)) {
        candidate = null
        if (best.ageMs + (nowMs - best.capturedAtMs) <= policy.maximumFixAgeMillis) {
          begin(nowMs, reduced = true, best.accuracy)
          return Tick.ReducedStart(best.fix, best.accuracy)
        }
      }
      if (!startTimedOut && nowMs - waitingSinceMs >= policy.startTimeoutMillis) {
        startTimedOut = true
        // Stale seeds never count as seen: no fresh fix means the device found no position at all.
        val problem = if (fixesSeen == 0) "location-unavailable" else "location-inaccurate"
        return Tick.StartTimeout(problem, bestRejectedAccuracyMeters)
      }
      return null
    }
    val last = lastAcceptedAtMs
    if (confident && last != null && nowMs - last >= policy.degradeAfterMillis) {
      confident = false; consecutiveRejected = 0
      return Tick.Degraded("location-stale")
    }
    return null
  }

  /**
   * External loss (permission, all providers disabled). Guidance pauses until the recovery count; a
   * retained reduced-start candidate is discarded, so only a fix received after positioning returns
   * can start the session.
   */
  fun lose() { confident = false; consecutiveAccepted = 0; candidate = null }

  /** Explicit Retry before any start fix or route: the start wait begins again. */
  fun restartWaiting(nowMs: Long) {
    started = false; confident = false; waitingSinceMs = nowMs; fixesSeen = 0
    bestRejectedAccuracyMeters = null; startTimedOut = false; candidate = null
    consecutiveRejected = 0; consecutiveAccepted = 0; lastAcceptedAtMs = null
  }

  private fun reducedStartDue(nowMs: Long) = nowMs - waitingSinceMs >= policy.reducedStartAfterMillis
  private fun begin(nowMs: Long, reduced: Boolean, accuracyMeters: Double): Result {
    started = true; confident = true; lastAcceptedAtMs = nowMs
    consecutiveRejected = 0; consecutiveAccepted = 0; candidate = null; startTimedOut = false
    return Result(Outcome.ACCEPTED, reducedStart = reduced, reducedPrecision = accuracyMeters > policy.normalGuidanceAccuracyMeters)
  }
}

/** Fences a Start/Resume command across its foreground wait: a Stop issued meanwhile wins. */
internal class StartFence {
  private val generation = java.util.concurrent.atomic.AtomicLong()
  fun invalidate() { generation.incrementAndGet() }
  /** Returns null when a Stop or a newer Start arrived while [wait] was suspended. */
  suspend fun <R> run(wait: suspend () -> Unit, start: suspend () -> R): R? {
    val token = generation.incrementAndGet()
    wait()
    if (token != generation.get()) return null
    return start()
  }
}

internal object NavigationGeometry {
  fun valid(latitude: Double, longitude: Double) = latitude.isFinite() && longitude.isFinite() &&
    latitude in -90.0..90.0 && longitude in -180.0..180.0

  fun distance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val latDelta = Math.toRadians(lat2 - lat1)
    val lonDelta = Math.toRadians(lon2 - lon1)
    val a = sin(latDelta / 2).pow(2) + cos(Math.toRadians(lat1)) *
      cos(Math.toRadians(lat2)) * sin(lonDelta / 2).pow(2)
    return 6_371_000 * 2 * asin(sqrt(a.coerceIn(0.0, 1.0)))
  }
}
