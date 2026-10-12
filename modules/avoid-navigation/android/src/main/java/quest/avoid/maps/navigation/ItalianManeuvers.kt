package quest.avoid.maps.navigation

import java.util.Locale
import java.util.UUID
import org.json.JSONObject
import uniffi.ferrostar.Route
import uniffi.ferrostar.RouteStep
import uniffi.ferrostar.SpokenInstruction

/** Plain OSRM supplies maneuver facts, but no Italian text or voice prompts. */
object ItalianManeuvers {
  /** Ferrostar keeps the current step first; distanceToNextManeuver refers to step 1. */
  fun upcoming(remainingSteps: List<RouteStep>): Pair<String?, String?> =
    (remainingSteps.getOrNull(1)?.instruction ?: remainingSteps.firstOrNull()?.instruction) to
      remainingSteps.getOrNull(2)?.instruction

  fun adapt(route: Route, responseJson: String, mode: String): Route {
    require(mode in setOf("walk", "bicycle", "car")) { "Unsupported road mode" }
    val response = JSONObject(responseJson)
    require(response.optString("code") == "Ok") { "Invalid route response" }
    val legs = response.getJSONArray("routes").getJSONObject(0).getJSONArray("legs")
    val rawSteps = (0 until legs.length()).flatMap { leg ->
      val steps = legs.getJSONObject(leg).getJSONArray("steps")
      (0 until steps.length()).map { steps.getJSONObject(it) }
    }
    require(rawSteps.size == route.steps.size && rawSteps.isNotEmpty()) { "Route steps do not match" }
    val instructions = rawSteps.map(::instruction)
    val routeId = UUID.nameUUIDFromBytes(responseJson.toByteArray(Charsets.UTF_8))
    return route.copy(steps = route.steps.mapIndexed { index, step ->
      val prompts = mutableListOf<SpokenInstruction>()
      val next = instructions.getOrNull(index + 1)
      // A step's maneuver is at its beginning; its prompts announce the NEXT maneuver.
      if (next != null && step.distance.isFinite() && step.distance > 0) {
        val near = minOf(step.distance, when (mode) { "car" -> 35.0; "bicycle" -> 25.0; else -> 12.0 })
        val approach = minOf(step.distance, when (mode) { "car" -> 250.0; "bicycle" -> 150.0; else -> 80.0 })
        fun prompt(text: String, distance: Double, kind: String) = SpokenInstruction(
          text, null, distance,
          UUID.nameUUIDFromBytes("$routeId:$mode:$index:$kind".toByteArray(Charsets.UTF_8)),
        )
        if (approach >= near + 25) {
          val spokenDistance = (approach / 5).toInt() * 5
          prompts.add(prompt("Tra $spokenDistance metri, ${next.replaceFirstChar { it.lowercase(Locale.ITALIAN) }}", approach, "approach"))
        }
        prompts.add(prompt(next, near, "near"))
      }
      step.copy(instruction = instructions[index], visualInstructions = emptyList(), spokenInstructions = prompts)
    })
  }

  internal fun instruction(step: JSONObject): String {
    val maneuver = step.optJSONObject("maneuver") ?: JSONObject()
    val type = maneuver.optString("type")
    val modifier = maneuver.optString("modifier")
    val road = clean(step.optString("name"))
    val suffix = if (road.isEmpty()) "" else " su $road"
    val side = when (modifier) {
      "left", "slight left", "sharp left" -> "a sinistra"
      "right", "slight right", "sharp right" -> "a destra"
      else -> ""
    }
    val direction = when (modifier) {
      "left" -> "Svolta a sinistra"
      "right" -> "Svolta a destra"
      "slight left" -> "Svolta leggermente a sinistra"
      "slight right" -> "Svolta leggermente a destra"
      "sharp left" -> "Svolta nettamente a sinistra"
      "sharp right" -> "Svolta nettamente a destra"
      "uturn" -> "Fai inversione di marcia"
      else -> "Prosegui dritto"
    }
    return when (type) {
      "depart" -> "Parti$suffix"
      "arrive" -> if (side.isEmpty()) "Raggiungi la destinazione" else "La destinazione è $side"
      "roundabout", "rotary" -> {
        val exit = maneuver.optInt("exit", 0)
        if (exit in 1..99) "Alla rotatoria prendi l’uscita $exit$suffix" else "Entra nella rotatoria e segui il percorso indicato"
      }
      "roundabout turn" -> "Alla rotatoria ${direction.replaceFirstChar { it.lowercase(Locale.ITALIAN) }}$suffix"
      "exit roundabout", "exit rotary" -> "Esci dalla rotatoria$suffix"
      "fork" -> if (side.isEmpty()) "Al bivio segui il percorso indicato$suffix" else "Al bivio mantieni la ${if (side == "a sinistra") "sinistra" else "destra"}$suffix"
      "merge" -> "Immettiti${if (side.isEmpty()) "" else " $side"}$suffix"
      "on ramp" -> "Prendi la rampa${if (side.isEmpty()) "" else " $side"}$suffix"
      "off ramp" -> "Prendi l’uscita${if (side.isEmpty()) "" else " $side"}${clean(step.optString("ref")).let { if (it.isEmpty()) "" else " $it" }}$suffix"
      "end of road" -> "Alla fine della strada ${direction.replaceFirstChar { it.lowercase(Locale.ITALIAN) }}$suffix"
      "turn", "continue" -> direction + suffix
      "new name", "notification", "use lane" -> "Prosegui$suffix seguendo il percorso indicato"
      else -> "Segui il percorso indicato$suffix"
    }
  }

  private fun clean(value: String) = value.replace(Regex("[\\p{Cntrl}\\s]+"), " ").trim().take(160)
}
