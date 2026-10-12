package quest.avoid.maps.navigation

import org.junit.Assert.*
import org.junit.Test

class TransitJourneyEngineTest {
  private var now = 1_800_000_000_000L
  private val origin = coordinate(45.0)
  private val stop = coordinate(45.005)
  private val destination = coordinate(45.01)
  private fun coordinate(latitude: Double, longitude: Double = 7.0) = mapOf("latitude" to latitude, "longitude" to longitude)
  private fun leg(index: Int, transit: Boolean, from: Map<String, Double> = origin, to: Map<String, Double> = destination): Map<String, Any?> = mapOf(
    "mode" to if (transit) "bus" else "walk", "transitLeg" to transit, "interlineWithPreviousLeg" to false,
    "from" to "Fermata $index", "to" to "Fermata ${index + 1}", "line" to if (transit) "4" else null,
    "geometry" to listOf(from, to), "distanceMeters" to 1_200.0,
    "durationSeconds" to 600.0, "departureAt" to now + index * 600_000, "arrivalAt" to now + (index + 1) * 600_000,
    "timingStatus" to if (transit) "scheduled" else "unknown",
  )
  private fun plan(vararg legs: Map<String, Any?>): Map<String, Any?> = mapOf(
    "mode" to "transit", "source" to "MATO / 5T", "fetchedAt" to now, "legs" to legs.toList(),
  )
  private fun engine(vararg legs: Map<String, Any?>) = TransitJourneyEngine(plan(*legs)) { now }
  private fun transit(update: TransitUpdate) = update.fields["transit"] as Map<*, *>
  private fun phase(update: TransitUpdate) = transit(update)["phase"]

  @Test fun proximityCannotBoardAlightOrCompleteWalking() {
    val engine = engine(leg(0, false, origin, stop), leg(1, true, stop, destination))
    assertEquals("walk", phase(engine.snapshot()))
    val nearWalk = engine.onLocation(45.005, 7.0, 5.0)
    assertEquals("walk", phase(nearWalk))
    assertTrue(nearWalk.announcement!!.contains("vicino"))
    assertFalse(nearWalk.completed)
    assertEquals("walk", phase(engine.confirm("board")))
    assertEquals("board", phase(engine.confirm("walk-complete")))
    repeat(4) { assertEquals("board", phase(engine.onLocation(45.005, 7.0, 5.0))) }
    assertEquals("ride", phase(engine.confirm("board")))
    val nearAlight = engine.onLocation(45.01, 7.0, 5.0)
    assertEquals("alight", phase(nearAlight))
    assertFalse(nearAlight.completed)
    assertNull(engine.onLocation(45.01, 7.0, 5.0).announcement)
    assertTrue(engine.confirm("alight").completed)
    assertNull(engine.confirm("alight").announcement)
  }

  @Test fun missingGeometryAndPoorGpsStillAllowHonestManualProgress() {
    val engine = engine(leg(0, true) + ("geometry" to emptyList<Any>()))
    assertEquals(false, transit(engine.snapshot())["proximityAvailable"])
    assertNull(engine.snapshot().fields["distanceToManeuverMeters"])
    assertEquals("ride", phase(engine.confirm("board")))
    listOf(Double.NaN, 0.0, 35.1).forEach { accuracy ->
      val update = engine.onLocation(45.01, 7.0, accuracy)
      assertEquals("ride", phase(update))
      assertNull(update.announcement)
      assertFalse(update.completed)
    }
    assertEquals("ride", phase(engine.onLocation(Double.NaN, 7.0, 5.0)))
    assertTrue(engine.confirm("alight").completed)
  }

  @Test fun approachingStopIsDeduplicatedAndUsesAccuracyBound() {
    val engine = engine(leg(0, true))
    engine.onLocation(45.0, 7.0, 5.0)
    engine.confirm("board")
    val approach = engine.onLocation(45.008, 7.0, 5.0)
    assertTrue(approach.announcement!!.contains("Preparati"))
    assertNull(engine.onLocation(45.008, 7.0, 5.0).announcement)
    assertEquals("ride", phase(engine.onLocation(45.0095, 7.0, 35.0)))
    assertEquals("alight", phase(engine.onLocation(45.0095, 7.0, 5.0)))
  }

