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
  enum class Outcome { ACCEPTED, RECOVERING, REJECTED, DEGRADED }
  data class Result(val outcome: Outcome, val problem: String? = null, val reducedStart: Boolean = false)
  sealed interface Tick {
    /** Walking reduced start from the retained best fix. */
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
  var fixesSeen = 0; private set
  var bestRejectedAccuracyMeters: Double? = null; private set
  var startTimedOut = false; private set
  private var candidate: Candidate<T>? = null
  private var consecutiveRejected = 0
  private var consecutiveAccepted = 0
  private var lastAcceptedAtMs: Long? = null

  fun onFix(nowMs: Long, ageMs: Long, accuracyMeters: Double, hasAccuracy: Boolean, fix: T, implausible: Boolean = false): Result {
    val fresh = ageMs in 0..policy.maximumFixAgeMillis
    if (!started) {
      if (!fresh) return Result(Outcome.REJECTED, "location-stale")
      fixesSeen++
      val problem = if (implausible) "location-inaccurate" else FixPolicy.problem(ageMs, accuracyMeters, hasAccuracy, policy.startAccuracyMeters, policy.maximumFixAgeMillis)
      if (problem == null) return begin(nowMs, reduced = false)
      if (hasAccuracy && accuracyMeters.isFinite() && accuracyMeters > 0) {
        bestRejectedAccuracyMeters = minOf(bestRejectedAccuracyMeters ?: accuracyMeters, accuracyMeters)
        val reducedLimit = policy.reducedStartAccuracyMeters
        if (!implausible && reducedLimit != null && accuracyMeters <= reducedLimit) {
          if (reducedStartDue(nowMs)) return begin(nowMs, reduced = true)
          val best = candidate
          if (best == null || accuracyMeters <= best.accuracy) candidate = Candidate(fix, accuracyMeters, nowMs, ageMs)
        }
      }
      return Result(Outcome.REJECTED, problem)
    }
    val problem = if (implausible) "location-inaccurate" else FixPolicy.problem(ageMs, accuracyMeters, hasAccuracy, policy.guidanceAccuracyMeters, policy.maximumFixAgeMillis)
    if (problem == null) {
      consecutiveRejected = 0
      lastAcceptedAtMs = nowMs
      if (confident) return Result(Outcome.ACCEPTED)
      consecutiveAccepted++
      if (consecutiveAccepted < policy.recoverAfterAcceptedFixes) return Result(Outcome.RECOVERING)
      confident = true; consecutiveAccepted = 0
      return Result(Outcome.ACCEPTED)
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
          begin(nowMs, reduced = true)
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

  /** External loss (permission, provider disabled): guidance pauses until the policy's recovery count. */
  fun lose() { confident = false; consecutiveAccepted = 0 }

  /** Explicit Retry before any start fix or route: the start wait begins again. */
  fun restartWaiting(nowMs: Long) {
    started = false; confident = false; waitingSinceMs = nowMs; fixesSeen = 0
    bestRejectedAccuracyMeters = null; startTimedOut = false; candidate = null
    consecutiveRejected = 0; consecutiveAccepted = 0; lastAcceptedAtMs = null
  }

  private fun reducedStartDue(nowMs: Long): Boolean {
    val after = policy.reducedStartAfterMillis ?: return false
    return policy.reducedStartAccuracyMeters != null && nowMs - waitingSinceMs >= after
  }
  private fun begin(nowMs: Long, reduced: Boolean): Result {
    started = true; confident = true; lastAcceptedAtMs = nowMs
    consecutiveRejected = 0; consecutiveAccepted = 0; candidate = null; startTimedOut = false
    return Result(Outcome.ACCEPTED, reducedStart = reduced)
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
