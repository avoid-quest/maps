package quest.avoid.maps.navigation

import android.content.Context
import android.os.SystemClock
import expo.modules.kotlin.exception.CodedException
import java.io.IOException
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

internal class NavigationFailure(val reason: String) : CodedException(reason, reason, null)
internal data class RoadResponse(val responseJson: String, val fetchedAt: Long) {
  fun bridge(): Map<String, Any> = mapOf("responseJson" to responseJson, "fetchedAt" to fetchedAt)
}
internal data class Point(val latitude: Double, val longitude: Double) {
  fun bridge(): Map<String, Double> = mapOf("latitude" to latitude, "longitude" to longitude)
  fun valid() = latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0
  companion object {
    fun from(value: Map<String, Any?>): Point {
      val point = Point((value["latitude"] as? Number)?.toDouble() ?: Double.NaN,
        (value["longitude"] as? Number)?.toDouble() ?: Double.NaN)
      if (!point.valid()) throw NavigationFailure("invalid")
      return point
    }
  }
}

/** The only Android road HTTP owner, shared by previews, Start and service rerouting. */
internal class RoadRequestCoordinator(context: Context) {
  private val preferences = context.getSharedPreferences("navigation-provider-budget", Context.MODE_PRIVATE)
  private val jobs = ConcurrentHashMap<String, Job>()
  private val client = OkHttpClient.Builder().callTimeout(18, TimeUnit.SECONDS)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
  private val gate = RoadRequestGate(
    now = { SystemClock.elapsedRealtime() }, wait = { delay(it) },
    initialSpacingMs = (preferences.getLong("last-start-wall", 0L) + 1_100L - System.currentTimeMillis()).coerceIn(0, 1_100),
    initialCooldownMs = (preferences.getLong("blocked-until-wall", 0L) - System.currentTimeMillis()).coerceAtLeast(0),
    started = { preferences.edit().putLong("last-start-wall", System.currentTimeMillis()).commit() },
    blocked = { duration -> preferences.edit().putLong("blocked-until-wall", RoadRequestGate.deadline(System.currentTimeMillis(), duration)).commit() },
  )
  private val cancelled = linkedSetOf<String>()

  fun cancel(requestId: String) {
    synchronized(cancelled) {
      cancelled.add(requestId)
      while (cancelled.size > 256) cancelled.remove(cancelled.first())
    }
    jobs[requestId]?.cancel()
  }

  suspend fun request(requestId: String, from: Point, to: Point, mode: String): RoadResponse {
    if (requestId.isBlank() || requestId.length > 128) throw NavigationFailure("invalid")
    if (!from.valid() || !to.valid() || mode !in setOf("walk", "bicycle", "car")) throw NavigationFailure("invalid")
    val job = currentCoroutineContext()[Job] ?: throw NavigationFailure("unavailable")
    if (jobs.putIfAbsent(requestId, job) != null) throw NavigationFailure("invalid")
    try {
      if (synchronized(cancelled) { cancelled.remove(requestId) }) throw CancellationException()
      return gate.request {
        val profile = mapOf("walk" to "routed-foot", "bicycle" to "routed-bike", "car" to "routed-car").getValue(mode)
        val url = "https://routing.openstreetmap.de/$profile/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?steps=true&overview=full&geometries=polyline6&alternatives=false"
        val request = Request.Builder().url(url)
          .header("User-Agent", "AvoidMaps/0.1 (https://github.com/avoid-quest/maps)").build()
        execute(client.newCall(request))
      }
    } catch (_: RoadCooldown) { throw NavigationFailure("rate-limit")
    } catch (cancelled: CancellationException) { throw cancelled
    } finally { jobs.remove(requestId, job) }
  }

  private suspend fun execute(call: Call): RoadResponse = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        if (continuation.isActive) continuation.resumeWithException(NavigationFailure(if (e is java.io.InterruptedIOException) "timeout" else "network"))
      }
      override fun onResponse(call: Call, response: Response) {
        try {
          val result = response.use {
            if (it.code == 429) {
              val now = System.currentTimeMillis()
              val retry = it.header("Retry-After")
              val retryMs = retry?.takeIf { value -> value.isNotEmpty() && value.all(Char::isDigit) }?.let { value -> value.toLongOrNull() ?: Long.MAX_VALUE }?.let { seconds -> if (seconds > Long.MAX_VALUE / 1_000) Long.MAX_VALUE else seconds.coerceAtLeast(0) * 1_000 }
                ?: runCatching { ZonedDateTime.parse(retry, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - now }.getOrDefault(0L)
              val cooldown = maxOf(60_000L, retryMs)
              gate.blockFor(cooldown)
              throw NavigationFailure("rate-limit")
            }
            if (!it.isSuccessful) throw NavigationFailure("unavailable")
            val body = it.body ?: throw NavigationFailure("invalid")
            if (body.contentLength() > MAX_BODY_BYTES) throw NavigationFailure("invalid")
            val source = body.source()
            source.request(MAX_BODY_BYTES + 1)
            val bytes = source.buffer.readByteArray()
            if (bytes.size > MAX_BODY_BYTES) throw NavigationFailure("invalid")
            RoadResponse(bytes.toString(Charsets.UTF_8), System.currentTimeMillis())
          }
          if (continuation.isActive) continuation.resume(result)
        } catch (error: Exception) {
          if (continuation.isActive) continuation.resumeWithException(if (error is NavigationFailure) error else NavigationFailure("network"))
        }
      }
    })
  }

  companion object { private const val MAX_BODY_BYTES = 4_000_000L }
}