  @Test fun firstFixNearBoardingStopSpeaksTheSelectedLineAndDirection() {
    val engine = engine(leg(0, true) + ("headsign" to "Falchera"))
    val near = engine.onLocation(45.0, 7.0, 5.0)
    assertEquals("board", phase(near))
    assertEquals(true, transit(near)["canConfirmBoarding"])
    assertTrue(near.announcement!!.contains("Fermata 0"))
    assertTrue(near.announcement.contains("linea 4"))
    assertTrue(near.announcement.contains("direzione Falchera"))
    assertTrue(near.announcement.contains("conferma solo dopo essere salito"))
    assertNull(engine.onLocation(45.0, 7.0, 5.0).announcement)
    assertEquals("ride", phase(engine.confirm("board")))
  }

  @Test fun boardingProximityKeepsMissingServiceFactsExplicitWithoutInventingThem() {
    val engine = engine(leg(0, true) + mapOf("line" to null, "headsign" to null))
    val near = engine.onLocation(45.0, 7.0, 5.0)
    assertEquals("board", phase(near))
    assertTrue(near.announcement!!.contains("il mezzo previsto"))
    assertTrue(near.announcement.contains("Verifica linea e direzione"))
    assertFalse(near.announcement.contains("null"))
    assertNull(engine.onLocation(45.0, 7.0, 5.0).announcement)
  }

  @Test fun coincidentLoopEndpointsDoNotProduceImmediateGetOffCue() {
    val engine = engine(leg(0, true, origin, origin))
    engine.onLocation(45.0, 7.0, 5.0)
    engine.confirm("board")
    repeat(5) {
      val update = engine.onLocation(45.0, 7.0, 5.0)
      assertEquals("ride", phase(update))
      assertNull(update.announcement)
    }
    engine.onLocation(45.005, 7.0, 5.0)
    val earlyPass = engine.onLocation(45.0, 7.0, 5.0)
    assertEquals("ride", phase(earlyPass))
    assertNull(earlyPass.announcement)
    assertEquals(false, transit(earlyPass)["proximityAvailable"])
    assertTrue(engine.confirm("alight").completed)
  }

  @Test fun explicitInterlineKeepsOneBoardingButIndependentSameLineRequiresTransfer() {
    val through = engine(leg(0, true, origin, stop), leg(1, true, stop, destination) + mapOf("interlineWithPreviousLeg" to true, "line" to "10", "timingStatus" to "unknown"))
    val snapshot = through.snapshot()
    assertEquals(listOf(0, 1), transit(snapshot)["sourceLegIndices"])
    assertEquals("unknown", transit(snapshot)["timingStatus"])
    assertTrue(snapshot.fields["nextInstruction"].toString().contains("stesso mezzo"))
    through.confirm("board")
    assertEquals("ride", phase(through.onLocation(45.005, 7.0, 5.0)))
    assertTrue(through.confirm("alight").completed)

    val separate = engine(leg(0, true, origin, stop), leg(1, true, stop, destination))
    separate.confirm("board")
    val transfer = separate.confirm("alight")
    assertFalse(transfer.completed)
    assertEquals("board", phase(transfer))
    assertEquals(1, transit(transfer)["legIndex"])
  }

  @Test fun walkingTransferRemainsManualAndPreservesScheduleMetadata() {
    val engine = engine(leg(0, true), leg(1, false), leg(2, true))
    engine.confirm("board")
    val transfer = engine.confirm("alight")
    assertEquals("transfer", phase(transfer))
    assertEquals(true, transit(transfer)["canConfirmWalking"])
    assertEquals(now, transit(transfer)["fetchedAt"])
    assertEquals(now + 600_000, transit(transfer)["departureAt"])
    now += 3_600_000
    assertEquals("transfer", phase(engine.snapshot()))
    assertEquals("board", phase(engine.confirm("walk-complete")))
  }

