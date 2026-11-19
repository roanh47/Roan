package dev.roan

import android.os.Bundle
import android.graphics.Color
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Every device is a node: the foreground service owns the daemon, so it
    // keeps breathing after the app closes.
    val intent = android.content.Intent(this, RoanService::class.java)
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      startForegroundService(intent)
    } else {
      startService(intent)
    }
    // getIntent() is the launch intent: the service intent above shadows
    // the ambient `intent`, and a share would park nothing.
    takeSharedText(getIntent())
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    takeSharedText(intent)
  }

  /**
   * The Android share sheet pointing at Roan: the shared text lands in a
   * one-slot inbox that the daemon hands to the app on the next breath —
   * no bridge into the webview needed, and nothing is lost when the app
   * was cold.
   */
  private fun takeSharedText(intent: android.content.Intent?) {
    val text = intent?.getStringExtra(android.content.Intent.EXTRA_TEXT) ?: run {
      android.util.Log.i("RoanShare", "no EXTRA_TEXT on this intent")
      return
    }
    if (text.isBlank()) return
    try {
      java.io.File(filesDir, "shared-inbox.txt").writeText(text.take(20_000))
      android.util.Log.i("RoanShare", "parked ${text.length} chars")
    } catch (error: Throwable) {
      // A full disk refuses politely; the share just does not arrive.
      android.util.Log.i("RoanShare", "park failed: ${error.message}")
    }
  }
}
