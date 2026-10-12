package quest.avoid.maps.navigation

import kotlinx.coroutines.CompletableDeferred

/** Fences asynchronous service promotion and callbacks across explicit Start/Stop transactions. */
internal class NavigationLifetime {
  var epoch: Long = 0
    private set
  private var promotion: CompletableDeferred<Unit>? = null
  data class Start(val epoch: Long, val promoted: CompletableDeferred<Unit>)
  fun begin(): Start {
    invalidate()
    val pending = CompletableDeferred<Unit>()
    promotion = pending
    return Start(epoch, pending)
  }
  fun isCurrent(token: Long) = token == epoch
  fun promote(token: Long): Boolean {
    if (!isCurrent(token)) return false
    val pending = promotion ?: return false
    promotion = null
    return pending.complete(Unit)
  }
  fun invalidate() {
    epoch++
    promotion?.cancel()
    promotion = null
  }
}