  @Test fun invalidPlansFailClosedIncludingCancelledLaterInterlineLeg() {
    val valid = plan(leg(0, true))
    val invalid = listOf(
      valid + ("fetchedAt" to now - 120_001), valid + ("fetchedAt" to now + 1),
      valid + ("legs" to emptyList<Any>()), valid + ("legs" to List(65) { leg(0, true) }),
      plan(leg(0, true) + ("timingStatus" to "cancelled")),
      plan(leg(0, true) + ("geometry" to listOf(coordinate(91.0)))),
      plan(leg(0, true) + ("distanceMeters" to Double.NaN)),
      plan(leg(0, true) + ("arrivalAt" to now - 1)),
      plan(leg(0, true), leg(1, true) + mapOf("interlineWithPreviousLeg" to true, "timingStatus" to "cancelled")),
      plan(leg(0, false), leg(1, true) + ("interlineWithPreviousLeg" to true)),
    )
    invalid.forEach { candidate ->
      assertThrows(IllegalArgumentException::class.java) { TransitJourneyEngine(candidate) { now } }
    }
    TransitJourneyEngine(valid + ("fetchedAt" to now - 120_000)) { now }
  }

  @Test fun freshlyRetrievedHistoricalItineraryRequiresReplanning() {
    // Walking-only itineraries have no boarding deadline, but still need the end-time check.
    val expired = leg(0, false) + mapOf("departureAt" to now - 720_001, "arrivalAt" to now - 120_001)
    assertThrows(IllegalArgumentException::class.java) { engine(expired) }
    val withinSkew = expired + mapOf("departureAt" to now - 720_000, "arrivalAt" to now - 120_000)
    assertEquals("walk", phase(engine(withinSkew).snapshot()))
  }

  @Test fun earlierVisitToFinalStopSuppressesCuesEvenWhenBoardingIsFarAway() {
    val route = leg(0, true) + ("geometry" to listOf(origin, destination, coordinate(45.02), destination))
    assertAmbiguousEndRemainsManual(engine(route))
  }

  @Test fun earlierNearPassBetweenGeometryVerticesSuppressesCues() {
    // The first edge passes about 40 m from the final stop; neither vertex is nearby.
    val route = leg(0, true) + ("geometry" to listOf(
      coordinate(45.0, 7.0005), coordinate(45.02, 7.0005), coordinate(45.02, 7.02), destination,
    ))
    assertAmbiguousEndRemainsManual(engine(route))
  }

  @Test fun explicitInterlineChecksGeometryAcrossAllGroupedLegs() {
    val beyond = coordinate(45.02)
    val first = leg(0, true, origin, beyond) + ("geometry" to listOf(origin, destination, beyond))
    val second = leg(1, true, beyond, destination) + ("interlineWithPreviousLeg" to true)
    val engine = engine(first, second)
    assertEquals(listOf(0, 1), transit(engine.snapshot())["sourceLegIndices"])
    assertAmbiguousEndRemainsManual(engine)
  }

  @Test fun ordinaryGeometryWithSeveralVerticesKeepsNearbyStopCues() {
    val route = leg(0, true) + ("geometry" to listOf(
      origin, coordinate(45.004), coordinate(45.008), coordinate(45.009), coordinate(45.0095), destination,
    ))
    val engine = engine(route)
    engine.confirm("board")
    assertEquals(true, transit(engine.snapshot())["proximityAvailable"])
    assertTrue(engine.onLocation(45.008, 7.0, 5.0).announcement!!.contains("Preparati"))
    assertEquals("alight", phase(engine.onLocation(45.01, 7.0, 5.0)))
  }

