package quest.avoid.maps.navigation

import org.junit.Assert.*
import org.junit.Test

class NavigationPolicyTest {
  @Test fun freshnessAndAccuracyBoundariesAreExplicit() {
    assertNull(FixPolicy.problem(10_000, 35.0, true))
    assertNull(FixPolicy.problem(0, 1.0, true))
    assertEquals("location-stale", FixPolicy.problem(-1, 1.0, true))
    assertEquals("location-stale", FixPolicy.problem(10_001, 1.0, true))
    listOf(0.0, -1.0, 35.01, Double.NaN, Double.POSITIVE_INFINITY).forEach {
      assertEquals("location-inaccurate", FixPolicy.problem(0, it, true))
    }
    assertEquals("location-inaccurate", FixPolicy.problem(0, 1.0, false))
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
