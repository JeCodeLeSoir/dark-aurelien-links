package fr.jecodelesoir.darkaurelienpoke;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public final class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "PokeBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        boolean enabled = context.getSharedPreferences(PokePollingService.PREFS, Context.MODE_PRIVATE)
                .getBoolean(PokePollingService.ENABLED, false);
        if (!enabled || SecureTokenStore.load(context).isEmpty()) return;

        try {
            context.startForegroundService(new Intent(context, PokePollingService.class));
        } catch (RuntimeException error) {
            // Certains constructeurs bloquent les démarrages au boot. L'ouverture de l'app réessaiera.
            Log.w(TAG, "Unable to restart polling service", error);
        }
    }
}
