package quest.avoid.maps.navigation

import org.json.JSONException
import uniffi.ferrostar.Disposable
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
      val parsed = try {
        parser.parseResponse(responseJson.toByteArray(Charsets.UTF_8)).firstOrNull()
      } catch (_: ParsingException) { throw NavigationFailure("invalid") }
        ?: throw NavigationFailure("invalid")
      if (parsed.geometry.size !in 2..100_000 || parsed.steps.size !in 2..5_000) throw NavigationFailure("invalid")
      if (!(parsed.distance.isFinite() && parsed.distance >= 0 && parsed.steps.all {
        it.distance.isFinite() && it.distance >= 0 && it.duration.isFinite() && it.duration >= 0
      })) throw NavigationFailure("invalid")
      if (!parsed.geometry.all { it.lat.isFinite() && it.lng.isFinite() && it.lat in -90.0..90.0 && it.lng in -180.0..180.0 }) throw NavigationFailure("invalid")
      try { ItalianManeuvers.adapt(parsed, responseJson, mode) }
      catch (_: JSONException) { throw NavigationFailure("invalid") }
      catch (_: IllegalArgumentException) { throw NavigationFailure("invalid") }
    }
  }
}
