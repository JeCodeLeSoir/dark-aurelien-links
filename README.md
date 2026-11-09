# al0.js — page de liens

Page statique, responsive et sans backend, prête pour GitHub Pages.

## Publier sur GitHub Pages

1. Envoie ces fichiers dans un dépôt GitHub.
2. Ouvre **Settings → Pages**.
3. Dans **Build and deployment**, choisis **Deploy from a branch**.
4. Sélectionne la branche `main`, le dossier `/ (root)`, puis **Save**.

## Afficher tes écoutes

Spotify ne permet pas d’exposer publiquement l’écoute d’un compte depuis un site statique sans publier un jeton personnel sensible. La page utilise donc Last.fm comme relais public :

1. Crée un compte Last.fm et relie Spotify depuis les paramètres Last.fm (scrobbling).
2. Crée une clé API sur <https://www.last.fm/api/account/create>.
3. Dans `config.js`, renseigne `lastfmUsername` et `lastfmApiKey`.

La carte affiche alors le titre en cours, ou le dernier titre écouté, et se rafraîchit toutes les 30 secondes.
