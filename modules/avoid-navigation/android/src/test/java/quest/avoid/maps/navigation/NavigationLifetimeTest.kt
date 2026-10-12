package quest.avoid.maps.navigation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class NavigationLifetimeTest {
  @Test fun `invalidation cancels pending promotion and rejects the invalidated epoch`() = runBlocking {
    val lifetime = NavigationLifetime()
    val start = lifetime.begin()
    val waiting = async { try { start.promoted.await(); false } catch (_: CancellationException) { true } }
    yield()
    lifetime.invalidate()
    assertTrue(waiting.await())
    assertFalse(lifetime.promote(start.epoch))
    assertFalse(lifetime.isCurrent(start.epoch))
  }
  @Test fun `replacement epoch cancels prior promotion and rejects the stale epoch`() = runBlocking {
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
  @Test fun `repeated invalidation keeps the prior epoch stale`() {
    val lifetime = NavigationLifetime()
    val start = lifetime.begin()
    assertTrue(lifetime.promote(start.epoch))
    lifetime.invalidate(); lifetime.invalidate()
    assertFalse(lifetime.isCurrent(start.epoch))
    assertFalse(lifetime.promote(start.epoch))
  }
}
