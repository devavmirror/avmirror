package com.avmirror.local;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.regex.Pattern;

public class AvmirrorService extends Service {
  public static final String ACTION_RESOLVE = "com.avmirror.local.RESOLVE";
  public static final String EXTRA_URL = "url";
  private static final String CHANNEL = "avmirror-server";
  private static final int ID = 7000;
  private static final Pattern MEDIA = Pattern.compile("(?i)(?:\\.m3u8(?:[?#]|$)|\\.mp4(?:[?#]|$)|master\\.txt|/manifest/|/playlist/|/stream/)");
  private WebView webView;

  @Override public void onCreate() {
    super.onCreate();
    startForeground(ID, notification());
    webView = createHiddenWebView();
  }

  private Notification notification() {
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "AVMirror", NotificationManager.IMPORTANCE_LOW));
    return new Notification.Builder(this, CHANNEL).setContentTitle("AVMirror ativo")
      .setContentText("Servidor local e navegador embutido ativos")
      .setSmallIcon(android.R.drawable.ic_media_play).setOngoing(true).build();
  }

  private WebView createHiddenWebView() {
    WebView view = new WebView(getApplicationContext());
    view.setVisibility(WebView.INVISIBLE);
    view.getSettings().setJavaScriptEnabled(true);
    view.getSettings().setDomStorageEnabled(true);
    view.getSettings().setMediaPlaybackRequiresUserGesture(false);
    view.getSettings().setUserAgentString("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/Android AVMirror");
    view.setWebChromeClient(new WebChromeClient());
    view.addJavascriptInterface(new BrowserBridge(), "AVMirrorBridge");
    view.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (MEDIA.matcher(url).find()) Log.i("AVMirrorWebView", "media=" + url);
        return super.shouldInterceptRequest(v, request);
      }
      @Override public void onPageFinished(WebView v, String url) {
        v.evaluateJavascript("(function(){var o=[];document.querySelectorAll('video,video source,audio,audio source').forEach(function(n){var u=n.currentSrc||n.src||n.getAttribute('src');if(u){o.push(u);AVMirrorBridge.media(u);}});return JSON.stringify(o);})()", value -> Log.i("AVMirrorWebView", "dom=" + value));
      }
    });
    view.loadDataWithBaseURL("https://avmirror.local/", "<html><body></body></html>", "text/html", "UTF-8", null);
    return view;
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_RESOLVE.equals(intent.getAction())) {
      String url = intent.getStringExtra(EXTRA_URL);
      if (url != null && url.startsWith("https://")) webView.loadUrl(url);
    }
    return START_STICKY;
  }

  @Override public void onDestroy() {
    if (webView != null) { webView.removeJavascriptInterface("AVMirrorBridge"); webView.destroy(); webView = null; }
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) { return null; }

  private final class BrowserBridge {
    @JavascriptInterface public void media(String url) { if (url != null && MEDIA.matcher(url).find()) Log.i("AVMirrorWebView", "media=" + url); }
  }
}
