package quest.avoid.maps.navigation

import org.junit.Assert.*
import kotlinx.coroutines.async
import org.junit.Test

class NavigationPolicyTest {
  private val walk = RoadGuidancePolicy.fix("walk")
  private val bike = RoadGuidancePolicy.fix("bicycle")
  private val car = RoadGuidancePolicy.fix("car")
  private val ACCEPTED = FixAdmission.Outcome.ACCEPTED
  private val REJECTED = FixAdmission.Outcome.REJECTED
  private val DEGRADED = FixAdmission.Outcome.DEGRADED
  private val RECOVERING = FixAdmission.Outcome.RECOVERING
  private val DUPLICATE = FixAdmission.Outcome.DUPLICATE

  /** A fix sampled at [ms] (monotonic) and received at once, as the platform delivers at 1 Hz. */
  private fun FixAdmission<String>.at(ms: Long, accuracy: Double, age: Long = 0, fix: String = "x", implausible: Boolean = false) =
    onFix(ms, (ms - age) * 1_000_000L, age, accuracy, true, fix, implausible)
  /** Feeds a 1 Hz sequence starting at [fromMs]; returns outcomes. */
  private fun FixAdmission<String>.sequence(fromMs: Long, vararg accuracies: Double) =
    accuracies.mapIndexed { index, accuracy -> at(fromMs + index * 1_000L, accuracy).outcome }

  @Test fun packagedPolicyCarriesPerModeLimits() {
    assertEquals(15_000L, RoadGuidancePolicy.maximumFixAgeMillis)
    assertEquals(35.0, walk.startAccuracyMeters, 0.0); assertEquals(35.0, walk.normalGuidanceAccuracyMeters, 0.0)
    for (policy in listOf(bike, car)) {
      assertEquals(30.0, policy.startAccuracyMeters, 0.0); assertEquals(25.0, policy.normalGuidanceAccuracyMeters, 0.0)
    }
    for (policy in listOf(walk, bike, car)) {
      assertEquals(50.0, policy.maximumGuidanceAccuracyMeters, 0.0)
      assertEquals(25.0, policy.deviationAccuracyMeters, 0.0)
      assertEquals(50.0, policy.reducedStartAccuracyMeters, 0.0); assertEquals(15_000L, policy.reducedStartAfterMillis)
      assertEquals(3, policy.degradeAfterRejectedFixes); assertEquals(8_000L, policy.degradeAfterMillis)
      assertEquals(30_000L, policy.startTimeoutMillis)
    }
    assertEquals(1, walk.recoverAfterAcceptedFixes); assertEquals(2, car.recoverAfterAcceptedFixes)
  }

  @Test fun freshnessAndAccuracyBoundariesAreExplicit() {
    val limit = walk.maximumGuidanceAccuracyMeters
    assertNull(FixPolicy.problem(15_000, 50.0, true, limit))
    assertNull(FixPolicy.problem(0, 1.0, true, limit))
    assertEquals("location-stale", FixPolicy.problem(-1, 1.0, true, limit))
    assertEquals("location-stale", FixPolicy.problem(15_001, 1.0, true, limit))
    listOf(0.0, -1.0, 50.01, 60.0, Double.NaN, Double.POSITIVE_INFINITY).forEach {
      assertEquals("location-inaccurate", FixPolicy.problem(0, it, true, limit))
    }
    assertEquals("location-inaccurate", FixPolicy.problem(0, 1.0, false, limit))
  }

  @Test fun goodFirstFixStartsImmediately() {
    val gate = FixAdmission<String>(walk, 0)
    val result = gate.at(1_000, 12.0, age = 500)
    assertEquals(ACCEPTED, result.outcome); assertFalse(result.reducedPrecision)
    assertTrue(gate.started); assertTrue(gate.confident)
  }

  @Test fun bicycleAt30mStartsAndKeepsGuidingWithReducedPrecision() {
    val gate = FixAdmission<String>(bike, 0)
    val start = gate.at(0, 30.0)
    assertEquals(ACCEPTED, start.outcome); assertTrue(start.reducedPrecision)
    for (second in 1..60) {
      val result = gate.at(second * 1_000L, 30.0)
      assertEquals(ACCEPTED, result.outcome); assertTrue(result.reducedPrecision)
      assertNull(gate.onTick(second * 1_000L))
    }
    assertTrue(gate.confident)
    assertFalse(gate.at(61_000, 20.0).reducedPrecision)
  }

  @Test fun walkingAt45mStartsReducedAfter15sAndKeepsGuiding() {
    val gate = FixAdmission<String>(walk, 0)
    assertEquals(List(15) { REJECTED }, gate.sequence(0, *DoubleArray(15) { 45.0 }))
    val start = gate.at(15_000, 45.0)
    assertEquals(ACCEPTED, start.outcome); assertTrue(start.reducedStart); assertTrue(start.reducedPrecision)
    assertEquals(List(30) { ACCEPTED }, gate.sequence(16_000, *DoubleArray(30) { 45.0 }))
    assertTrue(gate.confident)
  }

