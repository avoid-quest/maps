package quest.avoid.maps.navigation

import org.junit.Assert.*
import org.junit.Test

class NavigationPolicyTest {
  private val walk = RoadGuidancePolicy.fix("walk")
  private val car = RoadGuidancePolicy.fix("car")

  @Test fun packagedPolicyCarriesPerModeLimits() {
    assertEquals(15_000L, RoadGuidancePolicy.maximumFixAgeMillis)
    assertEquals(35.0, walk.startAccuracyMeters, 0.0); assertEquals(35.0, walk.guidanceAccuracyMeters, 0.0)
    assertEquals(50.0, walk.reducedStartAccuracyMeters!!, 0.0); assertEquals(15_000L, walk.reducedStartAfterMillis)
    for (mode in listOf("bicycle", "car")) {
      val policy = RoadGuidancePolicy.fix(mode)
      assertEquals(30.0, policy.startAccuracyMeters, 0.0); assertEquals(25.0, policy.guidanceAccuracyMeters, 0.0)
      assertNull(policy.reducedStartAccuracyMeters)
    }
    assertEquals(1, walk.recoverAfterAcceptedFixes); assertEquals(2, car.recoverAfterAcceptedFixes)
    assertEquals(3, walk.degradeAfterRejectedFixes); assertEquals(8_000L, walk.degradeAfterMillis)
    assertEquals(30_000L, walk.startTimeoutMillis)
  }

  @Test fun freshnessAndAccuracyBoundariesAreExplicit() {
    val limit = walk.guidanceAccuracyMeters
    assertNull(FixPolicy.problem(15_000, 35.0, true, limit))
    assertNull(FixPolicy.problem(0, 1.0, true, limit))
    assertEquals("location-stale", FixPolicy.problem(-1, 1.0, true, limit))
    assertEquals("location-stale", FixPolicy.problem(15_001, 1.0, true, limit))
    listOf(0.0, -1.0, 35.01, 38.0, Double.NaN, Double.POSITIVE_INFINITY).forEach {
      assertEquals("location-inaccurate", FixPolicy.problem(0, it, true, limit))
    }
    assertEquals("location-inaccurate", FixPolicy.problem(0, 1.0, false, limit))
    assertEquals("location-inaccurate", FixPolicy.problem(0, 26.0, true, car.guidanceAccuracyMeters))
  }

  @Test fun goodFirstFixStartsImmediately() {
    val gate = FixAdmission<String>(walk, 0)
    assertEquals(FixAdmission.Outcome.ACCEPTED, gate.onFix(1_000, 500, 12.0, true, "a").outcome)
    assertTrue(gate.started); assertTrue(gate.confident)
  }

