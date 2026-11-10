# Worker Poke → Discord

Le Worker reçoit un nom depuis le site, le valide, limite les envois et transmet le poke à Discord sans révéler le webhook.

## Déploiement

1. Supprime l'ancien webhook exposé et crée-en un nouveau dans Discord.
2. Depuis ce dossier, lance `npm install`.
3. Connecte Wrangler à Cloudflare avec `npx wrangler login`.
4. Enregistre le nouveau webhook comme secret avec `npx wrangler secret put DISCORD_WEBHOOK_URL`.
5. Crée un widget Cloudflare Turnstile pour le domaine du site et enregistre son secret avec `npx wrangler secret put TURNSTILE_SECRET_KEY`.
6. Enregistre la clé Last.fm avec `npx wrangler secret put LASTFM_API_KEY` et garde uniquement le nom public dans `wrangler.jsonc`.
7. Place uniquement le `sitekey` public Turnstile et l'URL publique du Worker dans `script.js`. Le secret ne doit jamais être ajouté au dépôt.
8. Déploie avec `npm run deploy`.

Avant la publication finale, adapte `ALLOWED_ORIGINS` dans `wrangler.jsonc` si l'adresse GitHub Pages diffère de `https://jecodelesoir.github.io`.

Ne mets jamais le webhook, le secret Turnstile, la clé Last.fm ou le jeton Android dans `wrangler.jsonc`, `script.js` ou un fichier envoyé sur GitHub.