  @Test fun reducedStartIsAvailableForEveryModeFromTheRetainedBestFix() {
    for (policy in listOf(walk, bike, car)) {
      val gate = FixAdmission<String>(policy, 0)
      assertEquals(REJECTED, gate.at(2_000, 55.0, fix = "far").outcome)
      assertEquals(REJECTED, gate.at(3_000, 44.0, fix = "best").outcome)
      assertEquals(REJECTED, gate.at(4_000, 48.0, fix = "worse").outcome)
      assertNull(gate.onTick(14_999))
      val start = gate.onTick(15_000) as FixAdmission.Tick.ReducedStart<*>
      assertEquals("best", start.fix); assertEquals(44.0, start.accuracyMeters, 0.0)
      assertTrue(gate.started)
    }
  }

  @Test fun reducedStartCandidateMustStillBeFresh() {
    val gate = FixAdmission<String>(walk, 0)
    gate.at(1_000, 45.0, fix = "old")
    assertFalse(gate.onTick(17_000) is FixAdmission.Tick.ReducedStart<*>)
    assertFalse(gate.started)
    assertTrue(gate.at(18_000, 49.0, fix = "new").reducedStart)
  }

  @Test fun providerLossDiscardsTheReducedStartCandidate() {
    val gate = FixAdmission<String>(walk, 0)
    assertEquals(REJECTED, gate.at(14_000, 45.0, fix = "before-loss").outcome)
    gate.lose()
    assertNull(gate.onTick(15_000))
    assertNull(gate.onTick(16_000))
    assertFalse(gate.started)
    // Positioning returns: only a fix received afterwards can start.
    val returned = gate.at(17_000, 45.0, fix = "after")
    assertEquals(ACCEPTED, returned.outcome); assertTrue(returned.reducedStart)
  }

  @Test fun rejectedStartFixesNeverFlapAndSettleOnceIntoTimeout() {
    val gate = FixAdmission<String>(car, 0)
    for (second in 1 until 30) {
      assertEquals(REJECTED, gate.at(second * 1_000L, if (second % 2 == 0) 500.0 else 520.0).outcome)
      assertNull(gate.onTick(second * 1_000L))
    }
    val timeout = gate.onTick(30_000) as FixAdmission.Tick.StartTimeout
    assertEquals("location-inaccurate", timeout.problem)
    assertEquals(500.0, timeout.bestRejectedAccuracyMeters!!, 0.0)
    assertEquals(29, gate.fixesSeen)
    assertEquals(REJECTED, gate.at(31_000, 500.0).outcome)
    assertNull(gate.onTick(45_000))
    // A later good fix still starts the session (the single automatic start).
    assertEquals(ACCEPTED, gate.at(46_000, 20.0).outcome)
  }

  @Test fun duplicateGpsAndFusedSamplesCountOnce() {
    val gate = FixAdmission<String>(car, 0)
    for (second in 1..29) {
      val sample = second * 1_000L
      assertEquals(REJECTED, gate.onFix(sample, sample * 1_000_000L, 0, 500.0, true, "gps").outcome)
      // Fused re-delivers the same measurement (same or nearly the same sample time).
      assertEquals(DUPLICATE, gate.onFix(sample + 5, sample * 1_000_000L, 5, 500.0, true, "fused").outcome)
      assertEquals(DUPLICATE, gate.onFix(sample + 6, sample * 1_000_000L + 50_000_000L, 0, 500.0, true, "fused").outcome)
    }
    assertEquals(29, gate.fixesSeen); assertEquals(58, gate.duplicatesSkipped)
    // An older interleaved sample is ignored too.
    assertEquals(DUPLICATE, gate.onFix(29_500, 10_000_000_000L, 0, 5.0, true, "network").outcome)
  }

  @Test fun duplicateSampleCannotCompleteCarRecovery() {
    val gate = FixAdmission<String>(car, 0)
    gate.at(0, 10.0)
    gate.lose()
    assertEquals(RECOVERING, gate.at(1_000, 10.0).outcome)
    assertEquals(DUPLICATE, gate.onFix(1_001, 1_000L * 1_000_000L, 1, 10.0, true, "fused").outcome)
    assertFalse(gate.confident)
    assertEquals(ACCEPTED, gate.at(2_000, 10.0).outcome)
    assertTrue(gate.confident)
  }

