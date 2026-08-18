package com.teleprompter.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
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

  // Mini round icon ("秒剪"-style floating ball) that restores the main window.
  private var iconView: View? = null
  private var iconParams: WindowManager.LayoutParams? = null

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
  private var contentHeight: Float = 0f
  private val scrollHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val scrollTick: Runnable = object : Runnable {
    override fun run() {
      if (scrolling) {
        val now = System.nanoTime()
        val dt = if (lastFrameTime == 0L) 0f else (now - lastFrameTime) / 1_000_000_000f
        lastFrameTime = now
        val density = resources.displayMetrics.density
        scrollOffset += scrollSpeed * density * dt
        // Text enters from the bottom edge of the window and scrolls upward.
        // The wrap point must let the LAST line scroll OUT of the top edge of
        // the window (past the drag handle bar) before looping back to the top.
        // - translationY starts at viewport (text fully below the window)
        // - the last line leaves the top edge when translationY =
        //   -(contentHeight + topBarHeight)
        // - so maxOffset = contentHeight + viewport + topBarHeight
        val viewport = params?.height ?: 0
        tv?.translationY = viewport - scrollOffset
        tv?.let {
          if (it.lineCount > 0) {
            contentHeight = (it.lineCount * it.lineHeight + it.paddingTop + it.paddingBottom).toFloat()
            val maxOffset = contentHeight + viewport + dp(40)
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
  private var countdownView: TextView? = null

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
      updateContent()
    } else {
      updateContent()
    }
    if (iconView == null) {
      createMiniIcon()
    }
    // Start with text below the viewport (bottom entry).
    scrollOffset = 0f
    lastFrameTime = 0
    val viewport = params?.height ?: 0
    tv?.translationY = viewport.toFloat()
    scrolling = true
    return START_NOT_STICKY
  }

  private fun createFloatingView() {
    val wm = windowManager ?: return
    // Outer FrameLayout: allows a countdown number to be layered on top.
    val container = android.widget.FrameLayout(this).apply {
      setBackground(null)
      clipChildren = false
    }
    containerView = container

    // Top control bar (drag handle + reset + play/pause + close).
    val topBar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setBackground(null)
    }
    val dragHandle = TextView(this).apply {
      text = "≡"
      setTextColor(Color.parseColor("#ffffff"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      setPadding(dp(14), 0, dp(14), 0)
      setBackground(null)
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }
    val btnToggle = Button(this).apply {
      text = "⏸"
      setTextColor(Color.WHITE)
      setBackgroundColor(0x33FFFFFF.toInt())
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
      setPadding(dp(14), 0, dp(14), 0)
      setOnClickListener { toggleScroll() }
    }
    this@FloatingWindowService.btnToggle = btnToggle
    val btnReset = Button(this).apply {
      text = "↻"
      setTextColor(Color.WHITE)
      setBackgroundColor(0x33FFFFFF.toInt())
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
      setPadding(dp(14), 0, dp(14), 0)
      setOnClickListener { startResetCountdown() }
    }
    val btnClose = Button(this).apply {
      text = "×"
      setTextColor(Color.WHITE)
      setBackgroundColor(0x33FFFFFF.toInt())
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      setPadding(dp(14), 0, dp(14), 0)
      setOnClickListener { stopSelf() }
    }
    // Top bar: only the drag handle (≡) so the whole top edge stays draggable.
    topBar.addView(dragHandle)

    // Bottom bar: the 3 control buttons, fixed at the bottom edge of the window
    // (thumb-friendly). Placed with FrameLayout gravity=BOTTOM so it overlays
    // the bottom of the scrolling text area.
    val bottomBar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setBackgroundColor(0x33000000.toInt())
    }
    bottomBar.addView(btnReset)
    bottomBar.addView(btnToggle)
    bottomBar.addView(btnClose)

    // TextView with a very large fixed height: this guarantees the whole script
    // is laid out (no parent AT_MOST cap can truncate it), so every line renders.
    // We scroll it with translationY; the wrap point is the true text height.
    val tv = TextView(this).apply {
      this@FloatingWindowService.tv = this
      setText(text)
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      setTextColor(parseColorSafe(fontColor))
      // DIP matches the main UI's CSS px, so font size and scroll speed look identical.
      setTextSize(TypedValue.COMPLEX_UNIT_DIP, fontSize.toFloat())
      setLineSpacing(0f, 1.4f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(16), dp(8), dp(16), dp(16))
      setBackground(null)
      setShadowLayer(2f, 1f, 1f, Color.BLACK)
    }
    textView = tv

    // Vertical column: top bar on top, then the tall TextView (scrolled with
    // translationY). No ScrollView needed.
    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackground(null)
      clipChildren = false
    }
    column.addView(
      topBar,
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40))
    )
    column.addView(
      tv,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        20000 // big enough for any script; never AT_MOST-truncated
      ).apply { topMargin = dp(4) }
    )
    container.addView(
      column,
      android.widget.FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    // Control buttons pinned to the bottom edge of the window.
    container.addView(
      bottomBar,
      android.widget.FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(52),
        android.view.Gravity.BOTTOM
      )
    )

    // Countdown overlay (3/2/1) shown when reset is pressed, like the main UI.
    val countdown = TextView(this).apply {
      text = "3"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 96f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      visibility = android.view.View.GONE
      setShadowLayer(8f, 0f, 0f, Color.BLACK)
      setBackgroundColor(0x00000000)
    }
    countdownView = countdown
    container.addView(
      countdown,
      android.widget.FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
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

    // Start the scrolling loop.
    scrollHandler.post(scrollTick)
  }

  // The ScrollView's scrollTo is the only way to scroll. We do not need an
  // enableDrag handler on the ScrollView itself — the drag handle TextView at
  // the top of the window is the drag target for moving the whole window.
  private fun enableDrag(window: View, handle: View) {
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
            windowManager?.updateViewLayout(window, p)
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
    // statusView is removed with this layout; skip.
  }

  // 3-second countdown then reset to bottom and keep scrolling, like the main UI.
  private fun startResetCountdown() {
    scrolling = false
    btnToggle?.text = "▶"
    val countdown = countdownView ?: return
    countdown.visibility = android.view.View.VISIBLE
    val totalTicks = 3
    var tick = 0
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    val runnable = object : Runnable {
      override fun run() {
        tick++
        if (tick < totalTicks) {
          countdown.text = (totalTicks - tick).toString()
          handler.postDelayed(this, 1000)
        } else {
          countdown.visibility = android.view.View.GONE
          // Reset to bottom entry (text enters from the bottom edge).
          scrollOffset = 0f
          lastFrameTime = 0
          val viewport = params?.height ?: 0
          tv?.translationY = viewport.toFloat()
          scrolling = true
          btnToggle?.text = "⏸"
        }
      }
    }
    countdown.text = totalTicks.toString()
    handler.postDelayed(runnable, 1000)
  }

  private fun updateContent() {
    tv?.text = text
    tv?.setTextSize(TypedValue.COMPLEX_UNIT_DIP, fontSize.toFloat())
    tv?.setTextColor(parseColorSafe(fontColor))
    // The 20000px TextView lays out the whole script automatically; reset the
    // scroll to the bottom so the next scroll starts from the very end.
    scrollOffset = 0f
    lastFrameTime = 0
    val viewport = params?.height ?: 0
    tv?.translationY = viewport.toFloat()
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
    removeMiniIcon()
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

  private fun createMiniIcon() {
    val wm = windowManager ?: return
    val size = dp(52)
    val icon = TextView(this).apply {
      text = "词"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      gravity = Gravity.CENTER
      setPadding(dp(2), dp(2), dp(2), dp(2))
    }
    // Round dark circle with a white ring ("秒剪"-style floating ball).
    val bg = android.graphics.drawable.GradientDrawable().apply {
      shape = android.graphics.drawable.GradientDrawable.OVAL
      setColor(0xCC333333.toInt())
      setStroke(dp(1), Color.WHITE)
    }
    icon.background = bg

    val lp = WindowManager.LayoutParams(
      size, size,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else
        WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.END or Gravity.CENTER_VERTICAL
      x = dp(4)
      y = 0
    }
    iconParams = lp
    iconView = icon

    // Tap -> restore the main window (singleTask, so it reuses the existing task)
    // and exit floating mode so the two windows never stack.
    val i = Intent(this, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    }
    icon.setOnClickListener {
      startActivity(i)
      stopSelf()
    }
    // Draggable, same gesture logic as the overlay's drag handle.
    var initX = 0
    var initY = 0
    var touchX = 0f
    var touchY = 0f
    var dragging = false
    val touchSlop = android.view.ViewConfiguration.get(this).scaledTouchSlop
    icon.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initX = iconParams?.x ?: 0
          initY = iconParams?.y ?: 0
          touchX = event.rawX
          touchY = event.rawY
          dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          if (!dragging &&
            (Math.abs(event.rawX - touchX) > touchSlop || Math.abs(event.rawY - touchY) > touchSlop)
          ) {
            dragging = true
          }
          if (dragging) {
            iconParams?.let { p ->
              p.x = initX + (event.rawX - touchX).toInt()
              p.y = initY + (event.rawY - touchY).toInt()
              windowManager?.updateViewLayout(icon, p)
            }
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!dragging) {
            val ii = Intent(this, MainActivity::class.java).apply {
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            }
            startActivity(ii)
            stopSelf()
          }
          true
        }
        else -> false
      }
    }
    wm.addView(icon, lp)
  }

  private fun removeMiniIcon() {
    iconView?.let { runCatching { windowManager?.removeView(it) } }
    iconView = null
    iconParams = null
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
