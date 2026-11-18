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
    // The engine is the loop in this repo: there is no `hermes` binary on a
    // phone and no way to spawn one.
    setEnvironment("ROAN_ENGINE", "builtin")
    // The app talks to the daemon over loopback; peers reach it on the tailnet.
    setEnvironment("ROAN_CONTROL_HOST", "127.0.0.1")
    setEnvironment("ROAN_CONTROL_PORT", "7411")
    setEnvironment("ROAN_PEER_HOST", "0.0.0.0")
    setEnvironment("ROAN_PEER_PORT", "7412")

    Thread({
      // Written into the log itself: when node returns before printing
      // anything, the exit code is the only diagnosis there is.
      log.appendText("--- daemon start (${script.absolutePath}) ---\n")
      try {
        val code = startNodeWithArguments(arrayOf("node", script.absolutePath))
        log.appendText("--- daemon returned, exit code $code ---\n")
        Log.i(TAG, "daemon stopped with code $code")
      } catch (error: Throwable) {
        log.appendText("--- daemon threw: ${error::class.java.simpleName}: ${error.message} ---\n")
        Log.e(TAG, "daemon failed to start", error)
      }
    }, "roan-daemon").start()
    Log.i(TAG, "daemon starting, home ${home.absolutePath}")
    // A phone cannot show its own logcat and a cable is not always at hand. The
    // app therefore serves its own log on loopback, so the screen can show what
    // the daemon said when it refused to come up.
    startLogServer(log)
    // A phone has no terminal and `adb` is not always at hand, so the daemon's
    // own output is copied into Downloads a few seconds after start: that file
    // is the only way to see why it refused to come up.
    Thread({
      Thread.sleep(6_000)
      exportLog(context, log)
    }, "roan-log-export").start()
  }

  /** Plain HTTP on 127.0.0.1:7413, one route: GET /log. */
  private fun startLogServer(log: File) {
    Thread({
      try {
        val server = java.net.ServerSocket(7413, 4, java.net.InetAddress.getByName("127.0.0.1"))
        while (true) {
          val socket = server.accept()
          try {
            val reader = socket.getInputStream().bufferedReader()
            val line = reader.readLine() ?: ""
            val body = if (line.startsWith("GET /log")) {
              if (log.exists()) log.readText().takeLast(80_000) else "no log file: the daemon never started\n"
            } else {
              ""
            }
            val bytes = body.toByteArray()
            val status = if (line.startsWith("GET /log")) "200 OK" else "404 Not Found"
            val head = "HTTP/1.1 $status\r\n" +
              "Content-Type: text/plain; charset=utf-8\r\n" +
              "Access-Control-Allow-Origin: *\r\n" +
              "Cache-Control: no-store\r\n" +
              "Content-Length: ${bytes.size}\r\n" +
              "Connection: close\r\n\r\n"
            socket.getOutputStream().apply {
              write(head.toByteArray())
              write(bytes)
              flush()
            }
          } finally {
            socket.close()
          }
        }
      } catch (error: Throwable) {
        Log.w(TAG, "log server stopped", error)
      }
    }, "roan-log-http").start()
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
