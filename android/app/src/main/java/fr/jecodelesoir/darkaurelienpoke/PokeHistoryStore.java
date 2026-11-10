package fr.jecodelesoir.darkaurelienpoke;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PokeHistoryStore {
    static final class Entry {
        final long id;
        final String kind;
        final String name;
        final long createdAt;
        Entry(long id, String kind, String name, long createdAt) {
            this.id = id; this.kind = kind; this.name = name; this.createdAt = createdAt;
        }
    }

    private static final String KEY_ALIAS = "poke_history_key_v1";
    private static final String PREFS = "secure_poke_history";
    private static final String DATA = "history_ciphertext";
    private static final String IV = "history_iv";
    private static final int MAX_ENTRIES = 100;
    private static final long RETENTION_SECONDS = 7L * 24L * 60L * 60L;

    private PokeHistoryStore() {}

    static synchronized void add(Context context, long id, String kind, String name, long createdAt) {
        List<Entry> entries = load(context);
        for (Entry entry : entries) if (entry.id == id) return;
        entries.add(0, new Entry(id, kind, name, createdAt));
        save(context, entries);
    }

    static synchronized List<Entry> load(Context context) {
        List<Entry> result = new ArrayList<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String encrypted = prefs.getString(DATA, "");
        String iv = prefs.getString(IV, "");
        if (encrypted.isEmpty() || iv.isEmpty()) return result;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                    new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String json = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            JSONArray array = new JSONArray(json);
            long cutoff = System.currentTimeMillis() / 1000L - RETENTION_SECONDS;
            for (int index = 0; index < array.length() && result.size() < MAX_ENTRIES; index++) {
                JSONObject item = array.optJSONObject(index);
                if (item == null) continue;
                long id = item.optLong("id", -1);
                long createdAt = item.optLong("createdAt", 0);
                String name = item.optString("name", "").trim();
                String kind = "visit".equals(item.optString("kind", "poke")) ? "visit" : "poke";
                boolean validName = "visit".equals(kind) || (name.length() >= 2 && name.length() <= 32);
                if (id > 0 && createdAt >= cutoff && validName) {
                    result.add(new Entry(id, kind, name, createdAt));
                }
            }
        } catch (Exception error) {
            clear(context);
        }
        return result;
    }

    static synchronized void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    private static void save(Context context, List<Entry> entries) {
        try {
            JSONArray array = new JSONArray();
            long cutoff = System.currentTimeMillis() / 1000L - RETENTION_SECONDS;
            for (Entry entry : entries) {
                if (array.length() >= MAX_ENTRIES) break;
                if (entry.createdAt < cutoff) continue;
                array.put(new JSONObject().put("id", entry.id).put("kind", entry.kind)
                        .put("name", entry.name).put("createdAt", entry.createdAt));
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(array.toString().getBytes(StandardCharsets.UTF_8));
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString(DATA, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).apply();
        } catch (Exception ignored) {
            // L'historique est secondaire : une erreur de stockage ne doit pas arrêter les notifications.
        }
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
        return generator.generateKey();
    }
}
