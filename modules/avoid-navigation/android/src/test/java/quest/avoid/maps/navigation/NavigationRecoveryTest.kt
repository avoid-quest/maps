package quest.avoid.maps.navigation

import org.junit.Assert.*
import org.junit.Test

class NavigationRecoveryTest {
  @Test fun `road failure blocks fix progress until explicit road retry`() {
    val recovery = NavigationRecovery()
    recovery.roadFailed()
    // This policy test covers the recovery latch, not runtime fix callbacks.
    assertTrue(recovery.blocksFixProgress)
    assertFalse(recovery.manualRoutePending)
    recovery.requestRoadRetry()
    assertFalse(recovery.blocksFixProgress)
    assertTrue(recovery.manualRoutePending)
    recovery.routeRequested()
    assertFalse(recovery.manualRoutePending)
  }
  @Test fun `road retry does not clear the transit replan requirement`() {
    val recovery = NavigationRecovery()
    recovery.transitAdmissionFailed()
    recovery.requestRoadRetry()
    assertTrue(recovery.blocksFixProgress)
    assertTrue(recovery.transitReplanRequired)
    recovery.clear() // A new explicit session uses the newly selected journey.
    assertFalse(recovery.blocksFixProgress)
  }
}
