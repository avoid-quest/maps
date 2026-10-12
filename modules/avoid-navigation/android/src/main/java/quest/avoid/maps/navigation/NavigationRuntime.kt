package quest.avoid.maps.navigation

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import uniffi.ferrostar.RouteDeviation
import uniffi.ferrostar.TripState

/** Main-thread session owner. React can disappear while this service-owned session continues. */
internal class NavigationRuntime private constructor(private val context: Context) {
  val road = RoadRequestCoordinator(context)
  private val store = SessionStore(context)
  private val lifetime = NavigationLifetime()
  private val generation get() = lifetime.epoch
  private var revision = System.currentTimeMillis()
  private var routeSequence = 0L
  private var publishedRouteRevision: Any? = null
  private var fields = mutableMapOf<String, Any?>("sessionId" to null, "status" to "idle", "mode" to null,
    "voice" to "unavailable", "canRetry" to false)
  private val listeners = java.util.concurrent.CopyOnWriteArraySet<(Map<String, Any?>) -> Unit>()
  private var scope: CoroutineScope? = null
  private var service: NavigationService? = null
  private var source: PlatformLocationSource? = null
  private var speech: NavigationSpeech? = null
  private var engine: FerrostarNavigationEngine? = null
  private var routeJob: Job? = null
  private val recovery = NavigationRecovery()
  private var latestFix: Location? = null
  private var currentFixConfident = false
  private var locationWaitStartedAt = 0L
  private var target: Point? = null
  private var mode = "walk"
  private var transitEngine: TransitJourneyEngine? = null
  private var transitPlan: Map<String, Any?>? = null
  private var transitOrigin: Point? = null
  private var transitOriginChecked = false
  private var offRouteFixes = 0
  private var arrivalFixes = 0
  private val reroutes = RerouteBudget()
  private val spoken = linkedSetOf<String>()

