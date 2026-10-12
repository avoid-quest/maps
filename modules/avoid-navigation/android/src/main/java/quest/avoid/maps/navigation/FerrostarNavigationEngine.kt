package quest.avoid.maps.navigation

import android.location.Location
import java.time.Instant
import uniffi.ferrostar.CourseOverGround
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.NavState
import uniffi.ferrostar.NavigationControllerConfig
import uniffi.ferrostar.NavigationSession
import uniffi.ferrostar.Route
import uniffi.ferrostar.TripState
import uniffi.ferrostar.UserLocation
import uniffi.ferrostar.createNavigationSession

/** Pure navigation core; Android owns lifecycle, fixes, network and speech. No SDK auto-rerouting. */
internal class FerrostarNavigationEngine(responseJson: String, mode: String, firstFix: Location) : AutoCloseable {
  val route: Route
  private val config: NavigationControllerConfig
  private val session: NavigationSession
  private var state: NavState
  init {
    route = FerrostarRouteParser.parse(responseJson, mode)
    config = RoadGuidancePolicy.controllerConfig(mode)
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
