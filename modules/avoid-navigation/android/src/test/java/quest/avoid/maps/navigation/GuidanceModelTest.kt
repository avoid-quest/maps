package quest.avoid.maps.navigation

import kotlin.math.cos
import kotlin.math.sin
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.ferrostar.BoundingBox
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.Route
import uniffi.ferrostar.RouteStep

/**
 * Deterministic route fixtures for the structured guidance snapshot: straight, left/right turns,
 * close turns, roundabout, U-turn, arrival, deviation and degraded fix kinematics.
 */
class GuidanceModelTest {
  private val origin = GeographicCoordinate(45.0703, 7.6869)

  /** Point [meters] from [from] along compass [bearing]. */
  private fun move(from: GeographicCoordinate, bearing: Double, meters: Double): GeographicCoordinate {
    val radians = Math.toRadians(bearing)
    val lat = from.lat + meters * cos(radians) / 111_195.0
    val lng = from.lng + meters * sin(radians) / (111_195.0 * cos(Math.toRadians(from.lat)))
    return GeographicCoordinate(lat, lng)
  }

  /** Legs of (bearing, metres) walked in 10 m points; returns the polyline and each leg's slice. */
  private fun polyline(legs: List<Pair<Double, Double>>): Pair<List<GeographicCoordinate>, List<List<GeographicCoordinate>>> {
    val points = mutableListOf(origin)
    val slices = mutableListOf<List<GeographicCoordinate>>()
    for ((bearing, meters) in legs) {
      val start = points.size - 1
      val count = maxOf(1, (meters / 10).toInt())
      repeat(count) { points.add(move(points.last(), bearing, meters / count)) }
      slices.add(points.subList(start, points.size).toList())
    }
    return points to slices
  }

  private fun rawStep(type: String, at: GeographicCoordinate, modifier: String? = null, name: String = "", exit: Int? = null,
    before: Int? = null, after: Int? = null): JSONObject {
    val maneuver = JSONObject().put("type", type).put("location", JSONArray().put(at.lng).put(at.lat))
    modifier?.let { maneuver.put("modifier", it) }
    exit?.let { maneuver.put("exit", it) }
    before?.let { maneuver.put("bearing_before", it) }
    after?.let { maneuver.put("bearing_after", it) }
    return JSONObject().put("name", name).put("maneuver", maneuver).put("driving_side", "right")
  }

  private class Fixture(val route: Route, val facts: List<ManeuverFacts>) {
    val index = RouteGuideIndex(route.geometry, route.steps, facts)
    fun fields(remaining: Int, snapped: GeographicCoordinate?, alignment: String = Alignment.ALIGNED, revision: Long = 7) =
      GuidanceFields.build(revision, index, route.steps, facts, remaining, snapped, alignment)
  }

  /** One step per leg plus the arrival; raw[k] describes step k's maneuver. */
  private fun fixture(legs: List<Pair<Double, Double>>, raw: (Int, GeographicCoordinate) -> JSONObject): Fixture {
    val (points, slices) = polyline(legs)
    val steps = slices.mapIndexed { k, slice ->
      val length = slice.zipWithNext { a, b -> RouteGuideIndex.distance(a, b) }.sum()
      RouteStep(slice, length, length / 1.4, null, emptyList(), "Passo $k", emptyList(), emptyList(), null, emptyList(), null, null)
    } + RouteStep(listOf(points.last(), points.last()), 0.0, 0.0, null, emptyList(), "Arrivo", emptyList(), emptyList(), null, emptyList(), null, null)
    val json = JSONObject().put("code", "Ok").put("routes", JSONArray().put(JSONObject().put("legs", JSONArray().put(
      JSONObject().put("steps", JSONArray(steps.indices.map { k -> raw(k, steps[k].geometry.first()) })),
    )))).toString()
    val route = Route(points, BoundingBox(points.first(), points.last()), steps.sumOf { it.distance }, emptyList(), steps)
    return Fixture(route, ManeuverFacts.parse(json))
  }

  @Test fun straightRouteProgressIsMonotonicAndMatchesRenderedGeometry() {
    val f = fixture(listOf(0.0 to 300.0)) { k, at -> if (k == 0) rawStep("depart", at) else rawStep("arrive", at) }
    assertEquals(300.0, f.index.length, 0.5)
    var previous = -1.0
    for (meters in listOf(0.0, 15.0, 100.0, 222.0, 299.0)) {
      val traveled = f.index.progress(0, move(origin, 0.0, meters)).traveledMeters
      assertEquals(meters, traveled, 0.5)
      assertTrue(traveled > previous); previous = traveled
    }
    // A sidewalk offset of 8 m does not change the along-route progress.
    assertEquals(100.0, f.index.progress(0, move(move(origin, 0.0, 100.0), 90.0, 8.0)).traveledMeters, 0.5)
    val fields = f.fields(remaining = 2, snapped = move(origin, 0.0, 50.0))
    @Suppress("UNCHECKED_CAST") val upcoming = fields["upcomingManeuver"] as Map<String, Any>
    assertEquals("arrive", upcoming["type"]); assertEquals("7:1", upcoming["id"])
    assertNull(fields["followingManeuver"])
    @Suppress("UNCHECKED_CAST") val progress = fields["routeProgress"] as Map<String, Any>
    assertEquals(50.0, progress["traveledMeters"] as Double, 0.5)
    assertEquals(300.0, progress["routeLengthMeters"] as Double, 0.5)
  }

