package quest.avoid.maps.navigation

import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class AvoidNavigationModule : Module() {
  private val main = android.os.Handler(android.os.Looper.getMainLooper())
  private val retainedRuntime = lazy { NavigationRuntime.get(requireNotNull(appContext.reactContext)) }
  private val runtime: NavigationRuntime get() = retainedRuntime.value
  @Volatile private var destroyed = false
  /** A Stop during the foreground wait cancels the waiting Start/Resume; it never starts afterwards. */
  private val startFence = StartFence()
  private suspend fun fenced(start: suspend () -> Map<String, Any?>): Map<String, Any?> =
    startFence.run({ requireForeground() }, start) ?: runtime.snapshot().also { Log.i(NavigationRuntime.TAG, "start cancelled during foreground wait") }
  private val observer: (Map<String, Any?>) -> Unit = { if (!destroyed) sendEvent("onNavigationState", it) }
  private fun resumed(): Boolean {
    val activity = appContext.currentActivity
    return activity != null && !activity.isFinishing && !activity.isDestroyed &&
      (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
  }
  /** The permission dialog resolves before the activity resumes; wait briefly instead of failing Start. */
  private suspend fun requireForeground() {
    if (resumed()) return
    val ready = withTimeoutOrNull(3_000) { while (!resumed()) delay(50); true }
    if (ready != true) { Log.w(NavigationRuntime.TAG, "start rejected foreground-required"); throw NavigationFailure("foreground-required") }
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
    AsyncFunction("getLocationProviderStatus") {
      val context = requireNotNull(appContext.reactContext)
      val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      val gps = LocationManager.GPS_PROVIDER in manager.allProviders && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
      val network = LocationManager.NETWORK_PROVIDER in manager.allProviders && manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
      val other = manager.getProviders(true).any { it !in setOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER) }
      mapOf("locationEnabled" to (if (Build.VERSION.SDK_INT >= 28) manager.isLocationEnabled else gps || network || other),
        "gpsEnabled" to gps, "networkEnabled" to network, "otherEnabled" to other)
    }
    AsyncFunction("getSnapshot") Coroutine { -> withContext(Dispatchers.Main.immediate) { runtime.snapshot() } }
    AsyncFunction("startNavigation") Coroutine { options: Map<String, Any?> ->
      withContext(Dispatchers.Main.immediate) {
        @Suppress("UNCHECKED_CAST")
        val destination = Point.from(options["destination"] as? Map<String, Any?> ?: throw NavigationFailure("invalid"))
        val mode = options["mode"] as? String ?: throw NavigationFailure("invalid")
        fenced { runtime.start(destination, mode) }
      }
    }
    AsyncFunction("startTransitNavigation") Coroutine { options: Map<String, Any?> ->
      withContext(Dispatchers.Main.immediate) {
        @Suppress("UNCHECKED_CAST")
        val plan = options["plan"] as? Map<String, Any?> ?: throw NavigationFailure("invalid")
        @Suppress("UNCHECKED_CAST")
        val origin = Point.from(options["origin"] as? Map<String, Any?> ?: throw NavigationFailure("invalid"))
        @Suppress("UNCHECKED_CAST")
        val destination = Point.from(options["destination"] as? Map<String, Any?> ?: throw NavigationFailure("invalid"))
        fenced { runtime.startTransit(plan, origin, destination) }
      }
    }
    AsyncFunction("confirmTransitStep") Coroutine { sessionId: String, action: String ->
      withContext(Dispatchers.Main.immediate) { runtime.confirmTransit(sessionId, action) }
    }
    AsyncFunction("stopNavigation") Coroutine { sessionId: String? ->
      withContext(Dispatchers.Main.immediate) {
        // Wildcard or current-session Stop also cancels a Start/Resume still waiting for the foreground.
        if (sessionId == null || sessionId == runtime.snapshot()["sessionId"]) startFence.invalidate()
        runtime.stop(sessionId)
      }
    }
    AsyncFunction("retryNavigation") Coroutine { sessionId: String ->
      withContext(Dispatchers.Main.immediate) { fenced { runtime.retry(sessionId) } }
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
