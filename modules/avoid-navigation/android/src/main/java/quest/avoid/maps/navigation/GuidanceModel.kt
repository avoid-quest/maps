package quest.avoid.maps.navigation

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToInt
import org.json.JSONObject
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.RouteStep

/**
 * Raw OSRM maneuver facts for one route step. Ferrostar 0.57's public route keeps the step geometry,
 * distance and our Italian text, but the adapter empties its visual instructions, so the maneuver
 * type, modifier and roundabout exit come from the provider response itself — never from parsing
 * Italian prose back into types.
 */
internal data class ManeuverFacts(
  val type: String,
  val modifier: String?,
  val exit: Int?,
  val name: String?,
  val ref: String?,
  val latitude: Double,
  val longitude: Double,
  val bearingBefore: Int?,
  val bearingAfter: Int?,
  val drivingSide: String?,
) {
  companion object {
    /** One entry per OSRM step across every leg, in route order (the same order Ferrostar uses). */
    fun parse(responseJson: String): List<ManeuverFacts> {
      val legs = JSONObject(responseJson).getJSONArray("routes").getJSONObject(0).getJSONArray("legs")
      return (0 until legs.length()).flatMap { leg ->
        val steps = legs.getJSONObject(leg).getJSONArray("steps")
        (0 until steps.length()).map { from(steps.getJSONObject(it)) }
      }
    }

    fun from(step: JSONObject): ManeuverFacts {
      val maneuver = step.optJSONObject("maneuver") ?: JSONObject()
      val location = maneuver.optJSONArray("location")
      val longitude = location?.optDouble(0, Double.NaN) ?: Double.NaN
      val latitude = location?.optDouble(1, Double.NaN) ?: Double.NaN
      fun bearing(key: String) = if (maneuver.has(key)) maneuver.optInt(key, -1).takeIf { it in 0..360 } else null
      return ManeuverFacts(
        type = text(maneuver.optString("type"), 32) ?: "unknown",
        modifier = text(maneuver.optString("modifier"), 32)?.takeIf { it in MODIFIERS },
        exit = if (maneuver.has("exit")) maneuver.optInt("exit", 0).takeIf { it in 1..99 } else null,
        name = text(step.optString("name"), 160),
        ref = text(step.optString("ref"), 40),
        latitude = latitude, longitude = longitude,
        bearingBefore = bearing("bearing_before"), bearingAfter = bearing("bearing_after"),
        drivingSide = text(step.optString("driving_side"), 8)?.takeIf { it == "left" || it == "right" },
      )
    }

    private val MODIFIERS = setOf("uturn", "sharp right", "right", "slight right", "straight", "slight left", "left", "sharp left")
    private fun text(value: String?, limit: Int) = value?.replace(Regex("[\\p{Cntrl}\\s]+"), " ")?.trim()?.take(limit)?.takeIf { it.isNotEmpty() }
  }
}

/**
 * Immutable per-route index: cumulative distance along the route geometry the interface renders and
 * the route-geometry index of every maneuver. Progress is measured on exactly the bridged geometry,
 * so the traveled/remaining split drawn on the map matches the snapped position.
 */
internal class RouteGuideIndex(private val geometry: List<GeographicCoordinate>, steps: List<RouteStep>, facts: List<ManeuverFacts>) {
  val cumulative: DoubleArray = DoubleArray(geometry.size).also { sums ->
    for (i in 1 until geometry.size) sums[i] = sums[i - 1] + distance(geometry[i - 1], geometry[i])
  }
  val length: Double get() = cumulative.lastOrNull() ?: 0.0
  /** Route-geometry index of the point where step k's maneuver happens (its first point). */
  val maneuverIndex: IntArray

  init {
    require(geometry.size >= 2 && steps.isNotEmpty())
    val indexes = IntArray(steps.size)
    var from = 0
    steps.forEachIndexed { k, step ->
      val fact = facts.getOrNull(k)
      val target = step.geometry.firstOrNull()
        ?: fact?.takeIf { NavigationGeometry.valid(it.latitude, it.longitude) }?.let { GeographicCoordinate(it.latitude, it.longitude) }
      // Maneuvers advance monotonically; a U-turn folds the line back over itself, so search
      // forward from the previous maneuver and stop at the first exact (or nearest) match.
      indexes[k] = if (k == 0) 0 else if (target == null) from else nearestForward(target, from)
      from = indexes[k]
    }
    maneuverIndex = indexes
  }

