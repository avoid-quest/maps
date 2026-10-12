package quest.avoid.maps.navigation

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.LockSupport
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class RoadRequestGateRaceTest {
  @Test fun `late cooldown update owns the final request reservation before transport can start`() {
    val cooldownUpdating = CountDownLatch(1)
    val finishCooldown = CountDownLatch(1)
    val requestChecking = CountDownLatch(1)
    val pauseCooldownClock = AtomicBoolean(true)
    val transportStarted = AtomicBoolean(false)
    val requestFailure = AtomicReference<Throwable?>()
    val cooldownFailure = AtomicReference<Throwable?>()
    val cooldownThread = AtomicReference<Thread?>()
    val requestThread = AtomicReference<Thread?>()
    val gate = RoadRequestGate(now = {
      if (Thread.currentThread() === cooldownThread.get() && pauseCooldownClock.compareAndSet(true, false)) {
        // blockFor already owns its monitor, but has not yet published the late 429 deadline.
        cooldownUpdating.countDown()
        check(finishCooldown.await(5, TimeUnit.SECONDS))
      }
      if (Thread.currentThread() === requestThread.get()) requestChecking.countDown()
      0L
    }, wait = { error("No spacing delay expected") })
    val cooldown = thread(start = false) {
      try { gate.blockFor(60_000) } catch (error: Throwable) { cooldownFailure.set(error) }
    }
    val request = thread(start = false) {
      try { runBlocking { gate.request { transportStarted.set(true) } } }
      catch (error: Throwable) { requestFailure.set(error) }
    }
    cooldownThread.set(cooldown)
    requestThread.set(request)
    try {
      cooldown.start()
      assertTrue(cooldownUpdating.await(5, TimeUnit.SECONDS))
      request.start()
      assertTrue(requestChecking.await(5, TimeUnit.SECONDS))
      // Wait for a concrete outcome, not a sleep that could hide the race on a slow runner:
      // the request either waits on this gate's reservation monitor or incorrectly finishes.
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
      while (request.isAlive) {
        if (request.state == Thread.State.BLOCKED) break
        check(System.nanoTime() < deadline) { "Request did not reach a reservation outcome" }
        LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(1))
      }
    } finally {
      finishCooldown.countDown()
      cooldown.join(5_000)
      request.join(5_000)
    }
    assertFalse(cooldown.isAlive)
    assertFalse(request.isAlive)
    assertNull(cooldownFailure.get())
    assertFalse(transportStarted.get())
    assertTrue(requestFailure.get() is RoadCooldown)
  }
}
