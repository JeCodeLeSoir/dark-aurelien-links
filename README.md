# al0.js — page de liens

Page statique et responsive sur GitHub Pages, reliée à un Cloudflare Worker pour les fonctions qui nécessitent des secrets.

## Publier sur GitHub Pages

1. Envoie ces fichiers dans un dépôt GitHub.
2. Ouvre **Settings → Pages**.
3. Dans **Build and deployment**, choisis **Deploy from a branch**.
4. Sélectionne la branche `main`, le dossier `/ (root)`, puis **Save**.

## Afficher tes écoutes

Spotify ne permet pas d’exposer publiquement l’écoute d’un compte depuis un site statique sans publier un jeton personnel sensible. La page utilise donc Last.fm comme relais public :

1. Crée un compte Last.fm et relie Spotify depuis les paramètres Last.fm (scrobbling).
2. Crée une clé API sur <https://www.last.fm/api/account/create>.
3. Enregistre la clé côté Worker avec `npx wrangler secret put LASTFM_API_KEY`.
4. Configure le nom public Last.fm dans `worker/wrangler.jsonc`, propriété `LASTFM_USERNAME`.

La carte affiche alors le titre en cours, ou le dernier titre écouté, et se rafraîchit toutes les 30 secondes.