  private fun nearestForward(target: GeographicCoordinate, from: Int): Int {
    var best = from
    var bestDistance = Double.MAX_VALUE
    for (i in from until geometry.size) {
      val d = distance(geometry[i], target)
      if (d < 0.05) return i
      if (d < bestDistance) { bestDistance = d; best = i }
    }
    return best
  }

  data class Progress(val traveledMeters: Double, val segmentIndex: Int)

  /**
   * Projects [position] onto the route between the current step's maneuver and the next maneuver
   * (a bounded window, so a later stretch of a looping or U-turn route never captures it).
   */
  fun progress(currentStep: Int, position: GeographicCoordinate): Progress {
    val start = maneuverIndex.getOrElse(currentStep) { 0 }.coerceIn(0, geometry.size - 2)
    val end = (maneuverIndex.getOrNull(currentStep + 1) ?: (geometry.size - 1)).coerceIn(start + 1, geometry.size - 1)
    var bestSegment = start
    var bestFraction = 0.0
    var bestDistance = Double.MAX_VALUE
    for (i in start until end) {
      val (fraction, d) = project(geometry[i], geometry[i + 1], position)
      if (d < bestDistance) { bestDistance = d; bestSegment = i; bestFraction = fraction }
    }
    val segmentLength = cumulative[bestSegment + 1] - cumulative[bestSegment]
    return Progress(cumulative[bestSegment] + bestFraction * segmentLength, bestSegment)
  }

  companion object {
    fun distance(a: GeographicCoordinate, b: GeographicCoordinate) = NavigationGeometry.distance(a.lat, a.lng, b.lat, b.lng)

    /** Local equirectangular projection of [p] on segment a–b: (fraction along, distance in metres). */
    fun project(a: GeographicCoordinate, b: GeographicCoordinate, p: GeographicCoordinate): Pair<Double, Double> {
      val k = cos(Math.toRadians(a.lat))
      val ax = 0.0; val ay = 0.0
      val bx = (b.lng - a.lng) * k; val by = b.lat - a.lat
      val px = (p.lng - a.lng) * k; val py = p.lat - a.lat
      val length2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay)
      val t = if (length2 <= 0.0) 0.0 else (((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length2).coerceIn(0.0, 1.0)
      val qx = ax + t * (bx - ax); val qy = ay + t * (by - ay)
      val metres = Math.hypot(px - qx, py - qy) * 111_195.0
      return t to metres
    }
  }
}

/**
 * Structured snapshot fields for the interface: the upcoming and following maneuvers (stable ids
 * tied to the route revision), the route-relative progress and Ferrostar's snapped position. Pure,
 * so the JVM tests cover it with deterministic fixtures; native values never contain null or NaN.
 */
internal object GuidanceFields {
  /** Ids are `<routeRevision>:<step index>`; a reroute changes every id. */
  fun maneuverId(routeRevision: Long, index: Int) = "$routeRevision:$index"

  fun build(
    routeRevision: Long,
    index: RouteGuideIndex,
    steps: List<RouteStep>,
    facts: List<ManeuverFacts>,
    remainingSteps: Int,
    snapped: GeographicCoordinate?,
    alignment: String,
  ): Map<String, Any> {
    val fields = mutableMapOf<String, Any>()
    // Ferrostar drops completed steps from the front; the current step is remainingSteps[0].
    val current = (steps.size - remainingSteps).coerceIn(0, steps.size - 1)
    val upcoming = current + 1
    maneuver(routeRevision, index, steps, facts, upcoming)?.let { fields["upcomingManeuver"] = it }
    maneuver(routeRevision, index, steps, facts, upcoming + 1)?.let { following ->
      // Distance/time between the two maneuvers: the whole upcoming step.
      val between = steps[upcoming]
      fields["followingManeuver"] = following + mapOf(
        "afterUpcomingMeters" to finite(between.distance), "afterUpcomingSeconds" to finite(between.duration),
      )
    }
    if (snapped != null && NavigationGeometry.valid(snapped.lat, snapped.lng)) {
      val progress = index.progress(current, snapped)
      fields["routeProgress"] = mapOf(
        "traveledMeters" to round(progress.traveledMeters), "routeLengthMeters" to round(index.length),
        "segmentIndex" to progress.segmentIndex, "stepIndex" to current,
      )
      fields["snappedLocation"] = mapOf("latitude" to snapped.lat, "longitude" to snapped.lng)
    }
    fields["alignment"] = alignment
    return fields
  }