  @Test fun leftAndRightTurnsExposeTypedUpcomingAndFollowingWithStableIds() {
    val f = fixture(listOf(0.0 to 200.0, 90.0 to 150.0, 0.0 to 100.0)) { k, at -> when (k) {
      0 -> rawStep("depart", at, name = "Via Po", after = 0)
      1 -> rawStep("turn", at, "right", "Via Roma", before = 0, after = 90)
      2 -> rawStep("turn", at, "left", "Via Garibaldi", before = 90, after = 0)
      else -> rawStep("arrive", at)
    } }
    assertArrayEquals(intArrayOf(0, 20, 35, 45), f.index.maneuverIndex)
    val fields = f.fields(remaining = 4, snapped = move(origin, 0.0, 120.0))
    @Suppress("UNCHECKED_CAST") val upcoming = fields["upcomingManeuver"] as Map<String, Any>
    @Suppress("UNCHECKED_CAST") val following = fields["followingManeuver"] as Map<String, Any>
    assertEquals(listOf("7:1", "turn", "right", "Via Roma", 20, 0, 90, "right"),
      listOf(upcoming["id"], upcoming["type"], upcoming["modifier"], upcoming["name"], upcoming["geometryIndex"], upcoming["bearingBefore"], upcoming["bearingAfter"], upcoming["drivingSide"]))
    assertEquals(listOf("7:2", "left", 35), listOf(following["id"], following["modifier"], following["geometryIndex"]))
    // The following maneuver is a whole upcoming step away: 150 m, about 107 s on foot.
    assertEquals(150.0, following["afterUpcomingMeters"] as Double, 0.5)
    assertEquals(107.1, following["afterUpcomingSeconds"] as Double, 0.5)
    // A reroute changes every id even for the same step index.
    @Suppress("UNCHECKED_CAST")
    assertEquals("8:1", (f.fields(4, null, revision = 8)["upcomingManeuver"] as Map<String, Any>)["id"])
    // Ferrostar advanced past the first turn: the left turn is next and progress continues.
    val after = f.fields(remaining = 3, snapped = move(move(origin, 0.0, 200.0), 90.0, 40.0))
    @Suppress("UNCHECKED_CAST") assertEquals("7:2", (after["upcomingManeuver"] as Map<String, Any>)["id"])
    @Suppress("UNCHECKED_CAST") assertEquals(240.0, (after["routeProgress"] as Map<String, Any>)["traveledMeters"] as Double, 0.6)
  }

  @Test fun closeTurnsReportTheShortGapBetweenManeuvers() {
    val f = fixture(listOf(0.0 to 200.0, 90.0 to 20.0, 0.0 to 120.0)) { k, at -> when (k) {
      0 -> rawStep("depart", at); 1 -> rawStep("turn", at, "right"); 2 -> rawStep("turn", at, "left"); else -> rawStep("arrive", at)
    } }
    @Suppress("UNCHECKED_CAST") val following = f.fields(4, move(origin, 0.0, 150.0))["followingManeuver"] as Map<String, Any>
    assertEquals(20.0, following["afterUpcomingMeters"] as Double, 0.5)
    assertEquals("left", following["modifier"])
  }

  @Test fun roundaboutKeepsExitNumberModifierAndDrivingSide() {
    val f = fixture(listOf(0.0 to 120.0, 45.0 to 60.0, 90.0 to 100.0)) { k, at -> when (k) {
      0 -> rawStep("depart", at); 1 -> rawStep("roundabout", at, "right", "Corso Francia", exit = 3)
      2 -> rawStep("exit roundabout", at, "right", "Corso Francia"); else -> rawStep("arrive", at)
    } }
    @Suppress("UNCHECKED_CAST") val upcoming = f.fields(4, move(origin, 0.0, 60.0))["upcomingManeuver"] as Map<String, Any>
    assertEquals(listOf("roundabout", "right", 3, "right"), listOf(upcoming["type"], upcoming["modifier"], upcoming["exit"], upcoming["drivingSide"]))
  }

