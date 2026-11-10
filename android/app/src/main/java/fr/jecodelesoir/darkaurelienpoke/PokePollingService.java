package fr.jecodelesoir.darkaurelienpoke;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class PokePollingService extends Service {
    static final String ACTION_HISTORY_CHANGED = "fr.jecodelesoir.darkaurelienpoke.HISTORY_CHANGED";
    static final String PREFS = "poke_runtime";
    static final String ENABLED = "enabled";
    static final String LAST_ERROR = "last_error";
    static final String LAST_CHECKED_AT = "last_checked_at";
    private static final String LAST_SEEN = "last_seen_id";
    private static final String ENDPOINT = "https://dark-aurelien-poke.dark-aurelien-poke-worker.workers.dev/notifications";
    private static final String MONITOR_CHANNEL = "poke_monitor_v1";
    private static final String POKE_CHANNEL = "poke_events_v1";
    private static final int FOREGROUND_ID = 1101;
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private static final String TAG = "PokePollingService";
    private ScheduledExecutorService scheduler;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!prefs.getBoolean(ENABLED, false) || SecureTokenStore.load(this).isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        Notification monitor = buildMonitorNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(FOREGROUND_ID, monitor, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        } else {
            startForeground(FOREGROUND_ID, monitor);
        }
        if (scheduler == null || scheduler.isShutdown()) {
            scheduler = Executors.newSingleThreadScheduledExecutor();
            scheduler.scheduleWithFixedDelay(this::pollSafely, 0, 30, TimeUnit.SECONDS);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (scheduler != null) scheduler.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollSafely() {
        if (!getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(ENABLED, false)) {
            stopSelf();
            return;
        }
        HttpURLConnection connection = null;
        try {
            long lastSeen = getSharedPreferences(PREFS, MODE_PRIVATE).getLong(LAST_SEEN, 0L);
            URL url = new URL(ENDPOINT + "?after=" + lastSeen);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + SecureTokenStore.load(this));
            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                recordStatus("Erreur Worker HTTP " + responseCode);
                return;
            }

            JSONObject body = new JSONObject(readLimited(connection.getInputStream()));
            JSONArray notifications = body.optJSONArray("notifications");
            if (notifications == null) {
                recordStatus("Réponse Worker invalide");
                return;
            }
            recordStatus("");
            long newest = lastSeen;
            for (int index = 0; index < notifications.length(); index++) {
                JSONObject event = notifications.optJSONObject(index);
                if (event == null) continue;
                long id = event.optLong("id", -1L);
                String name = event.optString("name", "").trim();
                if (id <= newest || name.length() < 2 || name.length() > 32) continue;
                PokeHistoryStore.add(this, id, name, event.optLong("createdAt", System.currentTimeMillis() / 1000L));
                sendBroadcast(new Intent(ACTION_HISTORY_CHANGED).setPackage(getPackageName()),
                        "fr.jecodelesoir.darkaurelienpoke.permission.INTERNAL");
                showPoke(id, name);
                newest = id;
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(LAST_SEEN, newest).apply();
            }
        } catch (Exception error) {
            // Une coupure réseau est normale : le prochain passage reprendra au dernier identifiant confirmé.
            Log.w(TAG, "Polling failed", error);
            recordStatus("Connexion au Worker impossible");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void recordStatus(String error) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString(LAST_ERROR, error)
                .putLong(LAST_CHECKED_AT, System.currentTimeMillis())
                .apply();
        sendBroadcast(new Intent(ACTION_HISTORY_CHANGED).setPackage(getPackageName()),
                "fr.jecodelesoir.darkaurelienpoke.permission.INTERNAL");
    }

    private String readLimited(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new IllegalStateException("Response too large");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void createChannels() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel monitor = new NotificationChannel(MONITOR_CHANNEL,
                getString(R.string.monitor_channel), NotificationManager.IMPORTANCE_LOW);
        monitor.setDescription(getString(R.string.monitor_text));
        manager.createNotificationChannel(monitor);
        NotificationChannel events = new NotificationChannel(POKE_CHANNEL,
                getString(R.string.poke_channel), NotificationManager.IMPORTANCE_HIGH);
        manager.createNotificationChannel(events);
    }

    private PendingIntent openAppIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        return PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildMonitorNotification() {
        return new Notification.Builder(this, MONITOR_CHANNEL)
                .setSmallIcon(R.drawable.ic_app)
                .setContentTitle(getString(R.string.monitor_title))
                .setContentText(getString(R.string.monitor_text))
                .setContentIntent(openAppIntent())
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    private void showPoke(long id, String name) {
        Notification notification = new Notification.Builder(this, POKE_CHANNEL)
                .setSmallIcon(R.drawable.ic_app)
                .setContentTitle(getString(R.string.poke_title))
                .setContentText(getString(R.string.poke_text, name))
                .setStyle(new Notification.BigTextStyle().bigText(getString(R.string.poke_text, name)))
                .setContentIntent(openAppIntent())
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .build();
        getSystemService(NotificationManager.class).notify((int) (id % Integer.MAX_VALUE), notification);
    }
}
