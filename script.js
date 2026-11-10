const workerEndpoint = "https://dark-aurelien-poke.dark-aurelien-poke-worker.workers.dev";
const turnstileSiteKey = "0x4AAAAAAF5vf-vpEwp1qWvS";

function configureMobileAppLinks() {
  const userAgent = navigator.userAgent || "";
  const isAndroid = /Android/i.test(userAgent);
  const isMobileApple = /iPhone|iPad|iPod/i.test(userAgent);
  if (!isAndroid && !isMobileApple) return;

  document.querySelectorAll("a[data-android-package]").forEach((link) => {
    link.removeAttribute("target");
    if (!isAndroid) return;

    const fallback = link.href;
    const url = new URL(link.dataset.androidDeepLink || fallback);
    const packageName = link.dataset.androidPackage;
    const scheme = url.protocol.slice(0, -1);
    link.href = `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=${packageName};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  });
}

configureMobileAppLinks();

const toast = document.querySelector("#toast");

let toastTimer = 0;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1900);
}

const shareButton = document.querySelector("#share-button");
const publicSiteUrl = "https://jecodelesoir.github.io/dark-aurelien-links/";

shareButton.addEventListener("click", async () => {
  const shareData = {
    title: "Dark Aurélien — Mes réseaux",
    text: "Retrouve tous mes réseaux au même endroit.",
    url: publicSiteUrl
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showToast("Lien partagé");
    } else {
      await navigator.clipboard.writeText(publicSiteUrl);
      showToast("Lien copié");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("Partage indisponible");
  }
});

function setTrack(track) {
  const isPlaying = track["@attr"]?.nowplaying === "true";
  const image = [...(track.image || [])].reverse().find((item) => item["#text"])?.["#text"];
  document.querySelector("#track-name").textContent = track.name || "Titre inconnu";
  document.querySelector("#artist-name").textContent = track.artist?.["#text"] || "Artiste inconnu";
  document.querySelector("#spotify-note").textContent = isPlaying
    ? "Actualisé automatiquement toutes les 30 secondes via Last.fm."
    : "Dernier titre écouté · actualisé via Last.fm.";
  if (image) {
    const cover = document.createElement("img");
    cover.src = image;
    cover.alt = "";
    document.querySelector("#album-art").replaceChildren(cover);
  }

  const livePill = document.querySelector("#live-pill");
  livePill.replaceChildren(
    document.createElement("span"),
    document.createTextNode(` ${isPlaying ? "EN DIRECT" : "DERNIÈRE ÉCOUTE"}`)
  );
  livePill.classList.toggle("is-live", isPlaying);
  document.querySelector("#equalizer").classList.toggle("is-playing", isPlaying);
}

async function refreshLastFm() {
  try {
    const response = await fetch(`${workerEndpoint}/lastfm`, { cache: "no-store" });
    if (!response.ok) throw new Error("Réponse Last.fm invalide");
    const data = await response.json();
    const track = data.track;
    if (track) setTrack(track);
  } catch (error) {
    console.warn("Impossible d’actualiser Last.fm :", error);
    document.querySelector("#spotify-note").textContent = "Le direct est momentanément indisponible. Ouvrir mon profil Spotify.";
  }
}

refreshLastFm();
window.setInterval(refreshLastFm, 30_000);

const pokeForm = document.querySelector("#poke-form");
const pokeButton = document.querySelector("#poke-button");
const pokeStatus = document.querySelector("#poke-status");
const pokeButtonLabel = pokeButton.querySelector("span");
const POKE_COOLDOWN_MS = 60_000;
const POKE_COOLDOWN_KEY = "dark-aurelien-poke-cooldown";
let pokeCooldownTimer = 0;
let turnstileWidgetId = null;
let turnstileToken = "";

function initializeTurnstile(attempt = 0) {
  const sitekey = turnstileSiteKey;
  if (!sitekey || sitekey === "TURNSTILE_SITE_KEY") {
    pokeButton.disabled = true;
    setPokeStatus("La protection anti-robot n’est pas encore configurée.", "error");
    return;
  }

  if (!window.turnstile) {
    if (attempt < 40) window.setTimeout(() => initializeTurnstile(attempt + 1), 250);
    else setPokeStatus("La protection anti-robot n’a pas pu charger.", "error");
    return;
  }

  const turnstileSize = window.matchMedia("(max-width: 380px)").matches ? "compact" : "normal";
  turnstileWidgetId = window.turnstile.render("#turnstile-wrap", {
    sitekey,
    theme: "dark",
    size: turnstileSize,
    callback(token) {
      turnstileToken = token;
      updatePokeCooldown();
    },
    "expired-callback"() {
      turnstileToken = "";
    },
    "error-callback"() {
      turnstileToken = "";
      setPokeStatus("La vérification anti-robot a échoué.", "error");
    }
  });
}

function setPokeStatus(message, type = "") {
  pokeStatus.textContent = message;
  pokeStatus.className = `form-status ${type}`.trim();
}

function updatePokeCooldown() {
  const lastPoke = Number(localStorage.getItem(POKE_COOLDOWN_KEY) || 0);
  const remaining = Math.max(0, POKE_COOLDOWN_MS - (Date.now() - lastPoke));

  if (remaining > 0) {
    pokeButton.disabled = true;
    pokeButtonLabel.textContent = `Attends ${Math.ceil(remaining / 1000)}s`;
    clearTimeout(pokeCooldownTimer);
    pokeCooldownTimer = window.setTimeout(updatePokeCooldown, 250);
    return true;
  }

  pokeButton.disabled = false;
  pokeButtonLabel.textContent = "Poke";
  clearTimeout(pokeCooldownTimer);
  return false;
}

pokeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (updatePokeCooldown()) {
    setPokeStatus("Tu peux envoyer un poke par minute.", "error");
    return;
  }
  const endpoint = workerEndpoint;
  const formData = new FormData(pokeForm);
  const name = String(formData.get("name") || "").trim();
  const website = String(formData.get("website") || "");

  if (!endpoint) {
    setPokeStatus("Le bouton Poke n’est pas encore connecté au Worker.", "error");
    return;
  }

  if (name.length < 2 || name.length > 32) {
    setPokeStatus("Entre un nom ou pseudo de 2 à 32 caractères.", "error");
    return;
  }

  if (!turnstileToken) {
    setPokeStatus("Valide d’abord la vérification anti-robot.", "error");
    return;
  }

  pokeButton.disabled = true;
  setPokeStatus("Envoi du poke…");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, website, turnstileToken })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Impossible d’envoyer le poke.");

    pokeForm.reset();
    localStorage.setItem(POKE_COOLDOWN_KEY, String(Date.now()));
    updatePokeCooldown();
    setPokeStatus("Poke envoyé avec succès !", "success");
  } catch (error) {
    setPokeStatus(error.message || "Une erreur est survenue.", "error");
  } finally {
    turnstileToken = "";
    if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
    updatePokeCooldown();
  }
});

updatePokeCooldown();
initializeTurnstile();

const customCursor = document.querySelector("#custom-cursor");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

if (finePointer.matches && customCursor) {
  document.documentElement.classList.add("cursor-ready");
  const cursorPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const cursorTarget = { ...cursorPosition };

  window.addEventListener("pointermove", (event) => {
    cursorTarget.x = event.clientX;
    cursorTarget.y = event.clientY;
    customCursor.classList.add("visible");
  }, { passive: true });

  document.addEventListener("pointerover", (event) => {
    customCursor.classList.toggle("hovering", Boolean(event.target.closest("a, button, input")));
  });

  document.addEventListener("pointerdown", () => customCursor.classList.add("clicking"));
  document.addEventListener("pointerup", () => customCursor.classList.remove("clicking"));
  document.documentElement.addEventListener("mouseleave", () => customCursor.classList.remove("visible"));
  window.addEventListener("blur", () => customCursor.classList.remove("visible"));

  function animateCursor() {
    cursorPosition.x += (cursorTarget.x - cursorPosition.x) * 0.2;
    cursorPosition.y += (cursorTarget.y - cursorPosition.y) * 0.2;
    customCursor.style.left = `${cursorPosition.x}px`;
    customCursor.style.top = `${cursorPosition.y}px`;
    requestAnimationFrame(animateCursor);
  }

  animateCursor();
}

const profileTitle = document.querySelector("#profile-title");
let titleActivations = 0;
let titleActivationTimer = 0;

function toggleIronMode() {
  const enabled = document.body.classList.toggle("iron-mode");
  document.querySelector('meta[name="theme-color"]').content = enabled ? "#330909" : "#07070a";
  profileTitle.setAttribute("aria-pressed", String(enabled));
  window.dispatchEvent(new CustomEvent("iron-mode-change", { detail: { enabled } }));
  showToast(enabled ? "MODE IRON ACTIVÉ" : "Mode Iron désactivé");
}

function registerTitleActivation() {
  if (document.body.classList.contains("iron-mode")) {
    toggleIronMode();
    return;
  }

  titleActivations += 1;
  window.clearTimeout(titleActivationTimer);
  titleActivationTimer = window.setTimeout(() => { titleActivations = 0; }, 6000);
  if (titleActivations >= 5) {
    titleActivations = 0;
    toggleIronMode();
  }
}

profileTitle.addEventListener("click", registerTitleActivation);
profileTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    registerTitleActivation();
  }
});

if (finePointer.matches && profileTitle) {
  profileTitle.addEventListener("pointermove", (event) => {
    const rect = profileTitle.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const rotateY = (x - 0.5) * 12;
    const rotateX = (0.5 - y) * 10;

    profileTitle.style.setProperty("--title-x", `${x * 100}%`);
    profileTitle.style.setProperty("--title-y", `${y * 100}%`);
    profileTitle.style.setProperty("--title-shine", ".9");
    profileTitle.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(8px)`;
    profileTitle.classList.add("title-active");
  });

  profileTitle.addEventListener("pointerleave", () => {
    profileTitle.style.setProperty("--title-shine", "0");
    profileTitle.style.transform = "rotateX(0deg) rotateY(0deg) translateZ(0)";
    profileTitle.classList.remove("title-active");
  });
}

const visitorCount = document.querySelector("#visitor-count");

async function loadVisitorCount() {
  if (!visitorCount || !workerEndpoint) return;

  try {
    const response = await fetch(`${workerEndpoint.replace(/\/$/, "")}/visits`, {
      method: "GET",
      cache: "no-store"
    });
    const result = await response.json();
    if (!response.ok || !Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error("INVALID_VISITOR_COUNT");
    }
    visitorCount.textContent = `${result.count.toLocaleString("fr-FR")} visite${result.count > 1 ? "s" : ""}`;
  } catch {
    visitorCount.textContent = "Visites indisponibles";
  }
}

loadVisitorCount();
