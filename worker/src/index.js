const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (!origin) {
      return new Response("Origine refusée", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname === "/youtube") {
      if (request.method !== "GET") {
        return json({ error: "Méthode non autorisée." }, 405, origin);
      }

      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 2 || query.length > 100) {
        return json({ error: "Recherche invalide." }, 400, origin);
      }

      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateLimit = await env.POKE_RATE_LIMITER.limit({ key: `youtube:${ip}` });
      if (!rateLimit.success) {
        return json({ error: "Trop de recherches. Réessaie dans une minute." }, 429, origin);
      }

      const cacheKey = new Request(`https://youtube-cache.invalid/v2/${encodeURIComponent(query.toLowerCase())}`);
      let videoData = await caches.default.match(cacheKey);

      if (!videoData) {
        const search = new URL("https://www.googleapis.com/youtube/v3/search");
        search.search = new URLSearchParams({
          part: "snippet",
          type: "video",
          videoCategoryId: "10",
          videoEmbeddable: "true",
          videoSyndicated: "true",
          maxResults: "1",
          q: `${query} audio official`,
          key: env.YOUTUBE_API_KEY
        });

        const youtubeResponse = await fetch(search);
        if (!youtubeResponse.ok) {
          console.error("YouTube API error", youtubeResponse.status);
          return json({ error: "Recherche YouTube indisponible." }, 502, origin);
        }

        const youtubeData = await youtubeResponse.json();
        const item = youtubeData.items?.[0];
        videoData = new Response(JSON.stringify({
          videoId: item?.id?.videoId || "",
          title: item?.snippet?.title || ""
        }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=21600" }
        });
        await caches.default.put(cacheKey, videoData.clone());
      }

      const result = await videoData.json();
      return json(result, result.videoId ? 200 : 404, origin);
    }

    if (request.method !== "POST") {
      return json({ error: "Méthode non autorisée." }, 405, origin);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      return json({ error: "Format invalide." }, 415, origin);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 1000) {
      return json({ error: "Requête trop volumineuse." }, 413, origin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateLimit = await env.POKE_RATE_LIMITER.limit({ key: ip });
    if (!rateLimit.success) {
      return json({ error: "Trop de pokes. Réessaie dans une minute." }, 429, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON invalide." }, 400, origin);
    }

    // Champ invisible : un robot qui le remplit reçoit une fausse réussite.
    if (typeof body.website === "string" && body.website.length > 0) {
      return json({ ok: true }, 200, origin);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 32) {
      return json({ error: "Le nom doit contenir entre 2 et 32 caractères." }, 400, origin);
    }

    if (!/^[\p{L}\p{N} @._'’\-]+$/u.test(name)) {
      return json({ error: "Ce nom contient des caractères non autorisés." }, 400, origin);
    }

    const discordResponse = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `👉 **${name.replaceAll("@", "＠")}** vient de t’envoyer un poke depuis ton site !`,
        allowed_mentions: { parse: [] }
      })
    });

    if (!discordResponse.ok) {
      console.error("Discord webhook error", discordResponse.status);
      return json({ error: "Le service est momentanément indisponible." }, 502, origin);
    }

    return json({ ok: true }, 200, origin);
  }
};
