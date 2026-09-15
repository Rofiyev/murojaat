package uz.buxoro.hospital;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkManager;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

public class StatusWorker extends Worker {
    private static final String SERVER = "https://appeal1.netlify.app";
    private static final String PREFS = "buxoro_status_watch";
    private static final String WORK_NAME = "buxoro-appointment-status-watch";
    private static final String CHANNEL = "murojaat_holati";
    public StatusWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext(); SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> refs = new HashSet<>(prefs.getStringSet("refs", new HashSet<>())); if (refs.isEmpty()) return Result.success();
        boolean hadNetworkError = false;
        for (String ref : new HashSet<>(refs)) {
            String phone = prefs.getString("phone_" + ref, ""); if (phone.isEmpty()) continue;
            try {
                JSONObject appointment = fetchStatus(ref, phone); if (appointment == null) continue;
                String status = appointment.optString("status", ""), response = appointment.optString("response", ""), old = prefs.getString("status_" + ref, "yangi");
                if (!status.isEmpty() && !status.equals(old)) { prefs.edit().putString("status_" + ref, status).apply(); notifyStatus(context, ref, status, response); }
                if ("hal_qilindi".equals(status) || "rad_etildi".equals(status)) { refs.remove(ref); prefs.edit().remove("phone_" + ref).remove("status_" + ref).apply(); }
            } catch (Exception e) { hadNetworkError = true; }
        }
        prefs.edit().putStringSet("refs", refs).apply(); if (refs.isEmpty()) WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
        return hadNetworkError ? Result.retry() : Result.success();
    }

    private JSONObject fetchStatus(String ref, String phone) throws Exception {
        String url = SERVER + "/api/status?reference=" + URLEncoder.encode(ref, StandardCharsets.UTF_8.name()) + "&phone=" + URLEncoder.encode(phone, StandardCharsets.UTF_8.name());
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection(); con.setConnectTimeout(8000); con.setReadTimeout(8000); con.setRequestMethod("GET"); con.setRequestProperty("Accept", "application/json");
        int code = con.getResponseCode(); if (code == 404 || code == 400) { con.disconnect(); return null; } if (code < 200 || code >= 300) { con.disconnect(); throw new Exception("HTTP " + code); }
        StringBuilder out = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) { String line; while ((line = r.readLine()) != null) out.append(line); }
        finally { con.disconnect(); }
        return new JSONObject(out.toString()).optJSONObject("appointment");
    }

    private void notifyStatus(Context context, String ref, String status, String response) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Murojaat holati", NotificationManager.IMPORTANCE_DEFAULT); channel.setDescription("Murojaat ko‘rib chiqilish holati o‘zgarganda xabar beradi"); nm.createNotificationChannel(channel);
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, ref.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = "Murojaat: " + label(status); String text = (response == null || response.trim().isEmpty()) ? ref + " holati o‘zgardi." : response.trim();
        android.app.Notification n = new android.app.Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.app_icon).setContentTitle(title).setContentText(text).setStyle(new android.app.Notification.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true).build();
        nm.notify(ref.hashCode(), n);
    }
    private String label(String status) { switch (status) { case "jarayonda": return "Jarayonda"; case "hal_qilindi": return "Hal qilindi"; case "rad_etildi": return "Rad etildi"; default: return "Yangilandi"; } }
}
