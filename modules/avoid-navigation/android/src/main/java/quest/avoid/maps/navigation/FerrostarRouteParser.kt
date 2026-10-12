package quest.avoid.maps.navigation

import org.json.JSONException
import org.json.JSONObject
import uniffi.ferrostar.Disposable
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.ParsingException
import uniffi.ferrostar.Route
import uniffi.ferrostar.RouteResponseParser
import uniffi.ferrostar.createOsrmResponseParser

internal object FerrostarRouteParser {
  fun parse(responseJson: String, mode: String, parserFactory: () -> RouteResponseParser = { createOsrmResponseParser(6u) }): Route {
    require(mode in setOf("walk", "bicycle", "car")) { "Unsupported road mode" }
    // Loading the native parser is an engine failure, not invalid provider data.
    val parser = parserFactory()
    // use preserves the primary failure (including cancellation) if native cleanup also fails.
    return AutoCloseable { (parser as Disposable).destroy() }.use {
      // Ferrostar 0.57.0 subtracts one from each decoded step's point count. Reject empty
      // encoded geometry before that native call, including every supplied alternative.
      try { validateRawSteps(responseJson) }
      catch (_: JSONException) { throw NavigationFailure("invalid") }
      val parsed = try {
        parser.parseResponse(responseJson.toByteArray(Charsets.UTF_8)).firstOrNull()
      } catch (_: ParsingException) { throw NavigationFailure("invalid") }
        ?: throw NavigationFailure("invalid")
      if (parsed.geometry.size !in 2..MAX_GEOMETRY_POINTS || parsed.steps.size !in 2..MAX_STEPS) throw NavigationFailure("invalid")
      if (!(parsed.distance.isFinite() && parsed.distance >= 0 && parsed.steps.all {
        it.distance.isFinite() && it.distance >= 0 && it.duration.isFinite() && it.duration >= 0
      })) throw NavigationFailure("invalid")
      if (!parsed.geometry.all(::validCoordinate)) throw NavigationFailure("invalid")
      var stepPoints = 0
      for (step in parsed.steps) {
        if (step.geometry.size !in 1..MAX_GEOMETRY_POINTS || !step.geometry.all(::validCoordinate)) throw NavigationFailure("invalid")
        stepPoints += step.geometry.size
        // Adjacent steps repeat their shared endpoint; arrival may repeat its final point.
        if (stepPoints > MAX_GEOMETRY_POINTS + MAX_STEPS) throw NavigationFailure("invalid")
      }
      try { ItalianManeuvers.adapt(parsed, responseJson, mode) }
      catch (_: JSONException) { throw NavigationFailure("invalid") }
      catch (_: IllegalArgumentException) { throw NavigationFailure("invalid") }
    }
  }

  private fun validateRawSteps(responseJson: String) {
    val routes = JSONObject(responseJson).getJSONArray("routes")
    for (routeIndex in 0 until routes.length()) {
      val legs = routes.getJSONObject(routeIndex).getJSONArray("legs")
      for (legIndex in 0 until legs.length()) {
        val steps = legs.getJSONObject(legIndex).getJSONArray("steps")
        for (stepIndex in 0 until steps.length()) {
          if (steps.getJSONObject(stepIndex).getString("geometry").isEmpty()) throw NavigationFailure("invalid")
        }
      }
    }
  }

  private fun validCoordinate(point: GeographicCoordinate) =
    point.lat.isFinite() && point.lng.isFinite() && point.lat in -90.0..90.0 && point.lng in -180.0..180.0

  private const val MAX_GEOMETRY_POINTS = 100_000
  private const val MAX_STEPS = 5_000
}
