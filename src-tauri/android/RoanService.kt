package dev.roan

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import java.io.File

/**
 * The foreground service: the node keeps breathing when the app closes.
 *
 * Android stops background processes on a whim; a foreground service with a
 * visible notification is the one sanctioned way for a phone to be a real
 * node. The notification says what runs, and a second one appears when a turn
 * finishes while the app is closed — the daemon marks that moment with one
 * line in its own log, which this service watches.
 */
class RoanService : Service() {
  companion object {
    private const val CHANNEL = "roan"
    private const val RUNNING_ID = 1
    private const val DONE_ID = 2
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Roan", NotificationManager.IMPORTANCE_LOW).apply {
          description = "The Roan node and its turn notifications"
        }
      )
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(
      RUNNING_ID,
      buildNotification("Roan is running", "One agent, everywhere — the chain stays in sync."),
    )
    RoanNode.ensureStarted(applicationContext)
    startTurnWatcher()
    return START_STICKY
  }

  private fun buildNotification(title: String, text: String): Notification {
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    return builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setOngoing(true)
      .build()
  }

  /**
   * Tails the daemon log for the "notify:turn-done" mark. The daemon writes
   * one line per finished turn; a closed app still learns its owner was
   * answered.
   */
  private fun startTurnWatcher() {
    val log = File(filesDir, "roan-daemon.log")
    Thread({
      var offset = if (log.exists()) log.length() else 0L
      while (true) {
        try {
          Thread.sleep(2_000)
          if (!log.exists()) continue
          val length = log.length()
          if (length <= offset) continue
          log.inputStream().use { stream ->
            stream.skip(offset)
            val fresh = stream.readBytes().decodeToString()
            offset = length
            if (fresh.contains("notify:turn-done")) {
              val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
              manager.notify(
                DONE_ID,
                buildNotification("Roan is done", "The turn finished — open the app to read it.")
                  .apply { flags = flags and Notification.FLAG_ONGOING_EVENT.inv() },
              )
            }
          }
        } catch (error: Throwable) {
          // A phone that hibernates this thread loses nothing: the next wake
          // picks up at the offset and the mark is still there.
        }
      }
    }, "roan-turn-watcher").start()
  }
}
