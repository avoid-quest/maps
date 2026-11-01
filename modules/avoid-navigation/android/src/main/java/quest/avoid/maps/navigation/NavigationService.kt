package quest.avoid.maps.navigation

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/** Explicit start only; Android/process death never resurrects a navigation session. */
internal class NavigationService : Service() {
  private var active = false
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val runtime = NavigationRuntime.get(this)
    if (intent?.action == STOP) {
      val id = intent.getStringExtra("sessionId")
      if (id != null) runtime.stop(id)
      if (!runtime.ownsService(this)) finish()
      return START_NOT_STICKY
    }
    // Every non-Stop command may come from startForegroundService: Android requires startForeground
    // before any early return, including superseded or unknown starts, or the app is killed.
    val sessionId = intent?.getStringExtra("sessionId")
    if (!promote(runtime.pendingServiceSession() ?: sessionId)) {
      runtime.serviceStartFailed(sessionId)
      if (!runtime.ownsService(this)) stopSelf(startId)
      return START_NOT_STICKY
    }
    if (runtime.ownsService(this)) return START_NOT_STICKY
    // A superseded start stops only up to its own start ID, so a newer queued Start still runs.
    if (intent?.action != START || !runtime.serviceStarted(this, sessionId)) finish(startId)
    return START_NOT_STICKY
  }
  private fun promote(sessionId: String?): Boolean = try {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL,
      "Navigazione", NotificationManager.IMPORTANCE_LOW).apply { lockscreenVisibility = Notification.VISIBILITY_PRIVATE })
    val open = packageManager.getLaunchIntentForPackage(packageName)?.apply { addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP) }
    val stop = Intent(this, NavigationService::class.java).setAction(STOP).putExtra("sessionId", sessionId)
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_menu_directions).setContentTitle("Navigazione attiva")
      .setContentText("Tocca per aprire Avoid Maps o interrompi la navigazione.")
      .setOngoing(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Interrompi",
        PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    if (open != null) notification.setContentIntent(PendingIntent.getActivity(this, 1, open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    ServiceCompat.startForeground(this, 3101, notification.build(),
      if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
    active = true
    true
  } catch (error: Exception) {
    Log.e(NavigationRuntime.TAG, "service startForeground failed ${error.javaClass.name}")
    false
  }
  fun finish(startId: Int? = null) {
    if (active) { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); active = false }
    if (startId != null) stopSelf(startId) else stopSelf()
  }
  override fun onDestroy() { NavigationRuntime.get(this).serviceDestroyed(this); super.onDestroy() }
  companion object {
    const val START = "quest.avoid.maps.navigation.START"
    const val STOP = "quest.avoid.maps.navigation.STOP"
    const val CHANNEL = "avoid_navigation"
  }
}
