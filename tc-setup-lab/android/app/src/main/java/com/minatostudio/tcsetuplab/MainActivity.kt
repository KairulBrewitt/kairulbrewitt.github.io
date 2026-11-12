package com.minatostudio.tcsetuplab

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature

/**
 * Hosts the setup tool. The HTML/JS app is bundled in the APK assets
 * (tc-setup-lab/web) and served from a virtual https origin by
 * WebViewAssetLoader, so it runs fully offline and keeps its localStorage.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.page_bg))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            // The layout and diagrams are sized for 100 % text; they already scale with the screen.
            settings.textZoom = 100
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                // The page has its own dark theme; don't let the WebView invert it.
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
            }
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                    // Anything outside the app opens in the browser.
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: ActivityNotFoundException) {
                    }
                    return true
                }
            }
        }

        // Keep the page clear of the status bar, navigation bar and display cutout.
        val root = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.page_bg))
            addView(webView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL)
        }

        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) webView.goBack() else finish()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val START_URL = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/index.html"
    }
}
