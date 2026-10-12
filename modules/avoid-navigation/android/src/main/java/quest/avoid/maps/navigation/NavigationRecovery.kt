package quest.avoid.maps.navigation

/** Keeps provider/admission failures latched until the corresponding explicit user action. */
internal class NavigationRecovery {
  private enum class State { READY, ROAD_RETRY_REQUIRED, ROAD_RETRY_WAITING_FOR_FIX, TRANSIT_REPLAN_REQUIRED }
  private var state = State.READY
  val blocksFixProgress get() = state == State.ROAD_RETRY_REQUIRED || state == State.TRANSIT_REPLAN_REQUIRED
  val transitReplanRequired get() = state == State.TRANSIT_REPLAN_REQUIRED
  val manualRoutePending get() = state == State.ROAD_RETRY_WAITING_FOR_FIX
  fun roadFailed() { state = State.ROAD_RETRY_REQUIRED }
  fun transitAdmissionFailed() { state = State.TRANSIT_REPLAN_REQUIRED }
  fun requestRoadRetry() { if (!transitReplanRequired) state = State.ROAD_RETRY_WAITING_FOR_FIX }
  fun routeRequested() { state = State.READY }
  fun clear() { state = State.READY }
}
