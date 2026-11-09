const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_JSON_BYTES = 1000;
const VISITOR_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const BASE_SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

async function readJsonWithLimit(request, maxBytes = MAX_JSON_BYTES) {
  if (!request.body) throw new Error("INVALID_JSON");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function verifyTurnstile(token, ip, secret) {
  if (!token || !secret) return false;
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...BASE_SECURITY_HEADERS,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
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

async function hashVisitorIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function registerVisit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || !env.VISITOR_HASH_SALT) throw new Error("VISITOR_UNAVAILABLE");

  const now = Math.floor(Date.now() / 1000);
  const fingerprint = await hashVisitorIp(ip, env.VISITOR_HASH_SALT);
  const inserted = await env.VISITORS_DB.prepare(
    "INSERT OR IGNORE INTO visitors (fingerprint, first_seen, expires_at) VALUES (?, ?, ?)"
  ).bind(fingerprint, now, now + VISITOR_RETENTION_SECONDS).run();

  if (inserted.meta.changes === 1) {
    await env.VISITORS_DB.prepare(
      "UPDATE visitor_stats SET total = total + 1 WHERE id = 1"
    ).run();
  }

  await env.VISITORS_DB.prepare("DELETE FROM visitors WHERE expires_at < ?")
    .bind(now)
    .run();

  const stats = await env.VISITORS_DB.prepare(
    "SELECT total FROM visitor_stats WHERE id = 1"
  ).first();
  return Number(stats?.total || 0);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (!origin) {
      return new Response("Origine refusée", { status: 403, headers: BASE_SECURITY_HEADERS });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin",
          ...BASE_SECURITY_HEADERS
        }
      });
    }

    if (url.pathname === "/visits") {
      if (request.method !== "GET") {
        return json({ error: "Méthode non autorisée." }, 405, origin);
      }

      try {
        const count = await registerVisit(request, env);
        return json({ count }, 200, origin);
      } catch {
        return json({ error: "Compteur momentanément indisponible." }, 503, origin);
      }
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

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateLimit = await env.POKE_RATE_LIMITER.limit({ key: ip });
    if (!rateLimit.success) {
      return json({ error: "Trop de pokes. Réessaie dans une minute." }, 429, origin);
    }

    let body;
    try {
      body = await readJsonWithLimit(request);
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") {
        return json({ error: "Requête trop volumineuse." }, 413, origin);
      }
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

    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    if (!(await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET_KEY))) {
      return json({ error: "Vérification anti-robot invalide." }, 403, origin);
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
