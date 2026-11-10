# Dark Aurélien Poke — Android

Mini application Android native (API 26+) qui interroge le Worker toutes les 30 secondes et affiche les nouveaux pokes. L’envoi Discord existant reste actif.

## Configuration

1. Définir `APP_API_TOKEN` comme secret Cloudflare Worker.
2. Appliquer la migration D1 `0002_poke_notifications.sql` puis redéployer le Worker.
3. Compiler et installer l’application avec Android Studio.
4. Ouvrir l’app, coller le même jeton privé et toucher **Activer les notifications**.

Le jeton est chiffré par une clé AES-256 conservée dans le Keystore Android. Il n’est pas présent dans le dépôt ni codé dans l’APK.

## Fonctionnement et limite Android

L’app utilise un service au premier plan, visible via une notification permanente, afin de vérifier les pokes rapidement. Sans Firebase Cloud Messaging, Android ne garantit pas un polling discret et fréquent : `WorkManager` impose au minimum 15 minutes et peut encore retarder l’exécution.

La file D1 conserve les noms/pseudos pendant sept jours, puis le Worker les supprime automatiquement.
