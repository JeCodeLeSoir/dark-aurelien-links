# Worker Poke → Discord

Le Worker reçoit un nom depuis le site, le valide, limite les envois et transmet le poke à Discord sans révéler le webhook.

## Déploiement

1. Supprime l'ancien webhook exposé et crée-en un nouveau dans Discord.
2. Depuis ce dossier, lance `npm install`.
3. Connecte Wrangler à Cloudflare avec `npx wrangler login`.
4. Enregistre le nouveau webhook comme secret avec `npx wrangler secret put DISCORD_WEBHOOK_URL`.
5. Active **YouTube Data API v3** dans Google Cloud, crée une clé API, puis enregistre-la avec `npx wrangler secret put YOUTUBE_API_KEY`.
6. Déploie avec `npm run deploy`.
7. Copie l'URL `https://dark-aurelien-poke.<ton-sous-domaine>.workers.dev` dans `config.js`, propriété `window.POKE_CONFIG.endpoint`.

Avant la publication finale, adapte `ALLOWED_ORIGINS` dans `wrangler.jsonc` si l'adresse GitHub Pages diffère de `https://jecodelesoir.github.io`.

Ne mets jamais le webhook dans `wrangler.jsonc`, `config.js` ou un fichier envoyé sur GitHub.