  @Test fun monotonicBendKeepsCuesWhenItsGeometryIsDensified() {
    val a = coordinate(45.00359729, 7.00254367)
    val b = coordinate(45.00179864, 7.00254367)
    val c = coordinate(45.0, 7.00254367)
    val end = coordinate(45.0, 7.0)
    for (geometry in listOf(listOf(a, c, end), listOf(a, b, c, end))) {
      val engine = engine(leg(0, true, a, end) + mapOf("geometry" to geometry, "distanceMeters" to 600.0))
      engine.confirm("board")
      assertEquals(true, transit(engine.snapshot())["proximityAvailable"])
      val approaching = engine.onLocation(b.getValue("latitude"), b.getValue("longitude"), 5.0)
      assertEquals("ride", phase(approaching))
      assertTrue(approaching.announcement!!.contains("Preparati"))
      assertEquals("alight", phase(engine.onLocation(45.0, 7.0, 5.0)))
      assertTrue(engine.confirm("alight").completed)
    }
  }

  @Test fun earlierNearPassRemainsAmbiguousWhenGeometryIsDensified() {
    val a = coordinate(45.0, 7.0005)
    val near = coordinate(45.01, 7.0005)
    val beyond = coordinate(45.02, 7.0005)
    val turn = coordinate(45.02, 7.02)
    for (geometry in listOf(listOf(a, beyond, turn, destination), listOf(a, near, beyond, turn, destination))) {
      assertAmbiguousEndRemainsManual(engine(leg(0, true) + ("geometry" to geometry)))
    }
  }

  @Test fun freshlyRetrievedDepartedServiceWithFutureArrivalRequiresReplanning() {
    val departed = leg(0, true) + mapOf(
      "departureAt" to now - 1_200_000, "arrivalAt" to now + 600_000, "durationSeconds" to 1_800.0,
    )
    assertThrows(IllegalArgumentException::class.java) { engine(departed) }
    assertThrows(IllegalArgumentException::class.java) { engine(departed + ("timingStatus" to "prediction")) }
  }

  @Test fun firstBoardingAcceptsScheduledAndPredictedFutureTimesWithClockSkew() {
    val future = leg(0, true) + mapOf("departureAt" to now + 300_000, "arrivalAt" to now + 900_000)
    for (status in listOf("scheduled", "prediction")) {
      val snapshot = engine(future + ("timingStatus" to status)).snapshot()
      assertEquals("board", phase(snapshot))
      assertEquals(status, transit(snapshot)["timingStatus"])
      assertEquals(now + 300_000, transit(snapshot)["departureAt"])
    }
    val skewBoundary = leg(0, true) + mapOf("departureAt" to now - 120_000, "arrivalAt" to now + 480_000)
    assertEquals("board", phase(engine(skewBoundary).snapshot()))
    assertThrows(IllegalArgumentException::class.java) {
      engine(skewBoundary + mapOf("departureAt" to now - 120_001, "arrivalAt" to now + 479_999))
    }
  }

  @Test fun initialWalkingMustFitBeforeFirstBoarding() {
    val walk = leg(0, false, origin, stop) + mapOf("departureAt" to now - 300_000, "arrivalAt" to now + 300_000)
    val missedConnection = leg(1, true, stop, destination) + mapOf("departureAt" to now + 300_000, "arrivalAt" to now + 900_000)
    assertThrows(IllegalArgumentException::class.java) { engine(walk, missedConnection) }
    assertEquals("walk", phase(engine(leg(0, false, origin, stop), leg(1, true, stop, destination)).snapshot()))
  }

  private fun assertAmbiguousEndRemainsManual(engine: TransitJourneyEngine) {
    engine.confirm("board")
    for (latitude in listOf(45.01, 45.02, 45.01)) {
      val update = engine.onLocation(latitude, 7.0, 5.0)
      assertEquals("ride", phase(update))
      assertNull(update.announcement)
      assertEquals(false, transit(update)["proximityAvailable"])
      assertEquals(true, transit(update)["canConfirmAlighting"])
    }
    assertEquals("ride", phase(engine.onLocation(Double.NaN, 7.0, 50.0)))
    assertTrue(engine.confirm("alight").completed)
  }
}
