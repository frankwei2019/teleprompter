package com.teleprompter.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {

  private val pollHandler = Handler(Looper.getMainLooper())
  private val POLL_INTERVAL_MS = 300L

  private val pollRunnable = object : Runnable {
    override fun run() {
      pollFloatingBridge()
      pollHandler.postDelayed(this, POLL_INTERVAL_MS)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Poll continuously (not just onResume) so a "start floating" tap made
    // while this activity is in the foreground is picked up within ~300ms.
    pollHandler.post(pollRunnable)
  }

  override fun onResume() {
    super.onResume()
    pollFloatingBridge()
  }

  override fun onDestroy() {
    pollHandler.removeCallbacks(pollRunnable)
    super.onDestroy()
  }

  private fun bridgeDir(): File = File(cacheDir, "teleprompter_bridge")

  private fun pollFloatingBridge() {
    try {
      // Rust writes to Context.getCacheDir()/teleprompter_bridge/floating_bridge.json
      val marker = File(bridgeDir(), "floating_bridge.json")
      if (!marker.exists()) return
      if (System.currentTimeMillis() - marker.lastModified() > 10000) return
      val text = marker.readText()
      marker.delete()
      val json = JSONObject(text)
      val action = json.optString("action", "")
      val payload = json.optString("payload", "")
      Log.d("teleprompter", "bridge: action=$action payload_len=${payload.length}")
      onFloatingBridgeCall(action, payload)
    } catch (e: Exception) {
      Log.e("teleprompter", "bridge poll failed", e)
    }
  }

  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    // Intentionally no PiP: the floating overlay is the "on top" surface.
  }

  // Floating window entry point — called by Tauri JS via invoke("floating_bridge", ...)
  @Suppress("unused")
  fun onFloatingBridgeCall(action: String, payload: String): Boolean {
    return when (action) {
      "check_permission" -> {
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
      }
      "request_permission" -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
          )
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(intent)
        }
        true
      }
      "start" -> {
        // payload format: text + \u001F + fontSize + \u001F + fontColor
        // + \u001F + scrollSpeed + \u001F + bgTransparency(0-100)
        val parts = payload.split('\u001F')
        val intent = Intent(this, FloatingWindowService::class.java)
        if (parts.isNotEmpty()) intent.putExtra(FloatingWindowService.EXTRA_TEXT, parts[0])
        if (parts.size > 1) intent.putExtra(FloatingWindowService.EXTRA_FONT_SIZE, parts[1].toIntOrNull() ?: 36)
        if (parts.size > 2) intent.putExtra(FloatingWindowService.EXTRA_FONT_COLOR, parts[2])
        if (parts.size > 3) intent.putExtra(FloatingWindowService.EXTRA_SCROLL_SPEED, parts[3].toIntOrNull() ?: 30)
        if (parts.size > 4) intent.putExtra(FloatingWindowService.EXTRA_BG_ALPHA, parts[4].toIntOrNull() ?: 30)
        // Real overlay permission check lives here (the JS bridge can only write a file).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
          Toast.makeText(this, "请先开启“显示在其它应用上层”权限", Toast.LENGTH_LONG).show()
          val pIntent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
          )
          pIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(pIntent)
          return false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          startForegroundService(intent)
        } else {
          startService(intent)
        }
        true
      }
      "stop" -> {
        stopService(Intent(this, FloatingWindowService::class.java))
        true
      }
      else -> false
    }
  }
}
