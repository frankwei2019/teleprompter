package com.teleprompter.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.IBinder
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

class FloatingWindowService : Service() {

  private var windowManager: WindowManager? = null
  private var floatingView: View? = null
  private var params: WindowManager.LayoutParams? = null

  // state
  private var text: String = ""
  private var fontSize: Int = 36
  private var fontColor: String = "#ffffff"
  private var scrollSpeed: Int = 30
  private var bgAlpha: Int = 30

  private var textView: TextView? = null
  private var containerView: View? = null
  private var statusView: TextView? = null

  // scroll state
  private var scrollOffset: Float = 0f
  private var lastFrameTime: Long = 0
  private var scrolling: Boolean = false
  private val scrollHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val scrollTick: Runnable = object : Runnable {
    override fun run() {
      if (scrolling) {
        val now = System.nanoTime()
        val dt = if (lastFrameTime == 0L) 0f else (now - lastFrameTime) / 1_000_000_000f
        lastFrameTime = now
        scrollOffset += scrollSpeed * dt
        // Viewport height: the overlay window height. Text starts below the
        // viewport (bottom entry) and scrolls up out of the top, like the main UI.
        val viewport = params?.height ?: 0
        tv?.translationY = viewport - scrollOffset
        tv?.let {
          // Only loop once the text height is known (post-layout); otherwise the
          // first frames would wrongly reset to the top.
          if (it.height > 0) {
            val maxOffset = it.height.toFloat() + viewport
            if (scrollOffset >= maxOffset) {
              scrollOffset = 0f
            }
          }
        }
      }
      scrollHandler.postDelayed(this, 16)
    }
  }

