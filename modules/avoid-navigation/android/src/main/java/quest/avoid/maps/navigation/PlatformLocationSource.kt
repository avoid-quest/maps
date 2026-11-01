package quest.avoid.maps.navigation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Platform LocationManager only: GPS, the AOSP platform fused provider (API 31+) and the network
 * provider when the system offers them; each delivers fixes only while enabled. No Play services. Last-known fixes are seeded through the
 * same session policy, so an old cached position can never pass as a fresh fix.
 */
internal class PlatformLocationSource(private val context: Context, private val update: (Location) -> Unit,
  private val problem: (String) -> Unit) : LocationListener {
  private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private val registered = linkedSetOf<String>()
  fun start() {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      problem("location-permission"); return
    }
    val available = manager.allProviders
    // Every present provider is registered even while disabled: Android only reports enablement to
    // registered listeners, and a registration resumes delivering fixes when its provider returns.
    val candidates = buildList {
      add(LocationManager.GPS_PROVIDER)
      if (Build.VERSION.SDK_INT >= 31) add(LocationManager.FUSED_PROVIDER)
      add(LocationManager.NETWORK_PROVIDER)
    }.filter { it in available }
    try {
      for (provider in candidates) {
        manager.requestLocationUpdates(provider, 1_000L, 0f, this, Looper.getMainLooper())
        registered.add(provider)
      }
    } catch (_: SecurityException) { stop(); problem("location-permission"); return
    } catch (error: IllegalArgumentException) { Log.w(TAG, "source register-failed ${error.javaClass.simpleName}") }
    Log.i(TAG, "source providers=${registered.joinToString(",").ifEmpty { "none" }} enabled=${registered.filter(::enabled).joinToString(",").ifEmpty { "none" }}")
    if (registered.none(::enabled)) problem("location-disabled")
    // Seed with cached fixes; the session's age policy rejects anything older than its limit.
    val seeds = registered.mapNotNull { provider ->
      try { manager.getLastKnownLocation(provider) } catch (_: SecurityException) { null }
    }
    seeds.sortedBy { it.elapsedRealtimeNanos }.forEach { update(it) }
  }
  fun stop() { manager.removeUpdates(this); registered.clear() }
  private fun enabled(provider: String) = try { manager.isProviderEnabled(provider) } catch (_: IllegalArgumentException) { false }
  override fun onLocationChanged(location: Location) { update(location) }
  override fun onProviderDisabled(provider: String) {
    Log.i(TAG, "source disabled provider=$provider")
    if (registered.none(::enabled)) problem("location-disabled")
  }
  override fun onProviderEnabled(provider: String) { Log.i(TAG, "source enabled provider=$provider") }
  @Deprecated("Legacy Android callback")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
  companion object { const val TAG = "AvoidNav" }
}
