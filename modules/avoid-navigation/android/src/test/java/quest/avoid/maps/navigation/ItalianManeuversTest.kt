package quest.avoid.maps.navigation

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.ferrostar.BoundingBox
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.Route
import uniffi.ferrostar.RouteStep

class ItalianManeuversTest {
  private fun step(type: String, modifier: String = "", name: String = "", exit: Int? = null): JSONObject =
    JSONObject().put("name", name).put("maneuver", JSONObject().put("type", type).put("modifier", modifier).apply {
      exit?.let { put("exit", it) }
    })

  @Test fun maneuversUseItalianFactsAndAvoidInventingUnknownTurns() {
    val cases = listOf(
      step("turn", "left", "Via Roma") to "Svolta a sinistra su Via Roma",
      step("continue", "uturn") to "Fai inversione di marcia",
      step("fork", "slight right") to "Al bivio mantieni la destra",
      step("merge", "left") to "Immettiti a sinistra",
      step("roundabout", exit = 3) to "Alla rotatoria prendi l’uscita 3",
      step("rotary", exit = 2) to "Alla rotatoria prendi l’uscita 2",
      step("roundabout") to "Entra nella rotatoria e segui il percorso indicato",
      step("roundabout turn", "left") to "Alla rotatoria svolta a sinistra",
      step("exit rotary", name = "Corso Francia") to "Esci dalla rotatoria su Corso Francia",
      step("arrive", "right") to "La destinazione è a destra",
      step("unknown future type", "left") to "Segui il percorso indicato",
    )
    cases.forEach { (raw, expected) -> assertEquals(expected, ItalianManeuvers.instruction(raw)) }
  }

  @Test fun approachPromptsReferToNextManeuverAndKeepStableDistinctIds() {
    val rawSteps = listOf(step("depart"), step("turn", "right"), step("arrive"))
    val json = response(rawSteps)
    val original = route(listOf(300.0, 15.0, 0.0))
    val adapted = ItalianManeuvers.adapt(original, json, "walk")
    assertEquals("Parti", adapted.steps[0].instruction)
    assertEquals(listOf("Tra 80 metri, svolta a destra", "Svolta a destra"), adapted.steps[0].spokenInstructions.map { it.text })
    assertEquals(listOf(80.0, 12.0), adapted.steps[0].spokenInstructions.map { it.triggerDistanceBeforeManeuver })
    assertEquals(listOf("Raggiungi la destinazione"), adapted.steps[1].spokenInstructions.map { it.text })
    assertTrue(adapted.steps[2].spokenInstructions.isEmpty())
    val ids = adapted.steps.flatMap { it.spokenInstructions }.map { it.utteranceId }
    assertEquals(ids.size, ids.toSet().size)
    assertEquals(ids, ItalianManeuvers.adapt(original, json, "walk").steps.flatMap { it.spokenInstructions }.map { it.utteranceId })
    assertEquals("Original English", original.steps[0].instruction)
    assertTrue(original.steps.all { it.spokenInstructions.isEmpty() })
  }

  @Test fun allRoadModesHaveBoundedPromptsAndMismatchFailsClosed() {
    val json = response(listOf(step("depart"), step("arrive")))
    mapOf("walk" to 80.0, "bicycle" to 150.0, "car" to 250.0).forEach { (mode, approach) ->
      val spoken = ItalianManeuvers.adapt(route(listOf(400.0, 0.0)), json, mode).steps.first().spokenInstructions
      assertEquals(approach, spoken.first().triggerDistanceBeforeManeuver, 0.001)
      assertTrue(spoken.all { it.triggerDistanceBeforeManeuver in 0.0..400.0 })
      val short = ItalianManeuvers.adapt(route(listOf(2.0, 0.0)), json, mode).steps.first().spokenInstructions
      assertEquals(1, short.size)
      assertEquals(2.0, short.single().triggerDistanceBeforeManeuver, 0.0)
    }
    assertThrows(IllegalArgumentException::class.java) { ItalianManeuvers.adapt(route(listOf(2.0)), json, "walk") }
    assertThrows(IllegalArgumentException::class.java) { ItalianManeuvers.adapt(route(listOf(2.0, 0.0)), json, "transit") }
  }

  @Test fun distanceBannerShowsUpcomingManeuverRatherThanTheCurrentStepsDeparture() {
    val adapted = ItalianManeuvers.adapt(route(listOf(300.0, 200.0, 100.0, 0.0)), response(listOf(
      step("depart"), step("turn", "right"), step("roundabout", exit = 3), step("arrive"),
    )), "car")
    assertEquals("Svolta a destra" to "Alla rotatoria prendi l’uscita 3", ItalianManeuvers.upcoming(adapted.steps))
    assertEquals("Alla rotatoria prendi l’uscita 3" to "Raggiungi la destinazione", ItalianManeuvers.upcoming(adapted.steps.drop(1)))
    assertEquals("Raggiungi la destinazione" to null, ItalianManeuvers.upcoming(adapted.steps.drop(2)))
    assertEquals("Raggiungi la destinazione" to null, ItalianManeuvers.upcoming(adapted.steps.drop(3)))
    assertEquals(null to null, ItalianManeuvers.upcoming(emptyList()))
  }

  private fun response(steps: List<JSONObject>): String = JSONObject().put("code", "Ok")
    .put("routes", JSONArray().put(JSONObject().put("legs", JSONArray().put(JSONObject().put("steps", JSONArray(steps)))))).toString()

  private fun route(distances: List<Double>): Route {
    val coordinate = GeographicCoordinate(45.0, 7.0)
    return Route(listOf(coordinate), BoundingBox(coordinate, coordinate), distances.sum(), emptyList(), distances.map { distance ->
      RouteStep(listOf(coordinate), distance, distance, null, emptyList(), "Original English", emptyList(), emptyList(), null, emptyList(), null, null)
    })
  }
}
