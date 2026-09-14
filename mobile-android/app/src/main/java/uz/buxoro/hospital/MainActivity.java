package uz.buxoro.hospital;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URI;
import java.net.URISyntaxException;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 41;
    private static final String PREFS = "hospital_mobile";
    private static final String PREF_SERVER = "server_url";

    private WebView webView;
    private ProgressBar progress;
    private View offlineView;
    private TextView serverLabel;
    private SharedPreferences preferences;
    private ValueCallback<Uri[]> fileCallback;
    private URI allowedOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        webView = findViewById(R.id.webView);
        progress = findViewById(R.id.progress);
        offlineView = findViewById(R.id.offlineView);
        serverLabel = findViewById(R.id.serverLabel);
        Button serverButton = findViewById(R.id.serverButton);
        Button retryButton = findViewById(R.id.retryButton);

        configureWebView();
        serverButton.setOnClickListener(v -> showServerDialog(false));
        retryButton.setOnClickListener(v -> loadServer());

        String saved = preferences.getString(PREF_SERVER, "");
        if (saved.isEmpty()) {
            showServerDialog(true);
        } else {
            setAllowedOrigin(saved);
            loadServer();
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); // Required by Bootstrap/UI; no JS bridge is exposed.
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSavePassword(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            settings.setSafeBrowsingEnabled(true);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                offlineView.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); // Never bypass certificate errors.
                showOffline();
                Toast.makeText(MainActivity.this, "SSL sertifikat xatosi. Ulanish bloklandi.", Toast.LENGTH_LONG).show();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> uploadCallback, FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = uploadCallback;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException ex) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "Fayl tanlash ilovasi topilmadi.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        if ("https".equalsIgnoreCase(uri.getScheme()) && allowedOrigin != null
                && uri.getHost() != null && uri.getHost().equalsIgnoreCase(allowedOrigin.getHost())
                && effectivePort(uri) == effectivePort(allowedOrigin)) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "Havolani ochib bo‘lmadi.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private int effectivePort(Uri uri) {
        int port = uri.getPort();
        return port == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : port;
    }

    private int effectivePort(URI uri) {
        int port = uri.getPort();
        return port == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : port;
    }

    private void showServerDialog(boolean required) {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("https://hospital.example.uz");
        input.setText(preferences.getString(PREF_SERVER, ""));
        input.setSelectAllOnFocus(true);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Server manzili")
                .setMessage("Faqat HTTPS manzil kiriting. Ilova shu server bilan internet orqali ishlaydi.")
                .setView(input)
                .setPositiveButton("Saqlash", null)
                .setNegativeButton(required ? "Chiqish" : "Bekor qilish", (d, w) -> { if (required) finish(); })
                .setCancelable(!required)
                .create();

        dialog.setOnShowListener(v -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v2 -> {
            String normalized = normalizeHttpsUrl(input.getText().toString());
            if (normalized == null) {
                input.setError("Masalan: https://hospital.example.uz");
                return;
            }
            preferences.edit().putString(PREF_SERVER, normalized).apply();
            setAllowedOrigin(normalized);
            dialog.dismiss();
            loadServer();
        }));
        dialog.show();
    }

    private String normalizeHttpsUrl(String raw) {
        try {
            String value = raw == null ? "" : raw.trim();
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) return null;
            String path = uri.getPath();
            if (path == null || path.isEmpty()) path = "/";
            if (!path.endsWith("/")) path += "/";
            return new URI("https", null, uri.getHost(), uri.getPort(), path, null, null).toString();
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private void setAllowedOrigin(String url) {
        try {
            allowedOrigin = new URI(url);
            serverLabel.setText(allowedOrigin.getHost());
        } catch (URISyntaxException e) {
            allowedOrigin = null;
        }
    }

    private void loadServer() {
        String server = preferences.getString(PREF_SERVER, "");
        if (server.isEmpty()) {
            showServerDialog(true);
            return;
        }
        offlineView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(server);
    }

    private void showOffline() {
        progress.setVisibility(View.GONE);
        webView.setVisibility(View.GONE);
        offlineView.setVisibility(View.VISIBLE);
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
