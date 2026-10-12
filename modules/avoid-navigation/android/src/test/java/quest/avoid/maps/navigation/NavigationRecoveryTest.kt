package quest.avoid.maps.navigation

import org.junit.Assert.*
import org.junit.Test

class NavigationRecoveryTest {
  @Test fun `provider failure remains latched through lost and recovered GPS until explicit Retry`() {
    val recovery = NavigationRecovery()
    recovery.roadFailed()
    // Fix loss/recovery has no transition: neither can authorize another HTTP request.
    assertTrue(recovery.blocksFixProgress)
    assertFalse(recovery.manualRoutePending)
    recovery.requestRoadRetry()
    assertFalse(recovery.blocksFixProgress)
    assertTrue(recovery.manualRoutePending)
    recovery.routeRequested()
    assertFalse(recovery.manualRoutePending)
  }
  @Test fun `invalid transit itinerary requires new selection even after retry or accurate fixes`() {
    val recovery = NavigationRecovery()
    recovery.transitAdmissionFailed()
    recovery.requestRoadRetry()
    assertTrue(recovery.blocksFixProgress)
    assertTrue(recovery.transitReplanRequired)
    recovery.clear() // A new explicit session uses the newly selected journey.
    assertFalse(recovery.blocksFixProgress)
  }
}
