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
    if (intent?.action != START) { finish(); return START_NOT_STICKY }
    if (runtime.ownsService(this)) return START_NOT_STICKY
    val sessionId = runtime.pendingServiceSession()
    try {
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
      runtime.serviceStarted(this, sessionId)
    } catch (_: Exception) { finish() }
    return START_NOT_STICKY
  }
  fun finish() {
    if (active) { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); active = false }
    stopSelf()
  }
  override fun onDestroy() { NavigationRuntime.get(this).serviceDestroyed(this); super.onDestroy() }
  companion object {
    const val START = "quest.avoid.maps.navigation.START"
    const val STOP = "quest.avoid.maps.navigation.STOP"
    const val CHANNEL = "avoid_navigation"
  }
}
