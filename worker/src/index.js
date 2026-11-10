const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_JSON_BYTES = 1000;
const VISITOR_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const POKE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const PUBLIC_SITE_URL = "https://jecodelesoir.github.io/dark-aurelien-links/";
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

function privateJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...BASE_SECURITY_HEADERS }
  });
}

async function secureTokenEquals(provided, expected) {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function isAppAuthorized(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  return secureTokenEquals(authorization.slice(7), env.APP_API_TOKEN);
}

async function getPokeNotifications(request, env, url) {
  if (request.method !== "GET") {
    return privateJson({ error: "Méthode non autorisée." }, 405);
  }
  if (!(await isAppAuthorized(request, env))) {
    return privateJson({ error: "Non autorisé." }, 401);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await env.APP_RATE_LIMITER.limit({ key: `app:${ip}` });
  if (!rateLimit.success) {
    return privateJson({ error: "Trop de requêtes." }, 429);
  }

  const rawAfter = url.searchParams.get("after") || "0";
  if (!/^\d{1,16}$/.test(rawAfter)) {
    return privateJson({ error: "Curseur invalide." }, 400);
  }
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) {
    return privateJson({ error: "Curseur invalide." }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.VISITORS_DB.prepare("DELETE FROM poke_notifications WHERE expires_at < ?")
    .bind(now)
    .run();
  const result = await env.VISITORS_DB.prepare(
    "SELECT id, kind, name, created_at FROM poke_notifications WHERE id > ? AND expires_at >= ? ORDER BY id ASC LIMIT 50"
  ).bind(after, now).all();

  return privateJson({
    notifications: (result.results || []).map((row) => ({
      id: Number(row.id),
      kind: row.kind === "visit" ? "visit" : "poke",
      name: String(row.name),
      createdAt: Number(row.created_at)
    }))
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
    await env.VISITORS_DB.prepare(
      "INSERT INTO poke_notifications (kind, name, created_at, expires_at) VALUES ('visit', 'Visite', ?, ?)"
    ).bind(now, now + POKE_RETENTION_SECONDS).run();
  }

  await env.VISITORS_DB.prepare("DELETE FROM visitors WHERE expires_at < ?")
    .bind(now)
    .run();

  const stats = await env.VISITORS_DB.prepare(
    "SELECT total FROM visitor_stats WHERE id = 1"
  ).first();
  return Number(stats?.total || 0);
}

async function getRecentLastFmTrack(env) {
  if (!env.LASTFM_API_KEY || !env.LASTFM_USERNAME) {
    throw new Error("LASTFM_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    method: "user.getrecenttracks",
    user: env.LASTFM_USERNAME,
    api_key: env.LASTFM_API_KEY,
    format: "json",
    limit: "1"
  });
  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error("LASTFM_UPSTREAM_ERROR");

  const data = await response.json();
  const source = data?.recenttracks?.track?.[0];
  if (!source || typeof source !== "object") return null;

  const images = Array.isArray(source.image)
    ? source.image.slice(-4).map((item) => ({
        "#text": typeof item?.["#text"] === "string" ? item["#text"] : "",
        size: typeof item?.size === "string" ? item.size : ""
      }))
    : [];

  return {
    name: typeof source.name === "string" ? source.name.slice(0, 300) : "",
    artist: { "#text": typeof source.artist?.["#text"] === "string" ? source.artist["#text"].slice(0, 300) : "" },
    url: typeof source.url === "string" ? source.url : "",
    image: images,
    "@attr": source["@attr"]?.nowplaying === "true" ? { nowplaying: "true" } : undefined
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return Response.redirect(PUBLIC_SITE_URL, 308);
    }

    // Cette ancienne route n'existe plus et ne doit jamais retomber sur le handler des pokes.
    if (url.pathname === "/youtube") {
      return privateJson({ error: "Route introuvable." }, 404);
    }

    // L'application Android n'est pas un navigateur : elle s'authentifie par jeton,
    // sans dépendre de CORS ni d'un en-tête Origin falsifiable.
    if (url.pathname === "/notifications") {
      try {
        return await getPokeNotifications(request, env, url);
      } catch (error) {
        console.error("Notification API unavailable", error instanceof Error ? error.message : "unknown");
        return privateJson({ error: "Service momentanément indisponible." }, 503);
      }
    }

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

    if (url.pathname === "/lastfm") {
      if (request.method !== "GET") {
        return json({ error: "Méthode non autorisée." }, 405, origin);
      }

      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateLimit = await env.APP_RATE_LIMITER.limit({ key: `lastfm:${ip}` });
      if (!rateLimit.success) {
        return json({ error: "Trop de requêtes." }, 429, origin);
      }

      try {
        const track = await getRecentLastFmTrack(env);
        return json({ track }, 200, origin);
      } catch (error) {
        console.error("Last.fm unavailable", error instanceof Error ? error.message : "unknown");
        return json({ error: "Lecture momentanément indisponible." }, 503, origin);
      }
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

    if (url.pathname !== "/") {
      return json({ error: "Route introuvable." }, 404, origin);
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

    const now = Math.floor(Date.now() / 1000);
    try {
      await env.VISITORS_DB.prepare(
        "INSERT INTO poke_notifications (kind, name, created_at, expires_at) VALUES ('poke', ?, ?, ?)"
      ).bind(name, now, now + POKE_RETENTION_SECONDS).run();
    } catch (error) {
      // Discord a déjà reçu le poke : ne pas provoquer un nouvel envoi par retry.
      console.error("Poke queue error", error instanceof Error ? error.message : "unknown");
    }

    return json({ ok: true }, 200, origin);
  }
};