  init { store.read()?.let {
    fields["sessionId"] = it["sessionId"]; fields["mode"] = it["mode"]; fields["destination"] = it["destination"]
    fields["status"] = "interrupted"; fields["canRetry"] = true
  } }
  fun snapshot(): Map<String, Any?> = fields.filter { (key, value) -> value != null || key == "sessionId" || key == "mode" } + mapOf("revision" to revision, "notificationGranted" to notificationsGranted(), "locationUsable" to currentFixConfident)
  fun observe(listener: (Map<String, Any?>) -> Unit) { listeners.add(listener); listener(snapshot()) }
  fun unobserve(listener: (Map<String, Any?>) -> Unit) { listeners.remove(listener) }
  private fun publish() {
    revision++
    val current = snapshot()
    val routeRevision = current["routeRevision"]
    val event = if (routeRevision != null && routeRevision == publishedRouteRevision) current - "route" else current
    publishedRouteRevision = routeRevision
    listeners.toList().forEach { it(event) }
  }
  private fun notificationsGranted(): Boolean {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(NavigationService.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
  }
  private fun fineLocation() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  suspend fun start(destination: Point, travelMode: String): Map<String, Any?> = startSession(destination, travelMode)

  suspend fun startTransit(plan: Map<String, Any?>, origin: Point, destination: Point): Map<String, Any?> =
    startSession(destination, "transit", plan, origin)

  private suspend fun startSession(destination: Point, travelMode: String,
    plan: Map<String, Any?>? = null, origin: Point? = null): Map<String, Any?> {
    if (!destination.valid() || travelMode !in setOf("walk", "bicycle", "car", "transit")) throw NavigationFailure("invalid")
    if (!fineLocation()) throw NavigationFailure("location-permission")
    stop(null)
    val id = UUID.randomUUID().toString()
    val starting = lifetime.begin()
    val token = starting.epoch
    target = destination; mode = travelMode; transitPlan = plan; transitOrigin = origin
    fields = mutableMapOf("sessionId" to id, "status" to "waiting-for-fix", "destination" to destination.bridge(),
      "mode" to mode, "voice" to "initializing", "canRetry" to false)
    try { store.save(id, destination, mode, plan, origin) } catch (_: Exception) {
      fields["status"] = "error"; fields["problem"] = "native-error"; publish(); return snapshot()
    }
    publish()
    try {
      val intent = Intent(context, NavigationService::class.java).setAction(NavigationService.START).putExtra("sessionId", id)
      ContextCompat.startForegroundService(context, intent)
      withTimeout(5_000) { starting.promoted.await() }
    } catch (_: Exception) {
      if (token == generation) failAndStop("service-unavailable")
    }
    return snapshot()
  }

  fun ownsService(owner: NavigationService) = service === owner
  // A queued service launch may belong to a superseded Start. Only the latest explicit Start wins.
  fun pendingServiceSession(): String? = if (scope == null && fields["status"] == "waiting-for-fix") fields["sessionId"] as? String else null

  fun serviceStarted(owner: NavigationService, id: String?) {
    if (id == null || id != fields["sessionId"] || fields["status"] != "waiting-for-fix") { if (service !== owner) owner.finish(); return }
    service = owner
    val token = generation
    scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    speech = NavigationSpeech(context) { voice -> if (generation == token) { fields["voice"] = voice; publish() } }
    source = PlatformLocationSource(context, { fix -> if (generation == token) onFix(fix) },
      { problem -> if (generation == token) degraded(problem) })
    source?.start()
    locationWaitStartedAt = SystemClock.elapsedRealtime()
    scope?.launch {
      while (true) {
        delay(2_000)
        if (!fineLocation()) { degraded("location-permission"); source?.stop(); continue }
        val fix = latestFix
        if (fix != null && fixAge(fix) > RoadGuidancePolicy.maximumFixAgeMillis) degraded("location-stale")
        else if (fix == null && SystemClock.elapsedRealtime() - locationWaitStartedAt >= 30_000 && fields["status"] == "waiting-for-fix") {
          fields["status"] = "location-degraded"
          if (fields["problem"] !in setOf("location-disabled", "location-permission")) fields["problem"] = "location-stale"
          fields["canRetry"] = true; publish()
        }
      }
    }
    lifetime.promote(token)
  }

  fun serviceDestroyed(owner: NavigationService) {
    if (service !== owner) return
    cleanup(clearCheckpoint = false)
    fields = mutableMapOf<String, Any?>("sessionId" to fields["sessionId"], "mode" to fields["mode"],
      "destination" to fields["destination"], "status" to "interrupted", "voice" to "unavailable", "canRetry" to true)
    publish()
  }

  fun stop(sessionId: String?): Map<String, Any?> {
    if (sessionId != null && sessionId != fields["sessionId"]) return snapshot()
    val id = fields["sessionId"]
    cleanup(clearCheckpoint = true)
    fields = mutableMapOf("sessionId" to id, "status" to if (id == null) "idle" else "stopped", "mode" to null,
      "voice" to "unavailable", "canRetry" to false)
    publish(); return snapshot()
  }

  suspend fun retry(id: String): Map<String, Any?> {
    if (id != fields["sessionId"]) return snapshot()
    if (fields["status"] == "interrupted") {
      @Suppress("UNCHECKED_CAST")
      val destination = Point.from(fields["destination"] as Map<String, Any?>)
      if (fields["mode"] == "transit") {
        val saved = store.read() ?: throw NavigationFailure("invalid")
        @Suppress("UNCHECKED_CAST")
        val plan = saved["transitPlan"] as? Map<String, Any?> ?: throw NavigationFailure("invalid")
        @Suppress("UNCHECKED_CAST")
        val origin = Point.from(saved["origin"] as? Map<String, Any?> ?: throw NavigationFailure("invalid"))
        return startTransit(plan, origin, destination)
      }
      return start(destination, fields["mode"] as String)
    }
    if (scope == null || recovery.transitReplanRequired) return snapshot()
    if (mode != "transit") recovery.requestRoadRetry()
    fields["status"] = if (engine == null && transitEngine == null) "waiting-for-fix" else "location-degraded"
    val fix = latestFix
    if (!currentFixConfident || fix == null || FixPolicy.problem(fixAge(fix), fix.accuracy.toDouble(), fix.hasAccuracy()) != null) {
      degraded("location-stale"); locationWaitStartedAt = SystemClock.elapsedRealtime(); source?.stop(); source?.start(); return snapshot()
    }
    if (mode == "transit") updateTransit(fix) else requestRoute(fix, engine != null)
    return snapshot()
  }
  fun setMuted(id: String, muted: Boolean): Map<String, Any?> {
    if (id == fields["sessionId"]) speech?.mute(muted)
    return snapshot()
  }

  private fun onFix(fix: Location) {
    if (!fix.latitude.isFinite() || !fix.longitude.isFinite() || fix.latitude !in -90.0..90.0 || fix.longitude !in -180.0..180.0) { degraded("location-inaccurate"); return }
    val problem = FixPolicy.problem(fixAge(fix), fix.accuracy.toDouble(), fix.hasAccuracy())
    if (problem != null) { degraded(problem); return }
    val previous = latestFix
    if (previous != null) {
      val seconds = (fix.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000_000.0
      if (seconds <= 0) return
      val maximumSpeed = when (mode) { "transit" -> 110; "car" -> 75; "bicycle" -> 25; else -> 9 }
      if (seconds < 30 && previous.distanceTo(fix) > maximumSpeed * seconds + previous.accuracy + fix.accuracy) {
        degraded("location-inaccurate"); return
      }
    }
    currentFixConfident = true
    latestFix = Location(fix)
    fields["location"] = fixMap(fix)
    if (recovery.blocksFixProgress) { publish(); return }
    if (mode == "transit") { updateTransit(fix); return }
    if (recovery.manualRoutePending) { requestRoute(fix, engine != null); return }
    if (routeJob?.isActive == true) { publish(); return }
    val activeEngine = engine
    if (activeEngine == null) {
      if (fields["status"] != "error") requestRoute(fix, false) else publish()
      return
    }
    try { handleProgress(activeEngine.update(fix), fix) } catch (_: Throwable) { failAndStop("engine-unavailable") }
  }

  private fun handleProgress(state: TripState, fix: Location) {
    when (state) {
      is TripState.Navigating -> {
        val offRoute = state.deviation is RouteDeviation.Deviation
        fields["distanceToManeuverMeters"] = state.progress.distanceToNextManeuver
        fields["distanceRemainingMeters"] = state.progress.distanceRemaining
        fields["durationRemainingSeconds"] = state.progress.durationRemaining
        val (upcoming, following) = ItalianManeuvers.upcoming(state.remainingSteps)
        if (upcoming != null) fields["instruction"] = upcoming else fields.remove("instruction")
        if (following != null) fields["nextInstruction"] = following else fields.remove("nextInstruction")
        fields["status"] = if (offRoute) "off-route" else "navigating"
        fields.remove("problem"); fields["canRetry"] = offRoute
        arrivalFixes = 0
        if (offRoute) {
          offRouteFixes++; speech?.flush()
          if (offRouteFixes >= 3) {
            if (reroutes.tryAcquire(SystemClock.elapsedRealtime(), fix.latitude, fix.longitude)) requestRoute(fix, true)
            else fields["problem"] = "reroute-limit"
          }
        } else {
          offRouteFixes = 0
          state.spokenInstruction?.let { instruction ->
            val utterance = instruction.utteranceId.toString()
            if (utterance !in spoken && speech?.speak(instruction.text, utterance) == true) spoken.add(utterance)
          }
        }
        publish()
      }
      is TripState.Complete -> {
        val destination = engine?.route?.geometry?.lastOrNull() ?: return
        val result = FloatArray(1)
        Location.distanceBetween(fix.latitude, fix.longitude, destination.lat, destination.lng, result)
        if (fix.accuracy <= RoadGuidancePolicy.maximumHorizontalAccuracyMeters.toFloat() && result[0] <= RoadGuidancePolicy.arrivalRadiusMeters.toFloat()) arrivalFixes++ else arrivalFixes = 0
        if (arrivalFixes >= 2) {
          val destinationDistance = target?.let { selected ->
            FloatArray(1).also { Location.distanceBetween(destination.lat, destination.lng, selected.latitude, selected.longitude, it) }[0].toDouble()
          }
          cleanup(clearCheckpoint = true)
          fields = mutableMapOf("sessionId" to fields["sessionId"], "status" to "arrived", "mode" to mode,
            "voice" to "unavailable", "canRetry" to false, "instruction" to "Arrivo al termine del percorso",
            "destinationDistanceMeters" to destinationDistance)
        } else { fields["status"] = "location-degraded"; fields["problem"] = "location-inaccurate"; speech?.flush() }
        publish()
      }
      else -> Unit
    }
  }

  fun confirmTransit(id: String, action: String): Map<String, Any?> {
    if (id != fields["sessionId"] || mode != "transit") return snapshot()
    // A rider's explicit confirmation remains usable in tunnels after the origin was verified.
    try { transitEngine?.confirm(action)?.let { applyTransit(it) } } catch (_: IllegalArgumentException) { /* Invalid transition leaves the journey unchanged. */ }
    return snapshot()
  }

  private fun updateTransit(fix: Location) {
    if (recovery.transitReplanRequired) { publish(); return }
    if (!transitOriginChecked) {
      val origin = transitOrigin
      val plan = transitPlan
      val distance = FloatArray(1)
      if (origin != null) Location.distanceBetween(fix.latitude, fix.longitude, origin.latitude, origin.longitude, distance)
      try {
        require(origin != null && plan != null && distance[0] <= 50)
        val fetchedAt = (plan["fetchedAt"] as? Number)?.toLong() ?: 0
        require(fetchedAt > 0 && System.currentTimeMillis() - fetchedAt in 0..120_000)
        transitEngine = TransitJourneyEngine(plan)
        transitOriginChecked = true
        fields["routeRevision"] = ++routeSequence
        fields["route"] = mapOf("geometry" to (plan["geometry"] ?: emptyList<Any>()),
          "source" to "MATO / 5T", "fetchedAt" to fetchedAt)
      } catch (_: IllegalArgumentException) {
        recovery.transitAdmissionFailed()
        fields["status"] = "error"; fields["problem"] = "transit-replan-needed"; fields["canRetry"] = false
        speech?.flush(); publish(); return
      }
    }
    transitEngine?.onLocation(fix.latitude, fix.longitude, fix.accuracy.toDouble())?.let { applyTransit(it) }
  }
  private fun applyTransit(update: TransitUpdate) {
    fields.putAll(update.fields)
    fields["status"] = if (currentFixConfident) "navigating" else "location-degraded"
    if (currentFixConfident) fields.remove("problem")
    fields["canRetry"] = false
    update.announcement?.let { speech?.speak(it, UUID.randomUUID().toString()) }
    if (update.completed) {
      cleanup(clearCheckpoint = true)
      fields = mutableMapOf("sessionId" to fields["sessionId"], "status" to "arrived", "mode" to "transit",
        "voice" to "unavailable", "canRetry" to false, "instruction" to "Arrivo a destinazione")
    }
    publish()
  }

  private fun requestRoute(fix: Location, replacing: Boolean) {
    if (routeJob?.isActive == true) return
    val sessionScope = scope ?: return
    val destination = target ?: return
    val token = generation
    recovery.routeRequested()
    fields["status"] = if (replacing) "rerouting" else "routing"
    fields.remove("problem"); fields["canRetry"] = false; speech?.flush(); publish()
    routeJob = sessionScope.launch {
      try {
        val response = road.request("session:$token:${UUID.randomUUID()}", Point(fix.latitude, fix.longitude), destination, mode)
        if (generation != token) return@launch
        val latest = latestFix ?: return@launch
        if (!currentFixConfident || FixPolicy.problem(fixAge(latest), latest.accuracy.toDouble(), latest.hasAccuracy()) != null) {
          degraded("location-stale"); return@launch
        }
        val next = FerrostarNavigationEngine(response.responseJson, mode, latest)
        if (generation != token) { next.close(); return@launch }
        engine?.close(); engine = next; spoken.clear(); offRouteFixes = 0
        fields["routeRevision"] = ++routeSequence
        fields["route"] = mapOf("geometry" to next.route.geometry.map { Point(it.lat, it.lng).bridge() },
          "source" to "FOSSGIS / OpenStreetMap", "fetchedAt" to response.fetchedAt)
        handleProgress(next.update(latest), latest)
      } catch (_: kotlinx.coroutines.CancellationException) { /* Stop/replacement already fenced the session. */
      } catch (failure: NavigationFailure) {
        if (generation == token) routeFailed(failure.reason)
      } catch (_: Throwable) {
        if (generation == token) failAndStop("engine-unavailable")
      }
    }
  }

  private fun routeFailed(reason: String) {
    recovery.roadFailed()
    fields["status"] = "error"; fields["problem"] = if (reason == "rate-limit") "rate-limit" else "route-unavailable"
    fields["canRetry"] = true; speech?.flush(); publish()
  }
  private fun degraded(problem: String) {
    currentFixConfident = false
    fields.remove("distanceToManeuverMeters")
    offRouteFixes = 0; arrivalFixes = 0; speech?.flush()
    if (recovery.blocksFixProgress || fields["status"] == "error") { publish(); return }
    fields["status"] = if (engine == null && transitEngine == null) "waiting-for-fix" else "location-degraded"
    fields["problem"] = problem; fields["canRetry"] = true; offRouteFixes = 0; arrivalFixes = 0
    speech?.flush(); publish()
  }
  private fun failAndStop(problem: String) {
    cleanup(clearCheckpoint = true)
    fields = mutableMapOf("sessionId" to fields["sessionId"], "status" to "error", "mode" to null,
      "voice" to "unavailable", "canRetry" to false, "problem" to problem)
    publish()
  }
  private fun cleanup(clearCheckpoint: Boolean) {
    lifetime.invalidate()
    if (clearCheckpoint) runCatching { store.clear() }
    scope?.cancel(); scope = null; routeJob = null; recovery.clear()
    runCatching { source?.stop() }; source = null
    runCatching { speech?.close() }; speech = null
    runCatching { engine?.close() }; engine = null
    transitEngine = null; transitPlan = null; transitOrigin = null; transitOriginChecked = false
    currentFixConfident = false; latestFix = null; target = null; spoken.clear(); offRouteFixes = 0; arrivalFixes = 0; reroutes.reset()
    val old = service; service = null; old?.finish()
  }
  private fun fixAge(fix: Location) = (SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000L
  private fun fixMap(fix: Location): Map<String, Any> = mutableMapOf<String, Any>("latitude" to fix.latitude,
    "longitude" to fix.longitude, "accuracyMeters" to fix.accuracy.toDouble(), "timestamp" to fix.time).apply {
      if (fix.hasBearing() && fix.bearing.isFinite() && fix.hasSpeed() && fix.speed.isFinite() && fix.speed >= 1f) put("bearing", fix.bearing.toDouble())
    }
  companion object {
    @Volatile private var instance: NavigationRuntime? = null
    fun get(context: Context): NavigationRuntime = instance ?: synchronized(this) {
      instance ?: NavigationRuntime(context.applicationContext).also { instance = it }
    }
  }
}
