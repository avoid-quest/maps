package quest.avoid.maps.navigation

import android.location.Location
import java.time.Instant
import uniffi.ferrostar.CourseFiltering
import uniffi.ferrostar.CourseOverGround
import uniffi.ferrostar.Disposable
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.NavState
import uniffi.ferrostar.NavigationControllerConfig
import uniffi.ferrostar.NavigationSession
import uniffi.ferrostar.Route
import uniffi.ferrostar.RouteDeviationTracking
import uniffi.ferrostar.TripState
import uniffi.ferrostar.UserLocation
import uniffi.ferrostar.WaypointAdvanceMode
import uniffi.ferrostar.createNavigationSession
import uniffi.ferrostar.createOsrmResponseParser
import uniffi.ferrostar.stepAdvanceDistanceToEndOfStep

/** Pure navigation core; Android owns lifecycle, fixes, network and speech. No SDK auto-rerouting. */
internal class FerrostarNavigationEngine(responseJson: String, mode: String, firstFix: Location) : AutoCloseable {
  val route: Route
  private val config: NavigationControllerConfig
  private val session: NavigationSession
  private var state: NavState
  init {
    val parser = createOsrmResponseParser(6u)
    try {
      val parsed = parser.parseResponse(responseJson.toByteArray()).firstOrNull() ?: throw NavigationFailure("invalid")
      require(parsed.geometry.size in 2..100_000 && parsed.steps.size in 2..5_000)
      require(parsed.distance.isFinite() && parsed.distance >= 0 && parsed.steps.all {
        it.distance.isFinite() && it.distance >= 0 && it.duration.isFinite() && it.duration >= 0
      })
      require(parsed.geometry.all { it.lat.isFinite() && it.lng.isFinite() && it.lat in -90.0..90.0 && it.lng in -180.0..180.0 })
      route = ItalianManeuvers.adapt(parsed, responseJson, mode)
    } finally { (parser as Disposable).destroy() }
    config = NavigationControllerConfig(
      WaypointAdvanceMode.WaypointWithinRange(10.0),
      stepAdvanceDistanceToEndOfStep(5u, 20u),
      stepAdvanceDistanceToEndOfStep(5u, 10u),
      RouteDeviationTracking.StaticThreshold(20u, 45.0),
      CourseFiltering.SNAP_TO_ROUTE,
    )
    try {
      session = createNavigationSession(route, config, emptyList())
      try { state = session.getInitialState(firstFix.userLocation()) }
      catch (error: Throwable) { session.destroy(); throw error }
    } catch (error: Throwable) { config.destroy(); throw error }
  }
  fun update(fix: Location): TripState {
    val old = state
    state = session.updateUserLocation(fix.userLocation(), old)
    old.destroy()
    return state.tripState
  }
  override fun close() { try { state.destroy() } finally { try { session.destroy() } finally { config.destroy() } } }
  private fun Location.userLocation() = UserLocation(
    GeographicCoordinate(latitude, longitude), accuracy.toDouble(),
    if (hasBearing() && bearing.isFinite() && hasSpeed() && speed.isFinite() && speed >= 1f) CourseOverGround(bearing.toInt().toUShort(), null) else null,
    Instant.ofEpochMilli(time), null,
  )
}
