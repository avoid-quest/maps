package quest.avoid.maps.navigation

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One serialized request, monotonic spacing, and cooldown updates even from late responses. */
internal class RoadRequestGate(
  private val now: () -> Long,
  private val wait: suspend (Long) -> Unit,
  initialSpacingMs: Long = 0,
  initialCooldownMs: Long = 0,
  private val started: () -> Unit = {},
  private val blocked: (Long) -> Unit = {},
) {
  private val mutex = Mutex()
  private var nextStart = deadline(now(), initialSpacingMs)
  @Volatile private var blockedUntil = deadline(now(), initialCooldownMs)
  fun blockFor(durationMs: Long) {
    synchronized(this) {
      blockedUntil = maxOf(blockedUntil, deadline(now(), durationMs))
      blocked((blockedUntil - now()).coerceAtLeast(0))
    }
  }
  suspend fun <T> request(block: suspend () -> T): T = mutex.withLock {
    while (true) {
      currentCoroutineContext().ensureActive()
      if (blockedUntil > now()) throw RoadCooldown()
      val remaining = nextStart - now()
      if (remaining <= 0) break
      wait(remaining)
    }
    // Cooldown may arrive from a cancelled transport while this request was queued.
    if (blockedUntil > now()) throw RoadCooldown()
    currentCoroutineContext().ensureActive()
    nextStart = deadline(now(), 1_100)
    started()
    block()
  }
  companion object {
    fun deadline(now: Long, durationMs: Long): Long = if (durationMs > Long.MAX_VALUE - now) Long.MAX_VALUE else now + durationMs.coerceAtLeast(0)
  }
}
internal class RoadCooldown : Exception()
