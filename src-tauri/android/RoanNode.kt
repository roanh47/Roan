package dev.roan

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File

/**
 * Runs the Roan daemon inside the app.
 *
 * Every device is a node: the phone keeps its own chain in its own `~/.roan`,
 * owns its own identity, and syncs with the other machines as a peer. That
 * needs a JavaScript runtime on the device, because the daemon is TypeScript.
 * Android refuses to start a binary that is not in the apk, so Node is linked
 * in as a library (libnode.so) and started on a worker thread here.
 */
object RoanNode {
  private const val TAG = "RoanNode"
  private const val SCRIPT = "roan-daemon.js"

  @Volatile
  private var started = false

  /** True when this apk actually carries the Node runtime. */
  @Volatile
  var available = false
    private set

  private external fun startNodeWithArguments(arguments: Array<String>): Int
  private external fun setEnvironment(name: String, value: String)

  init {
    // libnode first: our bridge links against it. If a build comes without it
    // (another ABI, or the script was not run) the app still opens and says the
    // daemon is not there, instead of dying on a missing symbol.
    try {
      System.loadLibrary("node")
      System.loadLibrary("roan_node")
      available = true
    } catch (error: UnsatisfiedLinkError) {
      Log.e(TAG, "no libnode in this apk: the daemon cannot start", error)
    }
  }

  @Synchronized
  fun ensureStarted(context: Context) {
    if (started) return
    started = true
    if (!available) {
      Log.w(TAG, "skipping the daemon: this apk has no Node runtime for this ABI")
      val note = File(context.filesDir, "roan-daemon.log")
      note.appendText("no libnode in this apk: the daemon cannot start (ABI ${Build.SUPPORTED_ABIS.firstOrNull()})\n")
      exportLog(context, note)
      return
    }
    val root = context.filesDir
    // The home is `.Roan`, capital R, on every platform. An install from
    // before that decision still has its chain in `.roan`: move it once,
    // before anything opens it, or the upgrade would look like data loss.
    val legacy = File(root, ".roan")
    val home = File(root, ".Roan")
    if (legacy.exists() && !home.exists()) {
      if (legacy.renameTo(home)) {
        Log.i(TAG, "home: moved the old .roan to .Roan once")
      } else {
        Log.e(TAG, "home: could not move .roan to .Roan")
      }
    }
    home.mkdirs()
    val script = File(root, SCRIPT)
    copyAsset(context, SCRIPT, script)

    val log = File(root, "roan-daemon.log")
    setEnvironment("ROAN_HOME", home.absolutePath)
    setEnvironment("ROAN_LOG_PATH", log.absolutePath)
    // The app talks to the daemon over loopback; peers reach it on the tailnet.
    // Port, host and the control gate are NOT this layer's business: the daemon
    // owns those defaults (every interface, one port) and they must read the
    // same here as on Linux, Windows and macOS. Overriding them per platform is
    // how the phone ended up listening on loopback while its invite named the
    // tailnet address.
    // The daemon must never call exit() here: a hard exit from the node
    // thread runs static destructors mid-flight and kills the app with a
    // SIGABRT. This flag makes it close its servers, drain the loop and
    // return — the supervisor below decides what happens next.
    setEnvironment("ROAN_SHELL", "android")
    // Peers are served on the same port, under /peer; there is no second port
    // to configure here any more.
    // Node's interface list does not see Android's VPN tunnel, so the daemon
    // cannot find this phone's tailnet address on its own — its invite would
    // carry no route and it would listen on loopback only. Kotlin sees the
    // tunnel; hand the address over: it listens there, and advertises it.
    try {
      val tailnet = java.net.NetworkInterface.getNetworkInterfaces().asSequence()
        .flatMap { it.inetAddresses.asSequence() }
        .mapNotNull { it as? java.net.Inet4Address }
        .firstOrNull { it.hostAddress?.startsWith("100.64.") == true }
        ?.hostAddress
      if (tailnet != null) {
        setEnvironment("ROAN_PEER_BIND", tailnet)
        setEnvironment("ROAN_PEER_ADVERTISE", tailnet)
      }
    } catch (error: Throwable) {
      // No tunnel up yet: the invite simply carries no route, same as before.
    }

    Thread({
      // Supervisor: a clean return (a leave, a drain) restarts immediately —
      // the owner is waiting on the next screen. A crash backs off, so a
      // daemon that cannot boot does not spin the CPU into the ground.
      var backoff = 2_000L
      while (true) {
        log.appendText("--- daemon start (${script.absolutePath}) ---\n")
        val code = try {
          startNodeWithArguments(arrayOf("node", script.absolutePath))
        } catch (error: Throwable) {
          log.appendText("--- daemon threw: ${error::class.java.simpleName}: ${error.message} ---\n")
          Log.e(TAG, "daemon failed to start", error)
          -1
        }
        log.appendText("--- daemon returned, exit code $code ---\n")
        if (code == 0) {
          backoff = 2_000L
          Thread.sleep(500L)
        } else {
          Thread.sleep(backoff)
          backoff = minOf(backoff * 2, 30_000L)
        }
      }
    }, "roan-daemon").start()
    Log.i(TAG, "daemon starting, home ${home.absolutePath}")
    // A phone cannot show its own logcat and a cable is not always at hand. The
    // app therefore serves its own log on loopback, so the screen can show what
    // the daemon said when it refused to come up.
    // The daemon serves /log on its one port; there is no second HTTP server here.
    // A phone has no terminal and `adb` is not always at hand, so the daemon's
    // own output is copied into Downloads a few seconds after start: that file
    // is the only way to see why it refused to come up.
    Thread({
      Thread.sleep(6_000)
      exportLog(context, log)
    }, "roan-log-export").start()
  }

  /**
   * Copies the daemon log into Downloads/roan-daemon-log.txt.
   *
   * Internal storage is private to the app, and the one moment the log matters
   * is the moment the app cannot talk to its daemon. Downloads is readable and
   * shareable, so the user can send it on without a cable.
   */
  private fun exportLog(context: Context, log: File) {
    if (!log.exists()) return
    val text = try {
      log.readText().takeLast(60_000)
    } catch (error: Throwable) {
      Log.w(TAG, "cannot read the daemon log", error)
      return
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, "roan-daemon-log.txt")
          put(MediaStore.Downloads.MIME_TYPE, "text/plain")
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }
        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        if (uri != null) {
          context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray()) }
          Log.i(TAG, "daemon log exported to Downloads")
          return
        }
      }
      @Suppress("DEPRECATION")
      val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      dir.mkdirs()
      File(dir, "roan-daemon-log.txt").writeText(text)
      Log.i(TAG, "daemon log written to Downloads")
    } catch (error: Throwable) {
      Log.w(TAG, "cannot export the daemon log", error)
    }
  }

  private fun copyAsset(context: Context, name: String, target: File) {
    context.assets.open(name).use { input ->
      target.outputStream().use { output -> input.copyTo(output) }
    }
  }
}