  @Test fun noFreshFixTimesOutAsUnavailableAndStaleSeedsDoNotCount() {
    val gate = FixAdmission<String>(walk, 0)
    assertEquals("location-stale", gate.onFix(100, 0, 811_000, 5.0, true, "cached").problem)
    assertEquals(0, gate.fixesSeen)
    assertEquals("location-unavailable", (gate.onTick(30_000) as FixAdmission.Tick.StartTimeout).problem)
    gate.restartWaiting(40_000)
    assertFalse(gate.startTimedOut)
    assertNull(gate.onTick(69_999))
    assertTrue(gate.onTick(70_000) is FixAdmission.Tick.StartTimeout)
  }

  @Test fun guidanceDegradesOnTheThirdConsecutiveRejectionAt1Hz() {
    val gate = FixAdmission<String>(bike, 0)
    assertEquals(listOf(ACCEPTED, REJECTED, REJECTED, DEGRADED, REJECTED), gate.sequence(0, 20.0, 60.0, 60.0, 60.0, 60.0))
    assertFalse(gate.confident)
    assertEquals(listOf(ACCEPTED), gate.sequence(5_000, 20.0))
    assertTrue(gate.confident)
    // Two rejections then a good fix: never degraded.
    assertEquals(listOf(REJECTED, REJECTED, ACCEPTED, REJECTED, REJECTED, ACCEPTED), gate.sequence(6_000, 60.0, 60.0, 20.0, 60.0, 60.0, 20.0))
    assertTrue(gate.confident)
  }

  @Test fun alternatingSequencesKeepGuidingWithinTheMaximum() {
    val gate = FixAdmission<String>(walk, 0)
    assertEquals(List(5) { ACCEPTED }, gate.sequence(0, 8.0, 45.0, 45.0, 45.0, 8.0))
    val precision = listOf(8.0, 45.0, 45.0, 45.0, 8.0).mapIndexed { index, accuracy -> gate.at(10_000L + index * 1_000L, accuracy).reducedPrecision }
    assertEquals(listOf(false, true, true, true, false), precision)
    assertEquals(listOf(ACCEPTED, REJECTED, REJECTED, DEGRADED, ACCEPTED), gate.sequence(20_000, 8.0, 60.0, 60.0, 60.0, 8.0))
    for (second in 30..70) assertNotEquals(DEGRADED, gate.at(second * 1_000L, if (second % 2 == 0) 20.0 else 60.0).outcome)
    assertTrue(gate.confident)
  }

  @Test fun silenceDegradesOnceAfterEightSecondsAndRecoversPerMode() {
    val gate = FixAdmission<String>(walk, 0)
    gate.at(0, 10.0)
    assertNull(gate.onTick(7_999))
    assertEquals("location-stale", (gate.onTick(8_000) as FixAdmission.Tick.Degraded).problem)
    assertNull(gate.onTick(9_000))
    assertEquals(ACCEPTED, gate.at(10_000, 20.0).outcome)

    val drive = FixAdmission<String>(car, 0)
    drive.at(0, 10.0)
    drive.lose()
    assertEquals(RECOVERING, drive.at(1_000, 10.0).outcome)
    assertFalse(drive.confident)
    assertEquals(ACCEPTED, drive.at(2_000, 10.0).outcome)
    assertTrue(drive.confident)
  }

  @Test fun implausibleJumpsCountAsRejections() {
    val gate = FixAdmission<String>(walk, 0)
    gate.at(0, 10.0)
    assertEquals(REJECTED, gate.at(1_000, 5.0, implausible = true).outcome)
    assertEquals(REJECTED, gate.at(2_000, 5.0, implausible = true).outcome)
    assertEquals(DEGRADED, gate.at(3_000, 5.0, implausible = true).outcome)
  }

  @Test fun transitFollowingStartsWithoutAnyFix() {
    val gate = FixAdmission<String>(RoadGuidancePolicy.fix("transit"), 0, startedImmediately = true)
    assertTrue(gate.started); assertFalse(gate.confident)
    assertNull(gate.onTick(60_000))
    assertEquals(ACCEPTED, gate.at(61_000, 45.0).outcome)
    assertTrue(gate.confident)
  }

  @Test fun stopDuringForegroundWaitCancelsTheStart() = kotlinx.coroutines.runBlocking {
    val fence = StartFence()
    val resumed = kotlinx.coroutines.CompletableDeferred<Unit>()
    var started = 0
    val waiting = async { fence.run({ resumed.await() }) { started++; "session" } }
    kotlinx.coroutines.yield()
    fence.invalidate() // Stop while the permission dialog is closing.
    resumed.complete(Unit)
    assertNull(waiting.await())
    assertEquals(0, started)
    // A later Start is unaffected; a newer Start also supersedes an older waiting one.
    assertEquals("session", fence.run({}) { started++; "session" })
    val older = kotlinx.coroutines.CompletableDeferred<Unit>()
    val first = async { fence.run({ older.await() }) { "old" } }
    kotlinx.coroutines.yield()
    assertEquals("new", fence.run({}) { "new" })
    older.complete(Unit)
    assertNull(first.await())
    assertEquals(1, started)
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
