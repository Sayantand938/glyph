package app.glyph.desktop

import android.content.Context
import android.graphics.Color
import android.net.wifi.WifiManager
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Android drops multicast packets unless an app holds this lock; without it
  // the phone never hears other Glyph devices announce themselves (mDNS).
  private var multicastLock: WifiManager.MulticastLock? = null
  private var pageChromeAttached = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // This web view reports no safe-area insets to the page (`env(safe-area-inset-*)`
    // is 0), so the content is kept clear of the status bar, the gesture bar and the
    // keyboard here. The page reports its light/dark theme back through the bridge
    // below, so the band behind those bars is painted the page colour instead of the
    // Android theme colour.
    val content = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }

    // The web view is created by the Tauri shell, which may happen after this runs,
    // so wait for it instead of assuming it exists.
    content.viewTreeObserver.addOnGlobalLayoutListener {
      val webView = findWebView(content) ?: return@addOnGlobalLayoutListener
      // Its own edge stretch cannot be reached from CSS: `overscroll-behavior: none`
      // stops the browser glow, but the page still rubber-bands without this.
      webView.overScrollMode = View.OVER_SCROLL_NEVER
      if (!pageChromeAttached) {
        pageChromeAttached = true
        webView.addJavascriptInterface(PageChrome(), "GlyphPage")
      }
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findWebView(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  /** Called from src/lib/page-chrome.ts whenever the page theme resolves. */
  private inner class PageChrome {
    @JavascriptInterface
    fun setDarkTheme(dark: Boolean) {
      runOnUiThread {
        val content = findViewById<ViewGroup>(android.R.id.content)
        content.setBackgroundColor(if (dark) Color.BLACK else Color.WHITE)
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }
  }

  override fun onResume() {
    super.onResume()
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    multicastLock = wifi?.createMulticastLock("glyph-nearby")?.apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onPause() {
    multicastLock?.let { if (it.isHeld) it.release() }
    multicastLock = null
    super.onPause()
  }
}
