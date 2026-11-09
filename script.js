const spotifyProfile = "https://open.spotify.com/user/312d4xhikcxopuz43wpksnzkidtu?si=f4c9bb6df4f74379";
const musicConfig = window.MUSIC_CONFIG || {};

const snapCard = document.querySelector("#snapchat-card");
const snapLabel = document.querySelector("#snap-label");
const toast = document.querySelector("#toast");

snapCard.addEventListener("click", async () => {
  const username = snapCard.dataset.username;
  try {
    await navigator.clipboard.writeText(username);
    snapLabel.textContent = `${username} · copié !`;
    toast.classList.add("show");
    window.setTimeout(() => {
      toast.classList.remove("show");
      snapLabel.textContent = `${username} · cliquer pour copier`;
    }, 1800);
  } catch {
    window.location.href = `https://www.snapchat.com/add/${username}`;
  }
});

function setTrack(track) {
  const isPlaying = track["@attr"]?.nowplaying === "true";
  const image = [...(track.image || [])].reverse().find((item) => item["#text"])?.["#text"];
  const trackLink = document.querySelector("#track-link");

  document.querySelector("#track-name").textContent = track.name || "Titre inconnu";
  document.querySelector("#artist-name").textContent = track.artist?.["#text"] || "Artiste inconnu";
  document.querySelector("#spotify-note").textContent = isPlaying
    ? "Actualisé automatiquement toutes les 30 secondes via Last.fm."
    : "Dernier titre écouté · actualisé via Last.fm.";
  trackLink.href = track.url || spotifyProfile;

  if (image) {
    const cover = document.createElement("img");
    cover.src = image;
    cover.alt = "";
    document.querySelector("#album-art").replaceChildren(cover);
  }

  const livePill = document.querySelector("#live-pill");
  livePill.innerHTML = `<span></span> ${isPlaying ? "EN DIRECT" : "DERNIÈRE ÉCOUTE"}`;
  livePill.classList.toggle("is-live", isPlaying);
  document.querySelector("#equalizer").classList.toggle("is-playing", isPlaying);
  prepareYouTube(track);
}

let currentYouTubeId = "";
let currentYouTubeQuery = "";

async function prepareYouTube(track) {
  const workerEndpoint = window.POKE_CONFIG?.endpoint?.trim();
  const button = document.querySelector("#youtube-listen");
  const player = document.querySelector("#youtube-player");
  const artist = track.artist?.["#text"] || "";
  const title = track.name || "";
  const query = `${artist} ${title}`.trim();
  if (!workerEndpoint || !query || query === currentYouTubeQuery) return;

  currentYouTubeQuery = query;
  currentYouTubeId = "";
  button.hidden = true;
  player.hidden = true;
  player.replaceChildren();

  try {
    const base = workerEndpoint.replace(/\/$/, "");
    const response = await fetch(`${base}/youtube?q=${encodeURIComponent(query)}`);
    if (!response.ok) return;
    const result = await response.json();
    if (result.videoId) {
      currentYouTubeId = result.videoId;
      button.hidden = false;
    }
  } catch (error) {
    console.warn("Recherche YouTube indisponible :", error);
  }
}

document.querySelector("#youtube-listen").addEventListener("click", () => {
  if (!currentYouTubeId) return;
  const player = document.querySelector("#youtube-player");
  const iframe = document.createElement("iframe");
  const origin = encodeURIComponent(window.location.origin);
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(currentYouTubeId)}?playsinline=1&origin=${origin}`;
  iframe.title = "Lecteur YouTube du morceau en cours";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  player.replaceChildren(iframe);
  player.hidden = false;
  document.querySelector("#youtube-listen").hidden = true;
});

async function refreshLastFm() {
  const { lastfmUsername, lastfmApiKey } = musicConfig;
  if (!lastfmUsername || !lastfmApiKey) return;

  const params = new URLSearchParams({
    method: "user.getrecenttracks",
    user: lastfmUsername,
    api_key: lastfmApiKey,
    format: "json",
    limit: "1"
  });

  try {
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    if (!response.ok) throw new Error("Réponse Last.fm invalide");
    const data = await response.json();
    const track = data.recenttracks?.track?.[0];
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
  const endpoint = window.POKE_CONFIG?.endpoint?.trim();
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

  pokeButton.disabled = true;
  setPokeStatus("Envoi du poke…");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, website })
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
    updatePokeCooldown();
  }
});

updatePokeCooldown();

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