  private fun maneuver(routeRevision: Long, index: RouteGuideIndex, steps: List<RouteStep>, facts: List<ManeuverFacts>, k: Int): Map<String, Any>? {
    val step = steps.getOrNull(k) ?: return null
    val fact = facts.getOrNull(k)
    val geometryIndex = index.maneuverIndex.getOrElse(k) { 0 }
    val point = step.geometry.firstOrNull()
    val result = mutableMapOf<String, Any>(
      "id" to maneuverId(routeRevision, k), "stepIndex" to k, "geometryIndex" to geometryIndex,
      "type" to (fact?.type ?: "unknown"), "instruction" to step.instruction,
    )
    val latitude = fact?.latitude?.takeIf { it.isFinite() } ?: point?.lat
    val longitude = fact?.longitude?.takeIf { it.isFinite() } ?: point?.lng
    if (latitude != null && longitude != null && NavigationGeometry.valid(latitude, longitude)) {
      result["latitude"] = latitude; result["longitude"] = longitude
    }
    fact?.modifier?.let { result["modifier"] = it }
    fact?.exit?.let { result["exit"] = it }
    (fact?.name ?: step.roadName?.takeIf { it.isNotBlank() })?.let { result["name"] = it }
    fact?.ref?.let { result["ref"] = it }
    fact?.bearingBefore?.let { result["bearingBefore"] = it }
    fact?.bearingAfter?.let { result["bearingAfter"] = it }
    fact?.drivingSide?.let { result["drivingSide"] = it }
    return result
  }

  private fun finite(value: Double) = if (value.isFinite() && value >= 0) round(value) else 0.0
  private fun round(value: Double) = (value * 10).roundToInt() / 10.0
}

/** How credible Ferrostar's snapped position is for drawing the puck on the route. */
internal object Alignment {
  const val ALIGNED = "aligned"
  const val DEVIATING = "deviating"
  /** The fix was too coarse to judge deviation, or no route is installed. */
  const val UNKNOWN = "unknown"
  fun of(judged: Boolean, offRoute: Boolean, deviation: Boolean): String = when {
    offRoute || (judged && deviation) -> DEVIATING
    judged -> ALIGNED
    else -> UNKNOWN
  }
}

/** Fix kinematics for the camera: never NaN or negative; absent values are omitted. */
internal object FixKinematics {
  fun fields(
    speed: Float?, speedAccuracy: Float?, course: Float?, courseAccuracy: Float?, elapsedRealtimeNanos: Long,
  ): Map<String, Any> = buildMap {
    speed?.takeIf { it.isFinite() && it >= 0f }?.let { put("speedMps", (it * 100).roundToInt() / 100.0) }
    speedAccuracy?.takeIf { it.isFinite() && it > 0f }?.let { put("speedAccuracyMps", (it * 100).roundToInt() / 100.0) }
    course?.takeIf { it.isFinite() }?.let { put("course", (((it.toDouble() % 360 + 360) % 360) * 10).roundToInt().rem(3600) / 10.0) }
    courseAccuracy?.takeIf { it.isFinite() && it > 0f }?.let { put("courseAccuracyDegrees", abs(it).toDouble()) }
    if (elapsedRealtimeNanos > 0) put("elapsedMs", elapsedRealtimeNanos / 1_000_000L)
  }
}
