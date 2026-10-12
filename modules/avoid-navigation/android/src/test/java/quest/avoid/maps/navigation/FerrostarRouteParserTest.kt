package quest.avoid.maps.navigation

import java.util.concurrent.CancellationException
import org.junit.Assert.*
import org.junit.Test
import uniffi.ferrostar.BoundingBox
import uniffi.ferrostar.Disposable
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.ParsingException
import uniffi.ferrostar.Route
import uniffi.ferrostar.RouteResponseParser
import uniffi.ferrostar.RouteStep

class FerrostarRouteParserTest {
  @Test fun `declared native parser failures become retryable invalid responses and release the parser`() {
    val cases = listOf(
      "<html>Temporarily unavailable</html>" to ParsingException.InvalidRouteObject("not JSON"),
      "{\"code\":\"Ok\",\"routes\":[" to ParsingException.InvalidRouteObject("truncated JSON"),
      "{\"code\":\"Ok\",\"routes\":{}}" to ParsingException.InvalidGeometry("changed geometry"),
      "{\"code\":\"NoRoute\"}" to ParsingException.InvalidStatusCode("NoRoute", "No route"),
      response to ParsingException.MalformedAnnotations("changed annotations"),
    )
    cases.forEach { (body, error) ->
      val parser = FakeParser { bytes ->
        assertEquals(body, bytes.toString(Charsets.UTF_8))
        throw error
      }
      invalid(body, parser)
    }
  }

  @Test fun `invalid route bounds coordinates and metrics remain retryable`() {
    val route = route()
    val step = route.steps.first()
    val cases = listOf(
      emptyList(),
      listOf(route.copy(geometry = emptyList())),
      listOf(route.copy(geometry = List(100_001) { route.geometry.first() })),
      listOf(route.copy(steps = listOf(step))),
      listOf(route.copy(steps = List(5_001) { step })),
      listOf(route.copy(distance = Double.NaN)),
      listOf(route.copy(distance = -1.0)),
      listOf(route.copy(geometry = listOf(GeographicCoordinate(91.0, 7.0), route.geometry.last()))),
      listOf(route.copy(geometry = listOf(GeographicCoordinate(45.0, Double.NaN), route.geometry.last()))),
      listOf(route.copy(steps = listOf(step.copy(distance = Double.POSITIVE_INFINITY), route.steps.last()))),
      listOf(route.copy(steps = listOf(step.copy(duration = -1.0), route.steps.last()))),
    )
    cases.forEach { routes -> invalid(response, FakeParser { routes }) }
  }

  @Test fun `malformed or mismatched Italian maneuver data remains retryable`() {
    val bodies = listOf(
      "<html>Temporarily unavailable</html>",
      "{\"code\":\"Ok\",\"routes\":[",
      "{\"code\":\"NoRoute\"}",
      "{\"code\":\"Ok\",\"routes\":[{\"legs\":{}}]}",
      "{\"code\":\"Ok\",\"routes\":[{\"legs\":[{\"steps\":[]}]}]}",
    )
    bodies.forEach { body -> invalid(body, FakeParser { listOf(route()) }) }
  }

  @Test fun `valid route gains Italian instructions and releases the parser`() {
    val original = route()
    val parser = FakeParser { listOf(original) }
    val parsed = FerrostarRouteParser.parse(response, "walk") { parser }
    assertEquals(listOf("Parti", "Raggiungi la destinazione"), parsed.steps.map { it.instruction })
    assertEquals(original.geometry, parsed.geometry)
    assertEquals(1, parser.destroyCalls)
  }

  @Test fun `native load and parser construction failures keep their fatal classification`() {
    listOf(UnsatisfiedLinkError("unavailable native library"), IllegalStateException("initialization failed")).forEach { failure ->
      val thrown = assertThrows(failure.javaClass) { FerrostarRouteParser.parse(response, "walk") { throw failure } }
      assertSame(failure, thrown)
    }
  }

  @Test fun `unexpected parser failures remain fatal and still release the parser`() {
    listOf(UnsatisfiedLinkError("native bridge failed"), IllegalArgumentException("native call failed")).forEach { failure ->
      val parser = FakeParser { throw failure }
      val thrown = assertThrows(failure.javaClass) { FerrostarRouteParser.parse(response, "walk") { parser } }
      assertSame(failure, thrown)
      assertEquals(1, parser.destroyCalls)
    }
  }

  @Test fun `cancellation remains cancellation even when parser cleanup fails`() {
    val cancellation = CancellationException("cancelled")
    val cleanupFailure = IllegalStateException("cleanup failed")
    val parser = FakeParser(cleanupFailure) { throw cancellation }
    val thrown = assertThrows(CancellationException::class.java) { FerrostarRouteParser.parse(response, "walk") { parser } }
    assertSame(cancellation, thrown)
    assertEquals(listOf(cleanupFailure), thrown.suppressed.toList())
    assertEquals(1, parser.destroyCalls)
  }

  @Test fun `unsupported mode is a configuration error before creating a parser`() {
    var factoryCalls = 0
    assertThrows(IllegalArgumentException::class.java) {
      FerrostarRouteParser.parse(response, "transit") { factoryCalls++; FakeParser { listOf(route()) } }
    }
    assertEquals(0, factoryCalls)
  }

  @Test fun `successful parsing does not hide a native cleanup failure`() {
    val failure = IllegalStateException("cleanup failed")
    val parser = FakeParser(failure) { listOf(route()) }
    assertSame(failure, assertThrows(IllegalStateException::class.java) { FerrostarRouteParser.parse(response, "walk") { parser } })
    assertEquals(1, parser.destroyCalls)
  }

  private fun invalid(body: String, parser: FakeParser) {
    val failure = assertThrows(NavigationFailure::class.java) { FerrostarRouteParser.parse(body, "walk") { parser } }
    assertEquals("invalid", failure.reason)
    assertEquals(1, parser.destroyCalls)
  }

  private class FakeParser(
    private val cleanupFailure: Throwable? = null,
    private val parse: (ByteArray) -> List<Route>,
  ) : RouteResponseParser, Disposable {
    var destroyCalls = 0
    override fun parseResponse(response: ByteArray): List<Route> = parse(response)
    override fun destroy() { destroyCalls++; cleanupFailure?.let { throw it } }
  }

  private fun route(): Route {
    val start = GeographicCoordinate(45.0, 7.0)
    val end = GeographicCoordinate(45.001, 7.001)
    val steps = listOf(100.0, 0.0).map { distance ->
      RouteStep(listOf(start, end), distance, distance, null, emptyList(), "Original English", emptyList(), emptyList(), null, emptyList(), null, null)
    }
    return Route(listOf(start, end), BoundingBox(start, end), 100.0, emptyList(), steps)
  }

  private val response = """{"code":"Ok","routes":[{"legs":[{"steps":[{"maneuver":{"type":"depart"}},{"maneuver":{"type":"arrive"}}]}]}]}"""
}
