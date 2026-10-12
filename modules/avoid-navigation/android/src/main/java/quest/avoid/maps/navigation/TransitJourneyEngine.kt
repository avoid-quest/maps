package quest.avoid.maps.navigation

data class TransitUpdate(
  val fields: Map<String, Any?>,
  val announcement: String? = null,
  val completed: Boolean = false,
)

/** Follows the selected itinerary locally. GPS never establishes boarding or alighting. */
class TransitJourneyEngine(
  plan: Map<String, Any?>,
  private val nowMs: () -> Long = System::currentTimeMillis,
) {
  private data class Point(val latitude: Double, val longitude: Double)
  private data class Leg(
    val index: Int, val transit: Boolean, val interline: Boolean,
    val line: String?, val headsign: String?, val from: String, val to: String,
    val start: Point?, val end: Point?, val distance: Double,
    val departure: Long, val arrival: Long, val timing: String,
  )
  private data class Segment(val legs: List<Leg>) {
    val first get() = legs.first()
    val last get() = legs.last()
    val transit get() = first.transit
    val lines get() = legs.mapNotNull { it.line }.distinct()
    val timing get() = legs.map { it.timing }.distinct().singleOrNull() ?: "unknown"
  }
  private val fetchedAt = number(plan["fetchedAt"]).toLong()
  private val source = text(plan["source"], 200)
  private val segments: List<Segment>
  private val legCount: Int
  private var segmentIndex = 0
  private var phase = "walk"
  private var position: Point? = null
  private var accuracy = 0.0
  private val announced = mutableSetOf<String>()
  private var lastConfirmation: Pair<String, Long>? = null

  init {
    require(plan["mode"] == "transit") { "Invalid transit mode" }
    val age = nowMs() - fetchedAt
    require(fetchedAt > 0 && age in 0..120_000) { "Transit plan must be refreshed" }
    val rawLegs = plan["legs"] as? List<*> ?: throw IllegalArgumentException("Missing transit legs")
    require(rawLegs.size in 1..64) { "Invalid transit leg count" }
    var pointCount = 0
    val legs = rawLegs.mapIndexed { index, raw ->
      val leg = raw as? Map<*, *> ?: throw IllegalArgumentException("Invalid transit leg")
      val transit = leg["transitLeg"] as? Boolean ?: throw IllegalArgumentException("Missing transit type")
      require(transit || leg["mode"] == "walk") { "Unsupported transfer mode" }
      val timing = text(leg["timingStatus"], 16)
      require(timing in setOf("scheduled", "prediction", "unknown")) { "Cancelled or invalid transit leg" }
      val geometry = leg["geometry"] as? List<*> ?: emptyList<Any?>()
      pointCount += geometry.size
      require(pointCount <= 100_000) { "Transit geometry is too large" }
      val points = geometry.map { point(it) ?: throw IllegalArgumentException("Invalid transit coordinate") }
      val start = stopPoint(leg["fromStop"]) ?: points.firstOrNull()
      val end = stopPoint(leg["toStop"]) ?: points.lastOrNull()
      val distance = number(leg["distanceMeters"])
      val duration = number(leg["durationSeconds"])
      val departure = number(leg["departureAt"]).toLong()
      val arrival = number(leg["arrivalAt"]).toLong()
      require(distance in 0.0..2_000_000.0 && duration in 0.0..604_800.0 && departure > 0 &&
        arrival >= departure && kotlin.math.abs((arrival - departure) / 1000.0 - duration) <= 1) { "Invalid transit timing" }
      Leg(index, transit, leg["interlineWithPreviousLeg"] == true,
        optionalText(leg["line"]), optionalText(leg["headsign"]), text(leg["from"]), text(leg["to"]),
        start, end, distance, departure, arrival, timing)
    }
    legs.zipWithNext().forEach { (before, after) ->
      require(after.departure >= before.arrival) { "Overlapping transit legs" }
      require(!after.interline || (before.transit && after.transit)) { "Invalid interline connection" }
    }
    require(legs.last().arrival >= nowMs() - 120_000) { "Transit itinerary has already ended" }
    require(!legs.first().interline) { "Invalid initial interline connection" }
    legCount = legs.size
    val grouped = mutableListOf<MutableList<Leg>>()
    for (leg in legs) {
      // Only the provider's explicit same-vehicle flag permits combining transit legs.
      if (leg.interline) grouped.last().add(leg) else grouped.add(mutableListOf(leg))
    }
    segments = grouped.map { Segment(it.toList()) }
    phase = startingPhase()
  }

  fun snapshot(): TransitUpdate = update()

  fun onLocation(latitude: Double, longitude: Double, accuracyMeters: Double): TransitUpdate {
    if (!NavigationGeometry.valid(latitude, longitude) || FixPolicy.problem(0, accuracyMeters, true) != null) {
      position = null
      return update()
    }
    position = Point(latitude, longitude)
    accuracy = accuracyMeters
    if (phase == "complete") return update()
    val segment = segments[segmentIndex]
    val targetDistance = distance(target())
    // Endpoint proximity cannot distinguish completion from an early pass around a loop.
    // Keep manual controls available and omit automatic end cues for this ambiguous case.
    val canPromptEnd = !ambiguousEndpoint(segment)
    var announcement: String? = null
    if (targetDistance != null) {
      val confidentlyNear = targetDistance + accuracy <= 75
      when (phase) {
        "board" -> if (confidentlyNear) announcement = once("board-near", "Sei vicino a ${segment.first.from}. Verifica linea e direzione; conferma solo dopo essere salito.")
        "walk", "transfer" -> if (confidentlyNear && canPromptEnd) announcement = once("walk-near", "Sei vicino a ${segment.last.to}. Controlla l’accesso e conferma quando hai completato il tratto a piedi.")
        "ride", "alight" -> if (canPromptEnd) {
          if (confidentlyNear) {
            phase = "alight"
            announcement = once("alight-near", "Sei vicino alla fermata ${segment.last.to}. Verifica la fermata e scendi quando il mezzo si ferma. Poi conferma la discesa.")
          } else if (targetDistance + accuracy <= 300) {
            announcement = once("alight-approach", "Ti stai avvicinando a ${segment.last.to}. Preparati a scendere e verifica gli annunci del mezzo.")
          }
        }
      }
    }
    if (announcement == null) announcement = once("initial", instruction())
    else announced.add("$segmentIndex:initial")
    return update(announcement)
  }

  fun confirm(action: String): TransitUpdate {
    val allowed = when (phase) {
      "board" -> "board"
      "ride", "alight" -> "alight"
      "walk", "transfer" -> "walk-complete"
      else -> null
    }
    if (action != allowed) return update()
    val now = nowMs()
    val previous = lastConfirmation
    if (previous != null && previous.first == action && now - previous.second in 0..999) return update()
    lastConfirmation = action to now
    if (action == "board") {
      phase = "ride"
      announced.remove("$segmentIndex:initial")
    } else {
      segmentIndex += 1
      phase = if (segmentIndex == segments.size) "complete" else startingPhase()
    }
    val announcement = instruction()
    announced.add("$segmentIndex:initial")
    return update(announcement)
  }

  private fun startingPhase(): String = when {
    segments[segmentIndex].transit -> "board"
    segmentIndex > 0 && segments.take(segmentIndex).any { it.transit } && segments.drop(segmentIndex + 1).any { it.transit } -> "transfer"
    else -> "walk"
  }

  private fun instruction(): String {
    if (phase == "complete") return "Viaggio completato"
    val segment = segments[segmentIndex]
    val line = segment.first.line?.let { " la linea $it" } ?: " il mezzo previsto"
    val direction = segment.first.headsign?.let { ", direzione $it" } ?: ""
    return when (phase) {
      "board" -> "Raggiungi ${segment.first.from} e prendi$line$direction. Conferma quando sei a bordo."
      "ride" -> "Resta a bordo fino a ${segment.last.to}. Conferma dopo essere sceso."
      "alight" -> "Fermata ${segment.last.to} vicina. Verifica la fermata e conferma dopo essere sceso."
      else -> "Raggiungi ${segment.last.to} a piedi seguendo il percorso sulla mappa. Conferma all’arrivo."
    }
  }

  private fun nextInstruction(): String? {
    if (phase == "complete") return null
    val segment = segments[segmentIndex]
    if (segment.legs.size > 1 && phase in setOf("board", "ride", "alight")) {
      return "Il viaggio prosegue sullo stesso mezzo${if (segment.lines.isEmpty()) "" else ": ${segment.lines.joinToString(" → ")}"}. Resta a bordo fino a ${segment.last.to}."
    }
    if (phase in setOf("ride", "alight") && ambiguousEndpoint(segment)) {
      return "Le fermate sono vicine: verifica gli annunci del mezzo e conferma dopo essere sceso."
    }
    if (phase == "board") return "Scendi a ${segment.last.to}."
    val next = segments.getOrNull(segmentIndex + 1) ?: return if (phase in setOf("ride", "alight")) "Conferma la discesa per completare il viaggio." else "Conferma l’arrivo per completare il viaggio."
    return if (next.transit) "Poi prendi ${next.first.line?.let { "la linea $it" } ?: "il mezzo previsto"} a ${next.first.from}."
      else "Poi raggiungi ${next.last.to} a piedi."
  }

  private fun update(announcement: String? = null): TransitUpdate {
    val complete = phase == "complete"
    val segment = segments[segmentIndex.coerceAtMost(segments.lastIndex)]
    val boarding = phase == "board"
    val alighting = phase == "ride" || phase == "alight"
    val walking = phase == "walk" || phase == "transfer"
    val transit = linkedMapOf<String, Any?>(
      "phase" to phase, "legIndex" to segment.first.index, "legCount" to legCount,
      "sourceLegIndices" to segment.legs.map { it.index },
      "line" to segment.lines.takeIf { it.isNotEmpty() }?.joinToString(" → "),
      "headsign" to segment.first.headsign, "from" to segment.first.from, "to" to segment.last.to,
      "departureAt" to segment.first.departure, "arrivalAt" to segment.last.arrival,
      "timingStatus" to segment.timing, "fetchedAt" to fetchedAt, "source" to source,
      "canConfirmBoarding" to boarding, "canConfirmAlighting" to alighting, "canConfirmWalking" to walking,
      "confirmation" to when { boarding -> "board"; alighting -> "alight"; walking -> "walk-complete"; else -> null },
      "proximityAvailable" to (!complete && target() != null && (boarding || !ambiguousEndpoint(segment))),
    )
    val fields = linkedMapOf<String, Any?>("instruction" to instruction(), "nextInstruction" to nextInstruction(), "transit" to transit)
    // This is direct GPS-to-stop distance, not a turn distance or route-matched progress.
    fields["distanceToManeuverMeters"] = if (complete) null else distance(target())
    return TransitUpdate(fields, announcement, complete)
  }

  private fun target(): Point? = if (phase == "complete") null else segments[segmentIndex].let {
    if (phase == "board") it.first.start else it.last.end
  }
  private fun once(key: String, text: String): String? = if (announced.add("$segmentIndex:$key")) text else null
  private fun ambiguousEndpoint(segment: Segment): Boolean {
    val start = segment.first.start ?: return false
    val end = segment.last.end ?: return false
    val direct = distance(start, end)
    return direct < 350 && segment.legs.sumOf { it.distance } > maxOf(300.0, direct * 2 + 100)
  }
  private fun distance(point: Point?): Double? = point?.let { target -> position?.let { distance(it, target) } }
  private fun distance(from: Point, to: Point) = NavigationGeometry.distance(from.latitude, from.longitude, to.latitude, to.longitude)

  private fun number(value: Any?): Double = (value as? Number)?.toDouble()?.takeIf { it.isFinite() }
    ?: throw IllegalArgumentException("Invalid transit number")
  private fun text(value: Any?, limit: Int = 300): String {
    val result = (value as? String)?.trim()
    require(!result.isNullOrEmpty() && result.length <= limit && result.none { it.isISOControl() }) { "Invalid transit text" }
    return result
  }
  private fun optionalText(value: Any?): String? = if (value == null) null else text(value)
  private fun point(value: Any?): Point? {
    if (value == null) return null
    val map = value as? Map<*, *> ?: throw IllegalArgumentException("Invalid transit point")
    val latitude = number(map["latitude"])
    val longitude = number(map["longitude"])
    require(NavigationGeometry.valid(latitude, longitude)) { "Invalid transit coordinate" }
    return Point(latitude, longitude)
  }
  private fun stopPoint(value: Any?): Point? {
    if (value == null) return null
    val stop = value as? Map<*, *> ?: throw IllegalArgumentException("Invalid transit stop")
    return point(stop["coordinate"])
  }
}
