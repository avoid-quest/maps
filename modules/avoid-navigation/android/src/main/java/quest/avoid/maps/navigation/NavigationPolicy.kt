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
  fun problem(ageMs: Long, accuracyMeters: Double, hasAccuracy: Boolean): String? = when {
    ageMs < 0 || ageMs > 10_000 -> "location-stale"
    !hasAccuracy || !accuracyMeters.isFinite() || accuracyMeters <= 0 || accuracyMeters > 35 -> "location-inaccurate"
    else -> null
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
