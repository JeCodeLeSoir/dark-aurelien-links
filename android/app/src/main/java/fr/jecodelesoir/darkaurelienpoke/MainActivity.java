package fr.jecodelesoir.darkaurelienpoke;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.method.PasswordTransformationMethod;
import android.text.method.SingleLineTransformationMethod;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.Date;
import java.util.List;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7001;
    private EditText tokenInput;
    private TextView errorText;
    private TextView statusText;
    private TextView historyEmpty;
    private LinearLayout historyList;
    private final BroadcastReceiver historyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            refreshStatus();
            renderHistory();
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);

        tokenInput = findViewById(R.id.tokenInput);
        errorText = findViewById(R.id.errorText);
        statusText = findViewById(R.id.statusText);
        historyEmpty = findViewById(R.id.historyEmpty);
        historyList = findViewById(R.id.historyList);
        CheckBox showToken = findViewById(R.id.showToken);
        Button startButton = findViewById(R.id.startButton);
        Button stopButton = findViewById(R.id.stopButton);
        Button clearHistoryButton = findViewById(R.id.clearHistoryButton);

        importDeveloperTokenIfPresent();
        tokenInput.setText(SecureTokenStore.load(this));
        showToken.setOnCheckedChangeListener((button, checked) -> {
            int selection = tokenInput.getSelectionStart();
            tokenInput.setTransformationMethod(checked
                    ? SingleLineTransformationMethod.getInstance()
                    : PasswordTransformationMethod.getInstance());
            tokenInput.setSelection(Math.max(0, selection));
        });
        startButton.setOnClickListener(view -> startNotifications());
        stopButton.setOnClickListener(view -> {
            getSharedPreferences(PokePollingService.PREFS, MODE_PRIVATE).edit()
                    .putBoolean(PokePollingService.ENABLED, false).apply();
            stopService(new Intent(this, PokePollingService.class));
            refreshStatus();
        });
        clearHistoryButton.setOnClickListener(view -> new AlertDialog.Builder(this)
                .setTitle(R.string.history_clear_title)
                .setMessage(R.string.history_clear_message)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.delete, (dialog, which) -> {
                    PokeHistoryStore.clear(this);
                    renderHistory();
                }).show());
        refreshStatus();
        renderHistory();
    }

    @Override
    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(PokePollingService.ACTION_HISTORY_CHANGED);
        String permission = "fr.jecodelesoir.darkaurelienpoke.permission.INTERNAL";
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(historyReceiver, filter, permission, null, RECEIVER_NOT_EXPORTED);
        } else {
            // Avant Android 13, la permission de niveau signature protège ce receiver interne.
            registerReceiver(historyReceiver, filter, permission, null);
        }
    }

    @Override
    protected void onStop() {
        unregisterReceiver(historyReceiver);
        super.onStop();
    }

    private void importDeveloperTokenIfPresent() {
        Intent intent = getIntent();
        String token = intent.getStringExtra("setup_token");
        boolean debugBuild = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        intent.removeExtra("setup_token");
        if (!debugBuild || token == null || token.length() < 32 || token.length() > 256
                || !token.matches("^[A-Za-z0-9_-]+$")) return;
        try {
            SecureTokenStore.save(this, token);
        } catch (Exception ignored) {
            // L'écran permettra une saisie manuelle si le Keystore est indisponible.
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        restartPollingIfEnabled();
        refreshStatus();
        renderHistory();
    }

    private void restartPollingIfEnabled() {
        boolean enabled = getSharedPreferences(PokePollingService.PREFS, MODE_PRIVATE)
                .getBoolean(PokePollingService.ENABLED, false);
        if (enabled && !SecureTokenStore.load(this).isEmpty()) {
            startForegroundService(new Intent(this, PokePollingService.class));
        }
    }

    private void startNotifications() {
        hideError();
        String token = tokenInput.getText().toString().trim();
        if (token.length() < 32 || token.length() > 256) {
            showError(getString(R.string.token_required));
            tokenInput.requestFocus();
            return;
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
            showError(getString(R.string.notification_permission_required));
            return;
        }
        try {
            SecureTokenStore.save(this, token);
        } catch (Exception error) {
            showError("Impossible de protéger le jeton sur ce téléphone.");
            return;
        }
        getSharedPreferences(PokePollingService.PREFS, MODE_PRIVATE).edit()
                .putBoolean(PokePollingService.ENABLED, true).apply();
        startForegroundService(new Intent(this, PokePollingService.class));
        refreshStatus();
    }

    private void refreshStatus() {
        android.content.SharedPreferences prefs = getSharedPreferences(PokePollingService.PREFS, MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(PokePollingService.ENABLED, false);
        String lastError = prefs.getString(PokePollingService.LAST_ERROR, "");
        if (enabled && lastError != null && !lastError.isEmpty()) {
            statusText.setText(getString(R.string.status_error, lastError));
        } else {
            statusText.setText(enabled ? R.string.status_active : R.string.status_inactive);
        }
        statusText.setTextColor(getColor(enabled ? R.color.accent : R.color.text_secondary));
    }

    private void showError(String message) {
        errorText.setText(message);
        errorText.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        errorText.setVisibility(View.GONE);
    }

    private void renderHistory() {
        if (historyList == null) return;
        List<PokeHistoryStore.Entry> entries = PokeHistoryStore.load(this);
        historyList.removeAllViews();
        historyEmpty.setVisibility(entries.isEmpty() ? View.VISIBLE : View.GONE);
        DateFormat formatter = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT);
        int horizontal = dp(16);
        for (PokeHistoryStore.Entry entry : entries) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setBackgroundResource(R.drawable.panel);
            card.setPadding(horizontal, dp(14), horizontal, dp(14));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            params.bottomMargin = dp(12);
            card.setLayoutParams(params);

            TextView name = new TextView(this);
            name.setText("visit".equals(entry.kind) ? getString(R.string.visit_history) : entry.name);
            name.setTextColor(getColor(R.color.text_primary));
            name.setTextSize(17);
            name.setTypeface(name.getTypeface(), android.graphics.Typeface.BOLD);
            card.addView(name);

            TextView date = new TextView(this);
            date.setText(formatter.format(new Date(entry.createdAt * 1000L)));
            date.setTextColor(getColor(R.color.text_secondary));
            date.setTextSize(14);
            date.setPadding(0, dp(4), 0, 0);
            card.addView(date);
            historyList.addView(card);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
