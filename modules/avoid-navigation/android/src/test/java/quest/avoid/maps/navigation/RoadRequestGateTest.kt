package quest.avoid.maps.navigation

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class RoadRequestGateTest {
  @Test fun `preview and reroute share one in-flight transport and start spacing`() = runBlocking {
    var clock = 0L
    val starts = mutableListOf<Long>()
    val firstResponse = CompletableDeferred<Unit>()
    val gate = RoadRequestGate({ clock }, { clock += it })
    val preview = async { gate.request { starts.add(clock); firstResponse.await(); "preview" } }
    yield()
    val reroute = async { gate.request { starts.add(clock); "reroute" } }
    yield()
    assertEquals(listOf(0L), starts)
    firstResponse.complete(Unit)
    assertEquals("preview", preview.await()); assertEquals("reroute", reroute.await())
    assertEquals(listOf(0L, 1_100L), starts)
  }

  @Test fun `failed transport still reserves spacing and early timer wake is checked`() = runBlocking {
    var clock = 0L; var wakes = 0
    val gate = RoadRequestGate({ clock }, { duration -> wakes++; clock += if (wakes == 1) duration / 2 else duration })
    try { gate.request<Unit> { throw IllegalStateException("synthetic") } } catch (_: IllegalStateException) { }
    gate.request { assertEquals(1_100L, clock) }
    assertEquals(2, wakes)
  }

  @Test fun `cancelled queued preview never starts a transport or consumes another slot`() = runBlocking {
    var clock = 0L; var starts = 0
    val release = CompletableDeferred<Unit>()
    val gate = RoadRequestGate({ clock }, { clock += it })
    val active = launch { gate.request { starts++; release.await() } }
    yield()
    val cancelled = launch { gate.request { starts++ } }
    yield(); cancelled.cancelAndJoin(); release.complete(Unit); active.join()
    gate.request { starts++ }
    assertEquals(2, starts); assertEquals(1_100L, clock)
  }

  @Test fun `late rate limit from cancelled response blocks a request already waiting for spacing`() = runBlocking {
    var clock = 0L; var starts = 0
    val waiting = CompletableDeferred<Unit>(); val wake = CompletableDeferred<Unit>()
    val gate = RoadRequestGate({ clock }, { waiting.complete(Unit); wake.await() })
    gate.request { starts++ }
    val next = async { try { gate.request { starts++ }; false } catch (_: RoadCooldown) { true } }
    waiting.await()
    gate.blockFor(60_000)
    clock = 1_100; wake.complete(Unit)
    assertTrue(next.await()); assertEquals(1, starts)
  }

  @Test fun `cooldown is persisted and a late shorter limit cannot shorten it`() = runBlocking {
    var clock = 2_000L
    var persisted = 0L
    val gate = RoadRequestGate({ clock }, { clock += it }, blocked = { persisted = it })
    gate.blockFor(172_800_000)
    assertEquals(172_800_000L, persisted)
    gate.blockFor(60_000)
    assertEquals(172_800_000L, persisted)
    try { gate.request { fail("Must not call provider in cooldown") }; fail("Expected cooldown") } catch (_: RoadCooldown) { }
    clock += 172_800_000
    gate.request { }
  }

  @Test fun `restored cooldown is enforced without wall clock assumptions`() = runBlocking {
    var clock = 25L
    val gate = RoadRequestGate({ clock }, { clock += it }, initialSpacingMs = 1_100, initialCooldownMs = 60_000)
    try { gate.request { fail("Cooldown") }; fail("Expected cooldown") } catch (_: RoadCooldown) { }
    clock += 60_000
    gate.request { assertEquals(60_025L, clock) }
  }

  @Test fun `restored spacing delays the first request without a cooldown`() = runBlocking {
    var clock = 25L
    val waits = mutableListOf<Long>()
    val gate = RoadRequestGate({ clock }, { waits.add(it); clock += it }, initialSpacingMs = 1_100)
    gate.request { assertEquals(1_125L, clock) }
    assertEquals(listOf(1_100L), waits)
  }

  @Test fun `overflowing provider duration remains a cooldown`() {
    assertEquals(Long.MAX_VALUE, RoadRequestGate.deadline(1_000, Long.MAX_VALUE))
  }
}