  private var tv: TextView? = null
  private var btnToggle: Button? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    startInForeground()
  }

  private fun startInForeground() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      @Suppress("DEPRECATION")
      startForeground(NOTIF_ID, notification)
      return
    }
    val mgr = getSystemService(NotificationManager::class.java)
    if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "悬浮提词器",
        NotificationManager.IMPORTANCE_LOW
      ).apply { description = "词悬浮的悬浮窗正在运行" }
      mgr.createNotificationChannel(channel)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14+ requires a foreground service type matching the manifest.
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  private fun buildNotification(): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pi = PendingIntent.getActivity(
      this, 0, openIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val stopIntent = Intent(this, FloatingWindowService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPi = PendingIntent.getService(
      this, 1, stopIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("词悬浮")
      .setContentText("悬浮窗运行中 — 点此返回主界面")
      .setSmallIcon(android.R.drawable.ic_menu_close_clear_cancel)
      .setContentIntent(pi)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止", stopPi)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    intent?.let {
      text = it.getStringExtra(EXTRA_TEXT) ?: ""
      fontSize = it.getIntExtra(EXTRA_FONT_SIZE, 36)
      fontColor = it.getStringExtra(EXTRA_FONT_COLOR) ?: "#ffffff"
      scrollSpeed = it.getIntExtra(EXTRA_SCROLL_SPEED, 30)
      bgAlpha = it.getIntExtra(EXTRA_BG_ALPHA, 30).coerceIn(0, 100)
    }
    if (floatingView == null) {
      createFloatingView()
      // Apply background/text settings on first creation too, so a fully
      // transparent background actually shows transparent.
      updateContent()
    } else {
      updateContent()
    }
    // Auto-start scrolling so the overlay immediately behaves like the main UI.
    scrolling = true
    lastFrameTime = 0
    if (floatingView != null) {
      // Reset to the top of the script on every start tap.
      scrollOffset = 0f
      val viewport = params?.height ?: 0
      tv?.translationY = viewport.toFloat()
    }
    return START_NOT_STICKY
  }

  private fun createFloatingView() {
    val wm = windowManager ?: return
    val container = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      // 关键：setBackground(null) 让 view 真没背景
      // （setBackgroundColor(TRANSPARENT) 会画一个透明 drawable，某些 Android 版本会被合成成黑）
      setBackground(null)
      setPadding(dp(8), dp(4), dp(8), dp(8))
      // Let the text scroll past the container bounds; the window itself clips.
      clipChildren = false
    }
    containerView = container

    val topBar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setBackground(null)
    }
    val dragHandle = TextView(this).apply {
      text = "≡"
      setTextColor(Color.parseColor("#ffffff"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setPadding(dp(8), 0, dp(8), 0)
      setBackground(null)
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }
    val btnToggle = Button(this).apply {
      text = "⏸"
      setTextColor(Color.WHITE)
      setBackground(null)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setPadding(dp(4), 0, dp(4), 0)
      setOnClickListener { toggleScroll() }
    }
    this@FloatingWindowService.btnToggle = btnToggle
    val btnReset = Button(this).apply {
      text = "↻"
      setTextColor(Color.WHITE)
      setBackground(null)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setPadding(dp(4), 0, dp(4), 0)
      setOnClickListener {
        scrollOffset = 0f
        val viewport = params?.height ?: 0
        tv?.translationY = viewport.toFloat()
      }
    }
    val btnClose = Button(this).apply {
      text = "×"
      setTextColor(Color.WHITE)
      setBackground(null)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setPadding(dp(4), 0, dp(4), 0)
      setOnClickListener { stopSelf() }
    }
    topBar.addView(dragHandle)
    topBar.addView(btnReset)
    topBar.addView(btnToggle)
    topBar.addView(btnClose)

    val tv = TextView(this).apply {
      this@FloatingWindowService.tv = this
      setText(text)
      gravity = Gravity.CENTER
      setTextColor(parseColorSafe(fontColor))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize.toFloat())
      setLineSpacing(0f, 1.4f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(4), dp(4), dp(4), dp(4))
      setBackground(null)
      setShadowLayer(2f, 1f, 1f, Color.BLACK)
    }
    textView = tv

    container.addView(topBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36)))
    // Wrap content height so long scripts scroll fully instead of being clipped
    // to a fixed region; position it below the viewport to start from the bottom.
    container.addView(
      tv,
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        .apply { topMargin = dp(4) }
    )

    val displayMetrics = resources.displayMetrics
    val width = (displayMetrics.widthPixels * 0.95f).toInt()
    val height = (displayMetrics.heightPixels * 0.45f).toInt()

    val lp = WindowManager.LayoutParams(
      width, height,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else
        WindowManager.LayoutParams.TYPE_PHONE,
      // FLAG_NOT_FOCUSABLE 不抢焦点
      // FLAG_NOT_TOUCH_MODAL 允许点击穿透（除按钮外的区域）
      // FLAG_LAYOUT_IN_SCREEN 允许超出 parent 边界
      // FLAG_LAYOUT_NO_LIMITS 允许 0,0 坐标
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      // 关键：TRANSPARENT (值 0) 让系统知道这是全透明窗口
      // TRANSLUCENT 在某些设备/版本会被强制 opaque
      PixelFormat.TRANSPARENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      x = 0
      y = dp(8)
    }
    params = lp
    floatingView = container
    wm.addView(container, lp)
    enableDrag(container, dragHandle)

    scrollHandler.post(scrollTick)
  }

  private fun enableDrag(view: View, handle: View) {
    var initX = 0
    var initY = 0
    var touchX = 0f
    var touchY = 0f
    handle.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initX = params?.x ?: 0
          initY = params?.y ?: 0
          touchX = event.rawX
          touchY = event.rawY
          true
        }
        MotionEvent.ACTION_MOVE -> {
          params?.let { p ->
            p.x = initX + (event.rawX - touchX).toInt()
            p.y = initY + (event.rawY - touchY).toInt()
            windowManager?.updateViewLayout(view, p)
          }
          true
        }
        else -> false
      }
    }
  }

  private fun toggleScroll() {
    if (text.isBlank()) {
      statusView?.text = "无文本"
      return
    }
    scrolling = !scrolling
    if (scrolling) lastFrameTime = 0
    btnToggle?.text = if (scrolling) "⏸" else "▶"
    statusView?.text = if (scrolling) "播放中" else "已暂停"
  }

  private fun updateContent() {
    tv?.text = text
    tv?.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize.toFloat())
    tv?.setTextColor(parseColorSafe(fontColor))
    // transparencyPercent: 100 = fully transparent -> keep NO background drawable
    // (setBackground(null)), because a transparent drawable can be composited as
    // black on some ROMs. 0 = fully opaque black.
    if (bgAlpha >= 100) {
      containerView?.setBackground(null)
    } else {
      containerView?.setBackgroundColor(adjustAlpha(Color.BLACK, bgAlpha))
    }
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun parseColorSafe(c: String): Int = try { Color.parseColor(c) } catch (e: Exception) { Color.WHITE }

  private fun adjustAlpha(color: Int, transparencyPercent: Int): Int {
    // transparencyPercent: 0 = 全黑不透明, 100 = 完全透明（无背景）
    val a = (255 * (1f - transparencyPercent / 100f)).toInt().coerceIn(0, 255)
    return Color.argb(a, Color.red(color), Color.green(color), Color.blue(color))
  }

  override fun onDestroy() {
    scrollHandler.removeCallbacks(scrollTick)
    floatingView?.let { runCatching { windowManager?.removeView(it) } }
    floatingView = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  companion object {
    const val EXTRA_TEXT = "extra_text"
    const val EXTRA_FONT_SIZE = "extra_font_size"
    const val EXTRA_FONT_COLOR = "extra_font_color"
    const val EXTRA_SCROLL_SPEED = "extra_scroll_speed"
    const val EXTRA_BG_ALPHA = "extra_bg_alpha"
    const val ACTION_STOP = "com.teleprompter.app.action.STOP"
    private const val CHANNEL_ID = "floating_prompter"
    private const val NOTIF_ID = 0x7072  // "pr"
  }
}
