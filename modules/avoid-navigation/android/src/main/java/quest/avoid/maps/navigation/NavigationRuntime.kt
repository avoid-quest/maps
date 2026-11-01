package quest.avoid.maps.navigation

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.UUID
import kotlin.math.roundToInt
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

/**
 * Main-thread session owner. React can disappear while this service-owned session continues.
 * Every state transition is logged under the fixed `AvoidNav` tag with codes only: no coordinates,
 * destinations, itinerary contents or raw native messages.
 */
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
  private var pendingServiceId: String? = null
  private var source: PlatformLocationSource? = null
  private var speech: NavigationSpeech? = null
  private var engine: FerrostarNavigationEngine? = null
  private var routeJob: Job? = null
  private val recovery = NavigationRecovery()
  private var admission: FixAdmission<Location>? = null
  private var fixPolicy: ModeFixPolicy = RoadGuidancePolicy.fix("walk")
  /** Latest fix accepted by the session policy; rejected fixes never replace it. */
  private var latestFix: Location? = null
  private var autoRouteRequested = false
  private var target: Point? = null
  private var mode = "walk"
  private var transitEngine: TransitJourneyEngine? = null
  private var transitPlan: Map<String, Any?>? = null
  private var transitOrigin: Point? = null
  private var offRouteFixes = 0
  private var arrivalFixes = 0
  private val reroutes = RerouteBudget()
  private val spoken = linkedSetOf<String>()
  private var loggedState: String? = null
  private var loggedFix: String? = null
  private var loggedFixAt = 0L
  private var publishedFixMetaAt = 0L

  init { store.read()?.let {
    fields["sessionId"] = it["sessionId"]; fields["mode"] = it["mode"]; fields["destination"] = it["destination"]
    fields["status"] = "interrupted"; fields["canRetry"] = true
  } }
  fun snapshot(): Map<String, Any?> = fields.filter { (key, value) -> value != null || key == "sessionId" || key == "mode" } +
    mapOf("revision" to revision, "notificationGranted" to notificationsGranted(), "locationUsable" to (admission?.confident == true))
  fun observe(listener: (Map<String, Any?>) -> Unit) { listeners.add(listener); listener(snapshot()) }
  fun unobserve(listener: (Map<String, Any?>) -> Unit) { listeners.remove(listener) }
  private fun publish() {
    revision++
    val current = snapshot()
    logTransition(current)
    val routeRevision = current["routeRevision"]
    val event = if (routeRevision != null && routeRevision == publishedRouteRevision) current - "route" else current
    publishedRouteRevision = routeRevision
    listeners.toList().forEach { it(event) }
  }
  private fun logTransition(current: Map<String, Any?>) {
    val state = "status=${current["status"]} problem=${current["problem"] ?: "none"} mode=${current["mode"] ?: "none"}" +
      " usable=${current["locationUsable"]} timedOut=${current["startTimedOut"] == true}" +
      " reducedStart=${current["reducedAccuracyStartMeters"] != null} reducedPrecision=${current["reducedPrecisionMeters"] != null} retry=${current["canRetry"]}"
    if (state == loggedState) return
    loggedState = state
    if (current["status"] == "error" || current["problem"] != null) Log.w(TAG, "state $state") else Log.i(TAG, "state $state")
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
    if (!fineLocation()) { Log.w(TAG, "start rejected location-permission"); throw NavigationFailure("location-permission") }
    stop(null)
    val id = UUID.randomUUID().toString()
    val starting = lifetime.begin()
    val token = starting.epoch
    target = destination; mode = travelMode; transitPlan = plan; transitOrigin = origin
    fixPolicy = RoadGuidancePolicy.fix(travelMode)
    Log.i(TAG, "session start mode=$travelMode notifications=${notificationsGranted()}")
    fields = mutableMapOf("sessionId" to id, "status" to "waiting-for-fix", "destination" to destination.bridge(),
      "mode" to mode, "voice" to "initializing", "canRetry" to false,
      "requiredAccuracyMeters" to if (travelMode == "transit") null else fixPolicy.startAccuracyMeters)
    try { store.save(id, destination, mode, plan, origin) } catch (error: Exception) {
      Log.e(TAG, "checkpoint failed ${error.javaClass.name}")
      fields["status"] = "error"; fields["problem"] = "native-error"; publish(); return snapshot()
    }
    pendingServiceId = id
    publish()
    try {
      val intent = Intent(context, NavigationService::class.java).setAction(NavigationService.START).putExtra("sessionId", id)
      ContextCompat.startForegroundService(context, intent)
      withTimeout(5_000) { starting.promoted.await() }
    } catch (error: Exception) {
      if (token == generation) { Log.e(TAG, "service start failed ${error.javaClass.name}"); failAndStop("service-unavailable") }
    }
    return snapshot()
  }

  fun ownsService(owner: NavigationService) = service === owner
  // A queued service launch may belong to a superseded Start. Only the latest explicit Start wins.
  fun pendingServiceSession(): String? = if (scope == null) pendingServiceId else null

  fun serviceStartFailed(id: String?) {
    if (id != null && id == pendingServiceId) failAndStop("service-unavailable")
  }

  /** Returns false when this start belongs to a superseded or stopped session. */
  fun serviceStarted(owner: NavigationService, id: String?): Boolean {
    if (id == null || id != pendingServiceId || scope != null) return false
    pendingServiceId = null
    service = owner
    val token = generation
    scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    speech = NavigationSpeech(context) { voice -> if (generation == token) { fields["voice"] = voice; publish() } }
    val now = SystemClock.elapsedRealtime()
    admission = FixAdmission(fixPolicy, now, startedImmediately = mode == "transit")
    if (mode != "transit") markWaiting(now)
    Log.i(TAG, "service promoted mode=$mode")
    if (mode == "transit") admitTransit()
    source = PlatformLocationSource(context, { fix -> if (generation == token) onFix(fix) },
      { problem -> if (generation == token) sourceProblem(problem) })
    source?.start()
    scope?.launch {
      while (true) {
        delay(1_000)
        if (generation != token) break
        tick()
      }
    }
    lifetime.promote(token)
    return true
  }

  fun serviceDestroyed(owner: NavigationService) {
    if (service !== owner) return
    Log.w(TAG, "service destroyed while active")
    cleanup(clearCheckpoint = false)
    fields = mutableMapOf<String, Any?>("sessionId" to fields["sessionId"], "mode" to fields["mode"],
      "destination" to fields["destination"], "status" to "interrupted", "voice" to "unavailable", "canRetry" to true)
    publish()
  }

  fun stop(sessionId: String?): Map<String, Any?> {
    if (sessionId != null && sessionId != fields["sessionId"]) return snapshot()
    val id = fields["sessionId"]
    if (scope != null || pendingServiceId != null) Log.i(TAG, "session stop")
    cleanup(clearCheckpoint = true)
    fields = mutableMapOf("sessionId" to id, "status" to if (id == null) "idle" else "stopped", "mode" to null,
      "voice" to "unavailable", "canRetry" to false)
    publish(); return snapshot()
  }

  suspend fun retry(id: String): Map<String, Any?> {
    if (id != fields["sessionId"]) return snapshot()
    if (fields["status"] == "interrupted") {
      Log.i(TAG, "retry resume")
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
    if (scope == null || recovery.transitReplanRequired || mode == "transit") return snapshot()
    val gate = admission ?: return snapshot()
    Log.i(TAG, "retry explicit engine=${engine != null} routing=${routeJob?.isActive == true}")
    if (routeJob?.isActive == true) return snapshot()
    // An explicit Retry is the only way, besides the bounded reroute budget, to request another route.
    if (autoRouteRequested) recovery.requestRoadRetry()
    val fix = latestFix
    if (gate.confident && fix != null && fixAge(fix) <= fixPolicy.maximumFixAgeMillis) {
      requestRoute(fix, engine != null); return snapshot()
    }
    val now = SystemClock.elapsedRealtime()
    if (engine == null) {
      gate.restartWaiting(now); markWaiting(now)
      fields["status"] = "waiting-for-fix"; fields.remove("problem"); fields["canRetry"] = false
      fields["requiredAccuracyMeters"] = fixPolicy.startAccuracyMeters
    } else {
      fields["status"] = "location-degraded"; fields["canRetry"] = true
      if (fields["problem"] == null) fields["problem"] = "location-stale"
    }
    source?.stop(); publish(); source?.start()
    return snapshot()
  }
  fun setMuted(id: String, muted: Boolean): Map<String, Any?> {
    if (id == fields["sessionId"]) speech?.mute(muted)
    return snapshot()
  }

  private fun markWaiting(nowElapsed: Long) {
    fields["waitingSinceMs"] = System.currentTimeMillis() - (SystemClock.elapsedRealtime() - nowElapsed)
    fields.remove("startTimedOut"); fields.remove("bestRejectedAccuracyMeters")
  }
  private val waitingForStart get() = admission?.started == false && engine == null && transitEngine == null

  private fun tick() {
    if (!fineLocation()) { if (fields["problem"] != "location-permission") { source?.stop(); sourceProblem("location-permission") }; return }
    val gate = admission ?: return
    when (val result = gate.onTick(SystemClock.elapsedRealtime())) {
      is FixAdmission.Tick.ReducedStart<*> -> {
        @Suppress("UNCHECKED_CAST")
        val fix = (result as FixAdmission.Tick.ReducedStart<Location>).fix
        Log.i(TAG, "start reduced-accuracy acc=${result.accuracyMeters.roundToInt()} source=retained")
        acceptFix(fix, reducedStart = true, reducedPrecision = result.accuracyMeters > fixPolicy.normalGuidanceAccuracyMeters)
      }
      is FixAdmission.Tick.StartTimeout -> {
        Log.w(TAG, "start-timeout problem=${result.problem} fixesSeen=${gate.fixesSeen} best=${result.bestRejectedAccuracyMeters?.roundToInt() ?: "none"}")
        if (recovery.blocksFixProgress || fields["status"] == "error") return
        // Settled terminal waiting: no spinner, Retry and Stop available, no flapping on later rejections.
        fields["status"] = "location-degraded"; fields["startTimedOut"] = true; fields["canRetry"] = true
        if (fields["problem"] !in setOf("location-disabled", "location-permission")) fields["problem"] = result.problem
        result.bestRejectedAccuracyMeters?.let { fields["bestRejectedAccuracyMeters"] = it.roundToInt() }
        publish()
      }
      is FixAdmission.Tick.Degraded -> { Log.w(TAG, "guidance degraded reason=no-accepted-fix"); degraded(result.problem) }
      null -> Unit
    }
  }

  private fun sourceProblem(problem: String) {
    admission?.lose()
    if (waitingForStart && routeJob?.isActive != true) {
      if (fields["problem"] == problem && fields["status"] == "location-degraded") return
      fields["status"] = "location-degraded"; fields["problem"] = problem; fields["canRetry"] = true
      publish(); return
    }
    degraded(problem)
  }

  private fun onFix(fix: Location) {
    val gate = admission ?: return
    val now = SystemClock.elapsedRealtime()
    val validCoordinate = NavigationGeometry.valid(fix.latitude, fix.longitude)
    val previous = latestFix
    var implausible = false
    if (previous != null && validCoordinate) {
      val seconds = (fix.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000_000.0
      val maximumSpeed = when (mode) { "transit" -> 110; "car" -> 75; "bicycle" -> 25; else -> 9 }
      implausible = seconds > 0 && seconds < 30 && previous.distanceTo(fix) > maximumSpeed * seconds + previous.accuracy + fix.accuracy
    }
    val age = fixAge(fix)
    val startPhase = !gate.started
    // Admission drops re-delivered samples (GPS + fused) before counting anything.
    val result = gate.onFix(now, fix.elapsedRealtimeNanos, age, fix.accuracy.toDouble(), fix.hasAccuracy() && validCoordinate, fix, implausible)
    if (result.outcome == FixAdmission.Outcome.DUPLICATE) return
    logFix(fix, age, result, now, startPhase)
    // Rejected fixes expose only accuracy and provider, never coordinates. Stale cached seeds
    // are not current signal and leave the readout unchanged.
    var metaChanged = false
    if (age in 0..fixPolicy.maximumFixAgeMillis) {
      val accuracy = if (fix.hasAccuracy() && fix.accuracy.isFinite()) fix.accuracy.roundToInt() else null
      val provider = providerCode(fix.provider)
      metaChanged = fields["lastFixAccuracyMeters"] != accuracy || fields["fixProvider"] != provider
      fields["lastFixAccuracyMeters"] = accuracy; fields["fixProvider"] = provider
    }
    if (waitingForStart && fields["problem"] == "location-disabled" && fields["startTimedOut"] != true && age <= fixPolicy.maximumFixAgeMillis) {
      // The provider came back: return to the active wait once, not on every fix.
      fields["status"] = "waiting-for-fix"; fields.remove("problem"); fields["canRetry"] = false; metaChanged = true
    }
    when (result.outcome) {
      FixAdmission.Outcome.ACCEPTED -> acceptFix(fix, result.reducedStart, result.reducedPrecision)
      FixAdmission.Outcome.DEGRADED -> degraded(result.problem ?: "location-inaccurate")
      FixAdmission.Outcome.DUPLICATE -> Unit
      FixAdmission.Outcome.RECOVERING, FixAdmission.Outcome.REJECTED ->
        if (metaChanged || now - publishedFixMetaAt >= 2_000) { publishedFixMetaAt = now; publish() }
    }
  }

  private fun logFix(fix: Location, age: Long, result: FixAdmission.Result, now: Long, startPhase: Boolean) {
    val outcome = result.outcome.name.lowercase() + (result.problem?.let { ":$it" } ?: "") +
      (if (result.reducedStart) ":reduced-start" else "") + (if (result.reducedPrecision) ":reduced-precision" else "")
    val key = "${providerCode(fix.provider)}|$outcome|${admission?.confident}"
    // Every non-accepted sample is logged, so hysteresis counts can be read off directly;
    // repeated identical accepted samples are summarised every 5 s.
    if (result.outcome == FixAdmission.Outcome.ACCEPTED && key == loggedFix && now - loggedFixAt < 5_000) return
    loggedFix = key; loggedFixAt = now
    val accuracy = if (fix.hasAccuracy() && fix.accuracy.isFinite()) fix.accuracy.roundToInt().toString() else "none"
    val gate = admission
    val phase = if (startPhase) "start" else "guidance"
    val limit = (if (startPhase) fixPolicy.startAccuracyMeters else fixPolicy.maximumGuidanceAccuracyMeters).roundToInt()
    val normal = (if (startPhase) fixPolicy.reducedStartAccuracyMeters else fixPolicy.normalGuidanceAccuracyMeters).roundToInt()
    // In the start phase `normal` is the reduced-start bound; in guidance it is the label threshold.
    Log.i(TAG, "fix phase=$phase provider=${providerCode(fix.provider)} acc=$accuracy limit=$limit normal=$normal ageS=${age / 1_000} " +
      "outcome=$outcome usable=${gate?.confident == true} rejectedRun=${gate?.consecutiveRejected ?: 0} seen=${gate?.fixesSeen ?: 0} dupSkipped=${gate?.duplicatesSkipped ?: 0}")
  }
  private fun providerCode(provider: String?) = when (provider) {
    LocationManager.GPS_PROVIDER -> "gps"; LocationManager.NETWORK_PROVIDER -> "network"; "fused" -> "fused"; else -> "other"
  }

  private fun acceptFix(fix: Location, reducedStart: Boolean, reducedPrecision: Boolean) {
    latestFix = Location(fix)
    fields["location"] = fixMap(fix)
    if (reducedStart) fields["reducedAccuracyStartMeters"] = fix.accuracy.roundToInt()
    // Guidance continues up to the maximum; worse-than-normal precision is labelled, not hidden.
    if (reducedPrecision) fields["reducedPrecisionMeters"] = fix.accuracy.roundToInt()
    else { fields.remove("reducedPrecisionMeters"); if (!reducedStart) fields.remove("reducedAccuracyStartMeters") }
    if (mode != "transit") fields["requiredAccuracyMeters"] = fixPolicy.maximumGuidanceAccuracyMeters
    fields.remove("startTimedOut")
    if (fields["problem"] in LOCATION_PROBLEMS) fields.remove("problem")
    if (recovery.blocksFixProgress) { publish(); return }
    if (mode == "transit") { updateTransit(fix); return }
    if (recovery.manualRoutePending) { requestRoute(fix, engine != null); return }
    if (routeJob?.isActive == true) { publish(); return }
    val activeEngine = engine
    if (activeEngine == null) {
      // One automatic start request per session. Later requests need Retry or the reroute budget.
      if (!autoRouteRequested && fields["status"] != "error") { autoRouteRequested = true; requestRoute(fix, false) }
      else publish()
      return
    }
    try { handleProgress(activeEngine.update(fix), fix, initial = false) } catch (error: Throwable) { engineFailed("update", error) }
  }

  private fun handleProgress(state: TripState, fix: Location, initial: Boolean) {
    when (state) {
      is TripState.Navigating -> {
        // Only tight fixes judge deviation: coarse fixes neither declare, clear nor count off-route,
        // so a poor signal can never trigger a reroute.
        val judged = fix.hasAccuracy() && fix.accuracy <= fixPolicy.deviationAccuracyMeters.toFloat()
        val offRoute = if (judged) state.deviation is RouteDeviation.Deviation else fields["status"] == "off-route"
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
          if (judged) offRouteFixes++
          speech?.flush()
          if (judged && offRouteFixes >= 3) {
            if (reroutes.tryAcquire(SystemClock.elapsedRealtime(), fix.latitude, fix.longitude)) requestRoute(fix, true)
            else fields["problem"] = "reroute-limit"
          }
        } else {
          if (judged) offRouteFixes = 0
          state.spokenInstruction?.let { instruction ->
            val utterance = instruction.utteranceId.toString()
            if (utterance !in spoken && speech?.speak(instruction.text, utterance) == true) spoken.add(utterance)
          }
        }
        publish()
      }
      is TripState.Complete -> {
        val destination = engine?.route?.geometry?.lastOrNull()
        if (initial || destination == null) {
          Log.i(TAG, "route complete-at-start")
          arrive("Sei già vicino alla destinazione", destination?.let { Point(it.lat, it.lng) })
          return
        }
        val result = FloatArray(1)
        Location.distanceBetween(fix.latitude, fix.longitude, destination.lat, destination.lng, result)
        if (fix.accuracy <= fixPolicy.maximumGuidanceAccuracyMeters.toFloat() && result[0] <= RoadGuidancePolicy.arrivalRadiusMeters.toFloat()) arrivalFixes++ else arrivalFixes = 0
        if (arrivalFixes >= 2) { arrive("Arrivo al termine del percorso", Point(destination.lat, destination.lng)); return }
        // Awaiting a second confirming fix: guidance continues; this is not a positioning problem.
        fields["status"] = "navigating"; fields.remove("problem"); fields["canRetry"] = false
        fields["instruction"] = "Stai arrivando a destinazione"; fields.remove("nextInstruction")
        fields["distanceRemainingMeters"] = result[0].toDouble()
        publish()
      }
      is TripState.Idle -> {
        Log.e(TAG, "route engine-idle initial=$initial")
        runCatching { engine?.close() }; engine = null
        recovery.roadFailed(); speech?.flush()
        fields["status"] = "error"; fields["problem"] = "route-not-started"; fields["canRetry"] = true
        fields.remove("route"); fields.remove("routeRevision")
        publish()
      }
    }
  }

  private fun arrive(instruction: String, routeEnd: Point?) {
    val destinationDistance = routeEnd?.let { end -> target?.let { selected ->
      FloatArray(1).also { Location.distanceBetween(end.latitude, end.longitude, selected.latitude, selected.longitude, it) }[0].toDouble()
    } }
    cleanup(clearCheckpoint = true)
    fields = mutableMapOf("sessionId" to fields["sessionId"], "status" to "arrived", "mode" to mode,
      "voice" to "unavailable", "canRetry" to false, "instruction" to instruction,
      "destinationDistanceMeters" to destinationDistance)
    publish()
  }

  fun confirmTransit(id: String, action: String): Map<String, Any?> {
    if (id != fields["sessionId"] || mode != "transit") return snapshot()
    // Manual following never depends on GPS: confirmations work during GPS loss.
    try { transitEngine?.confirm(action)?.let { Log.i(TAG, "transit confirm action=$action"); applyTransit(it) } } catch (_: IllegalArgumentException) { /* Invalid transition leaves the journey unchanged. */ }
    return snapshot()
  }

  /** Manual transit following starts without a position fix; only a cancelled or invalid plan needs replanning. */
  private fun admitTransit() {
    val plan = transitPlan ?: return
    try {
      val journey = TransitJourneyEngine(plan)
      transitEngine = journey
      val fetchedAt = (plan["fetchedAt"] as? Number)?.toLong() ?: 0
      val wallNow = System.currentTimeMillis()
      Log.i(TAG, "transit admitted ageMin=${(wallNow - fetchedAt) / 60_000} expired=${journey.journeyArrivalAt < wallNow - 60_000}" +
        " missed=${journey.nextBoardingAt()?.let { it < wallNow - 60_000 } ?: false}")
      fields["routeRevision"] = ++routeSequence
      fields["route"] = mapOf("geometry" to (plan["geometry"] ?: emptyList<Any>()), "source" to "MATO / 5T", "fetchedAt" to fetchedAt)
      applyTransit(journey.snapshot())
    } catch (error: IllegalArgumentException) {
      Log.w(TAG, "transit admission rejected")
      recovery.transitAdmissionFailed()
      fields["status"] = "error"; fields["problem"] = "transit-replan-needed"; fields["canRetry"] = false
      speech?.flush(); publish()
    }
  }

  private fun updateTransit(fix: Location) {
    if (recovery.transitReplanRequired) { publish(); return }
    transitEngine?.onLocation(fix.latitude, fix.longitude, fix.accuracy.toDouble())?.let { applyTransit(it) } ?: publish()
  }
  private fun applyTransit(update: TransitUpdate) {
    fields.putAll(update.fields)
    // GPS only drives advisory proximity; following continues with or without a usable fix.
    fields["status"] = "navigating"
    if (fields["problem"] in LOCATION_PROBLEMS && admission?.confident == true) fields.remove("problem")
    fields["canRetry"] = false
    update.announcement?.let { speech?.speak(it, UUID.randomUUID().toString()) }
    if (update.completed) {
      Log.i(TAG, "transit complete")
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
    Log.i(TAG, "route request replacing=$replacing")
    fields["status"] = if (replacing) "rerouting" else "routing"
    fields.remove("problem"); fields["canRetry"] = false; speech?.flush(); publish()
    routeJob = sessionScope.launch {
      val response = try {
        road.request("session:$token:${UUID.randomUUID()}", Point(fix.latitude, fix.longitude), destination, mode)
      } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled
      } catch (failure: NavigationFailure) {
        if (generation == token) routeFailed(failure.reason); return@launch
      } catch (error: Throwable) {
        if (generation == token) { Log.e(TAG, "route request failed ${error.javaClass.name}"); routeFailed("network") }; return@launch
      }
      if (generation != token) return@launch
      // Never discard a successful route because of a transient rejected fix. Use the latest
      // accepted fix when fresh; otherwise install guidance with a degraded-location status.
      val latest = latestFix ?: fix
      val fresh = admission?.confident == true && fixAge(latest) <= fixPolicy.maximumFixAgeMillis
      val next = try { FerrostarNavigationEngine(response.responseJson, mode, latest) }
      catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
      catch (failure: NavigationFailure) { if (generation == token) routeFailed(failure.reason); return@launch }
      catch (error: Throwable) { if (generation == token) engineFailed("create", error); return@launch }
      if (generation != token) { next.close(); return@launch }
      engine?.close(); engine = next; spoken.clear(); offRouteFixes = 0
      Log.i(TAG, "route installed fresh=$fresh steps=${next.route.steps.size}")
      fields["routeRevision"] = ++routeSequence
      fields["route"] = mapOf("geometry" to next.route.geometry.map { Point(it.lat, it.lng).bridge() },
        "source" to "FOSSGIS / OpenStreetMap", "fetchedAt" to response.fetchedAt)
      if (!fresh) {
        fields["status"] = "location-degraded"; fields["canRetry"] = true
        fields["problem"] = if (fixAge(latest) > fixPolicy.maximumFixAgeMillis) "location-stale" else "location-inaccurate"
        publish(); return@launch
      }
      try { handleProgress(next.update(latest), latest, initial = true) } catch (error: Throwable) { engineFailed("update", error) }
    }
  }

  private fun routeFailed(reason: String) {
    val problem = when (reason) {
      "rate-limit" -> "rate-limit"; "invalid" -> "route-invalid"; "timeout" -> "route-timeout"
      "network" -> "route-network"; else -> "route-unavailable"
    }
    Log.w(TAG, "route failed problem=$problem")
    recovery.roadFailed()
    fields["status"] = "error"; fields["problem"] = problem
    fields["canRetry"] = true; speech?.flush(); publish()
  }
  private fun engineFailed(stage: String, error: Throwable) {
    // Class name only: native messages can contain request or route content.
    Log.e(TAG, "engine $stage failed ${error.javaClass.name}")
    failAndStop("engine-unavailable")
  }
  private fun degraded(problem: String) {
    admission?.lose()
    fields.remove("distanceToManeuverMeters")
    offRouteFixes = 0; arrivalFixes = 0; speech?.flush()
    if (mode == "transit") {
      transitEngine?.positionLost()?.let { fields.putAll(it.fields) }
      if (!recovery.transitReplanRequired) fields["problem"] = problem
      publish(); return
    }
    if (recovery.blocksFixProgress || fields["status"] == "error" || routeJob?.isActive == true) { publish(); return }
    fields["status"] = "location-degraded"
    fields["problem"] = problem; fields["canRetry"] = true
    publish()
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
    scope?.cancel(); scope = null; routeJob = null; recovery.clear(); pendingServiceId = null
    runCatching { source?.stop() }; source = null
    runCatching { speech?.close() }; speech = null
    runCatching { engine?.close() }; engine = null
    transitEngine = null; transitPlan = null; transitOrigin = null; admission = null; autoRouteRequested = false
    latestFix = null; target = null; spoken.clear(); offRouteFixes = 0; arrivalFixes = 0; reroutes.reset()
    val old = service; service = null; old?.finish()
  }
  private fun fixAge(fix: Location) = (SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000L
  private fun fixMap(fix: Location): Map<String, Any> = mutableMapOf<String, Any>("latitude" to fix.latitude,
    "longitude" to fix.longitude, "accuracyMeters" to fix.accuracy.toDouble(), "timestamp" to fix.time).apply {
      if (fix.hasBearing() && fix.bearing.isFinite() && fix.hasSpeed() && fix.speed.isFinite() && fix.speed >= 1f) put("bearing", fix.bearing.toDouble())
    }
  companion object {
    const val TAG = "AvoidNav"
    private val LOCATION_PROBLEMS = setOf("location-permission", "location-disabled", "location-stale", "location-inaccurate", "location-unavailable")
    @Volatile private var instance: NavigationRuntime? = null
    fun get(context: Context): NavigationRuntime = instance ?: synchronized(this) {
      instance ?: NavigationRuntime(context.applicationContext).also { instance = it }
    }
  }
}
