package quest.avoid.maps.navigation

import org.json.JSONObject
import uniffi.ferrostar.CourseFiltering
import uniffi.ferrostar.NavigationControllerConfig
import uniffi.ferrostar.RouteDeviationTracking
import uniffi.ferrostar.WaypointAdvanceMode
import uniffi.ferrostar.stepAdvanceDistanceEntryAndSnappedExit
import uniffi.ferrostar.stepAdvanceDistanceToEndOfStep

/** Per-mode fix admission limits. All values come from the single packaged policy. */
data class ModeFixPolicy(
  val mode: String,
  val maximumFixAgeMillis: Long,
  val startAccuracyMeters: Double,
  val guidanceAccuracyMeters: Double,
  /** Walking only: after [reducedStartAfterMillis] without a start fix, start from the best fix within this bound. */
  val reducedStartAccuracyMeters: Double?,
  val reducedStartAfterMillis: Long?,
  val recoverAfterAcceptedFixes: Int,
  val degradeAfterRejectedFixes: Int,
  val degradeAfterMillis: Long,
  val startTimeoutMillis: Long,
)

/** The packaged policy is also replayed against the pinned Rust core by tests/navigation-core. */
internal object RoadGuidancePolicy {
  private val policy = JSONObject(BuildConfig.ROAD_GUIDANCE_POLICY)
  val maximumFixAgeMillis = policy.getLong("maximumFixAgeMillis")
  val arrivalRadiusMeters = policy.getInt("arrivalRadiusMeters").toUShort()
  private val fixPolicies = listOf("walk", "bicycle", "car", "transit").associateWith { mode ->
    val selected = policy.getJSONObject(mode)
    ModeFixPolicy(
      mode = mode,
      maximumFixAgeMillis = maximumFixAgeMillis,
      startAccuracyMeters = selected.getDouble("startAccuracyMeters"),
      guidanceAccuracyMeters = selected.getDouble("guidanceAccuracyMeters"),
      reducedStartAccuracyMeters = if (selected.has("reducedStartAccuracyMeters")) selected.getDouble("reducedStartAccuracyMeters") else null,
      reducedStartAfterMillis = if (selected.has("reducedStartAfterMillis")) selected.getLong("reducedStartAfterMillis") else null,
      recoverAfterAcceptedFixes = selected.getInt("recoverAfterAcceptedFixes"),
      degradeAfterRejectedFixes = policy.getInt("degradeAfterRejectedFixes"),
      degradeAfterMillis = policy.getLong("degradeAfterMillis"),
      startTimeoutMillis = policy.getLong("startTimeoutMillis"),
    )
  }

  fun fix(mode: String): ModeFixPolicy = requireNotNull(fixPolicies[mode]) { "Unsupported mode" }

  fun controllerConfig(mode: String): NavigationControllerConfig {
    val selected = policy.getJSONObject(mode)
    val entry = selected.getInt("entryRadiusMeters").toUShort()
    val exit = selected.getInt("exitDistanceMeters").toUShort()
    // Step advance and arrival evaluate every fix the session accepts for guidance.
    val guidance = selected.getInt("guidanceAccuracyMeters").toUShort()
    // Deviation is only judged on tighter fixes; the runtime additionally requires consecutive off-route fixes.
    val deviation = selected.getInt("deviationAccuracyMeters").toUShort()
    // Snapped exit handles lateral offset and caps its distance to the upcoming step length,
    // allowing short final steps to complete without requiring travel past the destination.
    require(selected.getString("strategy") == "entry-snapped-exit")
    val advance = stepAdvanceDistanceEntryAndSnappedExit(entry, exit, guidance)
    return NavigationControllerConfig(
      WaypointAdvanceMode.WaypointWithinRange(arrivalRadiusMeters.toDouble()), advance,
      stepAdvanceDistanceToEndOfStep(arrivalRadiusMeters, guidance),
      RouteDeviationTracking.StaticThreshold(deviation, selected.getDouble("maximumRouteDeviationMeters")),
      CourseFiltering.SNAP_TO_ROUTE,
    )
  }
}
