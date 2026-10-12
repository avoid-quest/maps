package quest.avoid.maps.navigation

import org.json.JSONObject
import uniffi.ferrostar.CourseFiltering
import uniffi.ferrostar.NavigationControllerConfig
import uniffi.ferrostar.RouteDeviationTracking
import uniffi.ferrostar.WaypointAdvanceMode
import uniffi.ferrostar.stepAdvanceDistanceEntryAndSnappedExit
import uniffi.ferrostar.stepAdvanceDistanceToEndOfStep

/** The packaged policy is also replayed against the pinned Rust core by tests/navigation-core. */
internal object RoadGuidancePolicy {
  private val policy = JSONObject(BuildConfig.ROAD_GUIDANCE_POLICY)
  val maximumFixAgeMillis = policy.getLong("maximumFixAgeMillis")
  val maximumHorizontalAccuracyMeters = policy.getInt("maximumHorizontalAccuracyMeters").toUShort()
  val arrivalRadiusMeters = policy.getInt("arrivalRadiusMeters").toUShort()

  fun controllerConfig(mode: String): NavigationControllerConfig {
    val selected = policy.getJSONObject(mode)
    val entry = selected.getInt("entryRadiusMeters").toUShort()
    val exit = selected.getInt("exitDistanceMeters").toUShort()
    // Snapped exit handles lateral offset and caps its distance to the upcoming step length,
    // allowing short final steps to complete without requiring travel past the destination.
    require(selected.getString("strategy") == "entry-snapped-exit")
    val advance = stepAdvanceDistanceEntryAndSnappedExit(entry, exit, maximumHorizontalAccuracyMeters)
    return NavigationControllerConfig(
      WaypointAdvanceMode.WaypointWithinRange(arrivalRadiusMeters.toDouble()), advance,
      stepAdvanceDistanceToEndOfStep(arrivalRadiusMeters, maximumHorizontalAccuracyMeters),
      RouteDeviationTracking.StaticThreshold(maximumHorizontalAccuracyMeters, policy.getDouble("maximumRouteDeviationMeters")),
      CourseFiltering.SNAP_TO_ROUTE,
    )
  }
}