  @Test fun uTurnSearchesForwardAndProgressNeverJumpsToTheOutboundLeg() {
    // North 100 m, U-turn back south 100 m over the same line, then east 80 m.
    val f = fixture(listOf(0.0 to 100.0, 180.0 to 100.0, 90.0 to 80.0)) { k, at -> when (k) {
      0 -> rawStep("depart", at); 1 -> rawStep("continue", at, "uturn"); 2 -> rawStep("turn", at, "left"); else -> rawStep("arrive", at)
    } }
    assertArrayEquals(intArrayOf(0, 10, 20, 28), f.index.maneuverIndex)
    // Returning past the 70 m mark: on step 1 the projection stays on the return leg (130 m traveled).
    assertEquals(130.0, f.index.progress(1, move(origin, 0.0, 70.0)).traveledMeters, 0.6)
    assertEquals(70.0, f.index.progress(0, move(origin, 0.0, 70.0)).traveledMeters, 0.6)
    @Suppress("UNCHECKED_CAST") val upcoming = f.fields(4, move(origin, 0.0, 50.0))["upcomingManeuver"] as Map<String, Any>
    assertEquals("continue" to "uturn", upcoming["type"] to upcoming["modifier"])
  }

  @Test fun arrivalHasNoFollowingManeuverAndUnknownTypesStayUnguessed() {
    val f = fixture(listOf(0.0 to 80.0)) { k, at -> if (k == 0) rawStep("depart", at) else rawStep("future-type", at, "sideways") }
    val fields = f.fields(remaining = 2, snapped = move(origin, 0.0, 79.0))
    @Suppress("UNCHECKED_CAST") val upcoming = fields["upcomingManeuver"] as Map<String, Any>
    assertEquals("future-type", upcoming["type"])
    assertFalse("an unknown modifier is dropped, never guessed", upcoming.containsKey("modifier"))
    assertFalse(fields.containsKey("followingManeuver"))
    // Ferrostar on the last step: nothing upcoming, progress still published.
    val last = f.fields(remaining = 1, snapped = move(origin, 0.0, 80.0))
    assertFalse(last.containsKey("upcomingManeuver"))
    assertTrue(last.containsKey("routeProgress"))
  }

  @Test fun alignmentFollowsDeviationOnlyForJudgedFixes() {
    assertEquals(Alignment.ALIGNED, Alignment.of(judged = true, offRoute = false, deviation = false))
    assertEquals(Alignment.DEVIATING, Alignment.of(judged = true, offRoute = false, deviation = true))
    assertEquals(Alignment.DEVIATING, Alignment.of(judged = false, offRoute = true, deviation = false))
    // A coarse fix neither declares nor clears deviation: the snapped position is not credible.
    assertEquals(Alignment.UNKNOWN, Alignment.of(judged = false, offRoute = false, deviation = true))
    val f = fixture(listOf(0.0 to 80.0)) { k, at -> rawStep(if (k == 0) "depart" else "arrive", at) }
    assertEquals(Alignment.UNKNOWN, f.fields(2, null, Alignment.UNKNOWN)["alignment"])
    assertFalse(f.fields(2, null).containsKey("snappedLocation"))
  }

  @Test fun degradedKinematicsAreOmittedAndCourseWrapsIntoOneTurn() {
    val clean = FixKinematics.fields(1.4f, 0.3f, 359.6f, 12f, 5_000_000_000L)
    assertEquals(mapOf("speedMps" to 1.4, "speedAccuracyMps" to 0.3, "course" to 359.6, "courseAccuracyDegrees" to 12.0, "elapsedMs" to 5_000L), clean)
    assertEquals(0.0, FixKinematics.fields(null, null, 360f, null, 1L)["course"])
    assertEquals(0.0, FixKinematics.fields(null, null, 359.97f, null, 1L)["course"])
    assertEquals(350.0, FixKinematics.fields(null, null, -10f, null, 1L)["course"])
    // NaN, negative speed and missing monotonic time never reach the bridge.
    assertEquals(emptyMap<String, Any>(), FixKinematics.fields(Float.NaN, -1f, Float.POSITIVE_INFINITY, Float.NaN, 0L))
    val values = FixKinematics.fields(-0.5f, Float.NaN, 10f, -3f, 2_000_000L).values
    assertTrue(values.all { (it as? Double)?.isFinite() ?: true })
  }

  @Test fun factsParseEveryLegInOrderAndBoundText() {
    fun leg(name: String) = JSONObject().put("steps", JSONArray().put(rawStep("depart", origin, name = name)).put(rawStep("arrive", origin)))
    val json = JSONObject().put("code", "Ok").put("routes", JSONArray().put(JSONObject().put("legs", JSONArray().put(leg("Via Po")).put(leg("x".repeat(400))))))
    val facts = ManeuverFacts.parse(json.toString())
    assertEquals(listOf("depart", "arrive", "depart", "arrive"), facts.map { it.type })
    assertEquals("Via Po", facts[0].name)
    assertEquals(160, facts[2].name?.length)
    assertEquals(origin.lat, facts[0].latitude, 1e-9)
  }
}