  @Test fun rejectedStartFixesNeverFlapAndSettleOnceIntoTimeout() {
    val gate = FixAdmission<String>(RoadGuidancePolicy.fix("bicycle"), 0)
    for (second in 1 until 30) {
      val result = gate.onFix(second * 1_000L, 0, if (second % 2 == 0) 38.0 else 45.0, true, "fix")
      assertEquals(FixAdmission.Outcome.REJECTED, result.outcome)
      assertNull(gate.onTick(second * 1_000L))
    }
    val timeout = gate.onTick(30_000) as FixAdmission.Tick.StartTimeout
    assertEquals("location-inaccurate", timeout.problem)
    assertEquals(38.0, timeout.bestRejectedAccuracyMeters!!, 0.0)
    assertEquals(29, gate.fixesSeen)
    // Settled: later rejections and ticks do not emit again.
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(31_000, 0, 40.0, true, "fix").outcome)
    assertNull(gate.onTick(45_000))
    // A later good fix still starts the session (the single automatic start).
    assertEquals(FixAdmission.Outcome.ACCEPTED, gate.onFix(46_000, 0, 20.0, true, "fix").outcome)
  }

  @Test fun noFreshFixTimesOutAsUnavailableAndStaleSeedsDoNotCount() {
    val gate = FixAdmission<String>(walk, 0)
    assertEquals("location-stale", gate.onFix(100, 600_000, 5.0, true, "cached").problem)
    assertEquals(0, gate.fixesSeen)
    assertEquals("location-unavailable", (gate.onTick(30_000) as FixAdmission.Tick.StartTimeout).problem)
    gate.restartWaiting(40_000)
    assertFalse(gate.startTimedOut)
    assertNull(gate.onTick(69_999))
    assertTrue(gate.onTick(70_000) is FixAdmission.Tick.StartTimeout)
  }

  @Test fun walkingStartsWithReducedAccuracyOnlyAfterTheWaitAndWithinTheBound() {
    val gate = FixAdmission<String>(walk, 0)
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(2_000, 0, 55.0, true, "far").outcome)
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(3_000, 0, 44.0, true, "best").outcome)
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(4_000, 0, 48.0, true, "worse").outcome)
    assertNull(gate.onTick(14_999))
    val start = gate.onTick(15_000) as FixAdmission.Tick.ReducedStart<*>
    assertEquals("best", start.fix); assertEquals(44.0, start.accuracyMeters, 0.0)
    assertTrue(gate.started)
    // A later fix at the reduced accuracy is still outside walking guidance accuracy.
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(16_000, 0, 44.0, true, "next").outcome)
  }

  @Test fun reducedStartCandidateMustStillBeFreshAndRoadModesNeverUseIt() {
    val gate = FixAdmission<String>(walk, 0)
    gate.onFix(1_000, 0, 45.0, true, "old")
    assertNull(gate.onTick(17_000).takeIf { it is FixAdmission.Tick.ReducedStart<*> })
    assertFalse(gate.started)
    assertTrue(gate.onFix(18_000, 0, 49.0, true, "new").reducedStart)
    val bike = FixAdmission<String>(RoadGuidancePolicy.fix("bicycle"), 0)
    bike.onFix(1_000, 0, 31.0, true, "x")
    assertFalse(bike.onTick(20_000) is FixAdmission.Tick.ReducedStart<*>)
    assertEquals(FixAdmission.Outcome.REJECTED, bike.onFix(21_000, 0, 31.0, true, "x").outcome)
  }

  @Test fun guidanceDegradesAfterThreeRejectionsOrEightSecondsAndRecoversPerMode() {
    val gate = FixAdmission<String>(walk, 0)
    gate.onFix(0, 0, 10.0, true, "start")
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(1_000, 0, 40.0, true, "x").outcome)
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(2_000, 0, 40.0, true, "x").outcome)
    assertTrue(gate.confident)
    assertEquals(FixAdmission.Outcome.ACCEPTED, gate.onFix(3_000, 0, 30.0, true, "good").outcome)
    gate.onFix(4_000, 0, 40.0, true, "x"); gate.onFix(5_000, 0, 40.0, true, "x")
    val third = gate.onFix(6_000, 0, 40.0, true, "x")
    assertEquals(FixAdmission.Outcome.DEGRADED, third.outcome); assertEquals("location-inaccurate", third.problem)
    assertFalse(gate.confident)
    assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(7_000, 0, 40.0, true, "x").outcome)
    assertEquals(FixAdmission.Outcome.ACCEPTED, gate.onFix(8_000, 0, 20.0, true, "good").outcome)
    assertTrue(gate.confident)
    // Silence for 8 s also degrades, once.
    assertNull(gate.onTick(15_999))
    assertEquals("location-stale", (gate.onTick(16_000) as FixAdmission.Tick.Degraded).problem)
    assertNull(gate.onTick(17_000))

    val drive = FixAdmission<String>(car, 0)
    drive.onFix(0, 0, 10.0, true, "start")
    drive.lose()
    assertEquals(FixAdmission.Outcome.RECOVERING, drive.onFix(1_000, 0, 10.0, true, "a").outcome)
    assertFalse(drive.confident)
    assertEquals(FixAdmission.Outcome.ACCEPTED, drive.onFix(2_000, 0, 10.0, true, "b").outcome)
    assertTrue(drive.confident)
  }

  @Test fun alternatingFixesDoNotDegradeGuidanceAndImplausibleJumpsCountAsRejections() {
    val gate = FixAdmission<String>(walk, 0)
    gate.onFix(0, 0, 10.0, true, "start")
    for (second in 1..40) {
      val good = second % 2 == 0
      val result = gate.onFix(second * 1_000L, 0, if (good) 20.0 else 60.0, true, "x")
      assertNotEquals(FixAdmission.Outcome.DEGRADED, result.outcome)
      assertNull(gate.onTick(second * 1_000L))
    }
    assertTrue(gate.confident)
    repeat(2) { assertEquals(FixAdmission.Outcome.REJECTED, gate.onFix(41_000L + it, 0, 5.0, true, "jump", implausible = true).outcome) }
    assertEquals(FixAdmission.Outcome.DEGRADED, gate.onFix(41_002, 0, 5.0, true, "jump", implausible = true).outcome)
  }

  @Test fun transitFollowingStartsWithoutAnyFix() {
    val gate = FixAdmission<String>(RoadGuidancePolicy.fix("transit"), 0, startedImmediately = true)
    assertTrue(gate.started); assertFalse(gate.confident)
    assertNull(gate.onTick(60_000))
    assertEquals(FixAdmission.Outcome.ACCEPTED, gate.onFix(61_000, 0, 30.0, true, "x").outcome)
    assertTrue(gate.confident)
  }

  @Test fun reroutingRequiresCooldownMovementAndRollingAllowance() {
    val budget = RerouteBudget()
    assertTrue(budget.tryAcquire(0, 45.0, 7.0))
    assertFalse(budget.tryAcquire(29_999, 45.001, 7.0))
    assertFalse(budget.tryAcquire(30_000, 45.0001, 7.0))
    assertTrue(budget.tryAcquire(30_000, 45.001, 7.0))
    assertTrue(budget.tryAcquire(60_000, 45.002, 7.0))
    assertFalse(budget.tryAcquire(90_000, 45.003, 7.0))
    assertFalse(budget.tryAcquire(299_999, 45.003, 7.0))
    assertTrue(budget.tryAcquire(300_000, 45.003, 7.0))
    assertFalse(budget.tryAcquire(300_001, 45.004, 7.0))
    assertTrue(budget.tryAcquire(330_000, 45.004, 7.0))
  }

  @Test fun rejectedFixesCannotConsumeAllowanceOrBypassMovementAfterWindow() {
    val budget = RerouteBudget()
    assertFalse(budget.tryAcquire(-1, 45.0, 7.0))
    assertFalse(budget.tryAcquire(0, Double.NaN, 7.0))
    assertFalse(budget.tryAcquire(0, 91.0, 7.0))
    assertFalse(budget.tryAcquire(0, 45.0, 181.0))
    assertTrue(budget.tryAcquire(100, 45.0, 7.0))
    assertFalse(budget.tryAcquire(0, 46.0, 7.0))
    assertFalse(budget.tryAcquire(600_000, 45.0, 7.0))
    budget.reset()
    assertTrue(budget.tryAcquire(100, 45.0, 7.0))
  }

  @Test fun distanceCrossesDateLineAndRemainsFiniteAtAntipodes() {
    assertTrue(NavigationGeometry.distance(0.0, 179.9999, 0.0, -179.9999) < 25)
    assertTrue(NavigationGeometry.distance(0.0, 0.0, 0.0, 180.0).isFinite())
  }
}
