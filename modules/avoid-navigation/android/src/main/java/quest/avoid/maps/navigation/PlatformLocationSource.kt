package quest.avoid.maps.navigation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat

/** Platform GPS only; no Play services and no cached location promoted to a fresh fix. */
internal class PlatformLocationSource(private val context: Context, private val update: (Location) -> Unit,
  private val problem: (String) -> Unit) : LocationListener {
  private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  fun start() {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      problem("location-permission"); return
    }
    if (LocationManager.GPS_PROVIDER !in manager.allProviders || !manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) { problem("location-disabled"); return }
    try { manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1_000L, 0f, this, Looper.getMainLooper())
    } catch (_: SecurityException) { problem("location-permission") }
  }
  fun stop() { manager.removeUpdates(this) }
  override fun onLocationChanged(location: Location) { update(location) }
  override fun onProviderDisabled(provider: String) { problem("location-disabled") }
  override fun onProviderEnabled(provider: String) { /* Existing GPS subscription resumes. */ }
  @Deprecated("Legacy Android callback")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
}
