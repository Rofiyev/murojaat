package uz.buxoro.hospital;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 41;
    private static final int LOCATION_PERMISSION_REQUEST = 42;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 43;
    private static final String APP_SERVER = "https://appeal1.netlify.app/";
    private static final String WATCH_PREFS = "buxoro_status_watch";
    private static final String WATCH_WORK = "buxoro-appointment-status-watch";

    private WebView webView;
    private ProgressBar progress;
    private View offlineView;
    private ValueCallback<Uri[]> fileCallback;
    private URI allowedOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        applySystemBarInsets();
        webView = findViewById(R.id.webView);
        progress = findViewById(R.id.progress);
        offlineView = findViewById(R.id.offlineView);
        Button retryButton = findViewById(R.id.retryButton);
        try { allowedOrigin = new URI(APP_SERVER); } catch (URISyntaxException ignored) { }
        configureWebView();
        retryButton.setOnClickListener(v -> loadServer());
        ensureWatchSchedule();
        loadServer();
    }

    private void applySystemBarInsets() {
        if (Build.VERSION.SDK_INT >= 35) {
            View root = findViewById(R.id.rootView);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSavePassword(false);
        settings.setSupportZoom(false);
        settings.setGeolocationEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " BuxoroTibbiyotApp/2.1");
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return handleNavigation(request.getUrl()); }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) { offlineView.setVisibility(View.GONE); webView.setVisibility(View.VISIBLE); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) showOffline(); }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); showOffline(); Toast.makeText(MainActivity.this, "Xavfsiz ulanishni tekshirib bo‘lmadi.", Toast.LENGTH_LONG).show(); }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int newProgress) { progress.setProgress(newProgress); progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                try { startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST); return true; }
                catch (ActivityNotFoundException ex) { fileCallback = null; Toast.makeText(MainActivity.this, "Fayl tanlash ilovasi topilmadi.", Toast.LENGTH_SHORT).show(); return false; }
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!isTrustedOrigin(origin)) { callback.invoke(origin, false, false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) { callback.invoke(origin, true, false); return; }
                pendingGeoCallback = callback; pendingGeoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION_REQUEST);
            }
        });
    }

    private boolean isTrustedOrigin(String origin) {
        try { URI uri = new URI(origin); return "https".equalsIgnoreCase(uri.getScheme()) && allowedOrigin != null && uri.getHost() != null && uri.getHost().equalsIgnoreCase(allowedOrigin.getHost()) && effectivePort(uri) == effectivePort(allowedOrigin); }
        catch (Exception ignored) { return false; }
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        if ("buxoroapp".equalsIgnoreCase(uri.getScheme()) && "watch".equalsIgnoreCase(uri.getHost())) { registerStatusWatch(uri.getQueryParameter("reference"), uri.getQueryParameter("phone")); return true; }
        if ("https".equalsIgnoreCase(uri.getScheme()) && allowedOrigin != null && uri.getHost() != null && uri.getHost().equalsIgnoreCase(allowedOrigin.getHost()) && effectivePort(uri) == effectivePort(allowedOrigin)) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException ignored) { Toast.makeText(this, "Havolani ochib bo‘lmadi.", Toast.LENGTH_SHORT).show(); }
        return true;
    }

    private void registerStatusWatch(String reference, String phone) {
        if (reference == null || phone == null) return;
        reference = reference.trim().toUpperCase(); phone = phone.trim();
        if (reference.length() < 8 || phone.length() < 7) return;
        android.content.SharedPreferences prefs = getSharedPreferences(WATCH_PREFS, MODE_PRIVATE);
        Set<String> refs = new HashSet<>(prefs.getStringSet("refs", new HashSet<>())); refs.add(reference);
        prefs.edit().putStringSet("refs", refs).putString("phone_" + reference, phone).putString("status_" + reference, "yangi").apply();
        ensureWatchSchedule();
        WorkManager.getInstance(this).enqueue(new OneTimeWorkRequest.Builder(StatusWorker.class).setConstraints(networkConstraints()).build());
        requestNotificationPermissionIfNeeded();
        Toast.makeText(this, "Holat o‘zgarsa ilova xabar beradi.", Toast.LENGTH_SHORT).show();
    }

    private Constraints networkConstraints() { return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(); }
    private void ensureWatchSchedule() {
        Set<String> refs = getSharedPreferences(WATCH_PREFS, MODE_PRIVATE).getStringSet("refs", null); if (refs == null || refs.isEmpty()) return;
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(StatusWorker.class, 15, TimeUnit.MINUTES).setConstraints(networkConstraints()).build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(WATCH_WORK, ExistingPeriodicWorkPolicy.KEEP, request);
    }
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
    }
    private int effectivePort(Uri uri) { int port = uri.getPort(); return port == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : port; }
    private int effectivePort(URI uri) { int port = uri.getPort(); return port == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : port; }
    private void loadServer() { offlineView.setVisibility(View.GONE); webView.setVisibility(View.VISIBLE); webView.loadUrl(APP_SERVER); }
    private void showOffline() { progress.setVisibility(View.GONE); webView.setVisibility(View.GONE); offlineView.setVisibility(View.VISIBLE); }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_PERMISSION_REQUEST && pendingGeoCallback != null) {
            boolean granted = false; for (int result : grantResults) if (result == PackageManager.PERMISSION_GRANTED) { granted = true; break; }
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false); pendingGeoCallback = null; pendingGeoOrigin = null;
        }
    }
    @Override @SuppressWarnings("deprecation") protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) { Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data); fileCallback.onReceiveValue(results); fileCallback = null; }
    }
    @Override @SuppressWarnings("deprecation") public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (pendingGeoCallback != null) { pendingGeoCallback.invoke(pendingGeoOrigin, false, false); pendingGeoCallback = null; }
        if (webView != null) { webView.stopLoading(); webView.setWebChromeClient(null); webView.setWebViewClient(null); webView.destroy(); }
        super.onDestroy();
    }
}
