package quest.avoid.maps.navigation

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AvoidNavigationModule : Module() {
  private val main = android.os.Handler(android.os.Looper.getMainLooper())
  private val retainedRuntime = lazy { NavigationRuntime.get(requireNotNull(appContext.reactContext)) }
  private val runtime: NavigationRuntime get() = retainedRuntime.value
  @Volatile private var destroyed = false
  private val observer: (Map<String, Any?>) -> Unit = { if (!destroyed) sendEvent("onNavigationState", it) }
  private fun requireForeground() {
    val activity = appContext.currentActivity
    if (activity == null || activity.isFinishing || activity.isDestroyed || (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) != true) {
      throw NavigationFailure("foreground-required")
    }
  }
  override fun definition() = ModuleDefinition {
    Name("AvoidNavigation")
    Events("onNavigationState")
    OnStartObserving {
      if (!destroyed) {
        val owner = runtime
        main.post { if (!destroyed) owner.observe(observer) }
      }
    }
    OnStopObserving {
      if (retainedRuntime.isInitialized()) {
        val owner = runtime
        main.post { owner.unobserve(observer) }
      }
    }
    OnDestroy {
      destroyed = true
      if (retainedRuntime.isInitialized()) {
        val owner = runtime
        main.post { owner.unobserve(observer) }
      }
    }
    AsyncFunction("getSnapshot") Coroutine { -> withContext(Dispatchers.Main.immediate) { runtime.snapshot() } }
    AsyncFunction("startNavigation") Coroutine { options: Map<String, Any?> ->
      withContext(Dispatchers.Main.immediate) {
        requireForeground()
        @Suppress("UNCHECKED_CAST")
        val destination = options["destination"] as? Map<String, Any?> ?: throw NavigationFailure("invalid")
        runtime.start(Point.from(destination), options["mode"] as? String ?: throw NavigationFailure("invalid"))
      }
    }
    AsyncFunction("startTransitNavigation") Coroutine { options: Map<String, Any?> ->
      withContext(Dispatchers.Main.immediate) {
        requireForeground()
        @Suppress("UNCHECKED_CAST")
        val plan = options["plan"] as? Map<String, Any?> ?: throw NavigationFailure("invalid")
        @Suppress("UNCHECKED_CAST")
        val origin = options["origin"] as? Map<String, Any?> ?: throw NavigationFailure("invalid")
        @Suppress("UNCHECKED_CAST")
        val destination = options["destination"] as? Map<String, Any?> ?: throw NavigationFailure("invalid")
        runtime.startTransit(plan, Point.from(origin), Point.from(destination))
      }
    }
    AsyncFunction("confirmTransitStep") Coroutine { sessionId: String, action: String ->
      withContext(Dispatchers.Main.immediate) { runtime.confirmTransit(sessionId, action) }
    }
    AsyncFunction("stopNavigation") Coroutine { sessionId: String? ->
      withContext(Dispatchers.Main.immediate) { runtime.stop(sessionId) }
    }
    AsyncFunction("retryNavigation") Coroutine { sessionId: String ->
      withContext(Dispatchers.Main.immediate) { requireForeground(); runtime.retry(sessionId) }
    }
    AsyncFunction("setMuted") Coroutine { sessionId: String, muted: Boolean ->
      withContext(Dispatchers.Main.immediate) { runtime.setMuted(sessionId, muted) }
    }
    AsyncFunction("requestRoadRoute") Coroutine { requestId: String, from: Map<String, Any?>, to: Map<String, Any?>, mode: String ->
      runtime.road.request(requestId, Point.from(from), Point.from(to), mode).bridge()
    }
    AsyncFunction("cancelRoadRoute") { requestId: String -> runtime.road.cancel(requestId) }
  }
}
