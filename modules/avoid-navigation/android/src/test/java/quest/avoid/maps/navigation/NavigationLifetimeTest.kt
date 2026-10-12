package quest.avoid.maps.navigation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class NavigationLifetimeTest {
  @Test fun `stop during service startup cancels pending Start and rejects delayed promotion`() = runBlocking {
    val lifetime = NavigationLifetime()
    val start = lifetime.begin()
    val waiting = async { try { start.promoted.await(); false } catch (_: CancellationException) { true } }
    yield()
    lifetime.invalidate()
    assertTrue(waiting.await())
    assertFalse(lifetime.promote(start.epoch))
    assertFalse(lifetime.isCurrent(start.epoch))
  }
  @Test fun `older route speech or startup failure cannot mutate replacement session`() = runBlocking {
    val lifetime = NavigationLifetime()
    val first = lifetime.begin()
    val second = lifetime.begin()
    assertTrue(first.promoted.isCancelled)
    assertFalse(lifetime.isCurrent(first.epoch))
    assertFalse(lifetime.promote(first.epoch))
    assertFalse(second.promoted.isCompleted)
    assertTrue(lifetime.promote(second.epoch))
    second.promoted.await()
    assertTrue(lifetime.isCurrent(second.epoch))
  }
  @Test fun `repeated Stop remains stopped and promotion cannot restart it`() {
    val lifetime = NavigationLifetime()
    val start = lifetime.begin()
    assertTrue(lifetime.promote(start.epoch))
    lifetime.invalidate(); lifetime.invalidate()
    assertFalse(lifetime.isCurrent(start.epoch))
    assertFalse(lifetime.promote(start.epoch))
  }
}
