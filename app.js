// =====================================================
// Jogatina Soundboard — Auto temas por pasta (GitHub API)
// Repo: https://pdfto314.github.io/test/
// =====================================================

const OWNER = "pdfto314";
const REPO  = "test";
const BRANCH = "main"; // Se não funcionar, troque para "master"
const AUDIO_ROOT = "audio";

// Cache
const CACHE_TTL_MS = 10 * 60 * 1000;
let CACHE = { ts: 0, themes: null };

// Estado
let THEMES = {};
let currentTheme = null;

function $(id){ return document.getElementById(id); }

// Detectar iPad/iPhone corretamente (inclusive iPadOS moderno)
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Remove foco de qualquer input (fecha teclado)
function removeFocus(){
  if (document.activeElement) {
    document.activeElement.blur();
  }
}

async function fetchFromGitHub(path){
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erro ao acessar GitHub");
  return res.json();
}

async function loadThemes(){
  const now = Date.now();
  if (CACHE.themes && (now - CACHE.ts < CACHE_TTL_MS)){
    THEMES = CACHE.themes;
    renderThemes();
    return;
  }

  try {
    const folders = await fetchFromGitHub(AUDIO_ROOT);

    THEMES = {};

    for (let folder of folders){
      if (folder.type !== "dir") continue;

      const files = await fetchFromGitHub(`${AUDIO_ROOT}/${folder.name}`);
      THEMES[folder.name] = files
        .filter(f => f.type === "file" && f.name.endsWith(".mp3"))
        .map(f => ({
          name: f.name.replace(".mp3", ""),
          url: f.download_url
        }));
    }

    CACHE = { ts: now, themes: THEMES };
    renderThemes();

  } catch (e){
    console.error(e);
    alert("Erro ao carregar temas do GitHub.");
  }
}

function renderThemes(){
  const grid = $("themeGrid");
  grid.innerHTML = "";

  Object.keys(THEMES).forEach(folder => {
    const card = document.createElement("div");
    card.className = "theme-card";
    card.innerText = folder;

    card.onclick = () => openTheme(folder);

    grid.appendChild(card);
  });
}

function openTheme(folder){
  currentTheme = folder;
  $("themeTitle").innerText = folder;
  $("modal").classList.remove("hidden");

  const search = $("themeSearch");
  search.value = "";

  // 🔥 NÃO abrir teclado automaticamente no iPad
  if (!isIOS()){
    search.focus();
  } else {
    search.blur();
  }

  renderTrackList();
}

function closeModal(){
  $("modal").classList.add("hidden");
  removeFocus();
}

function renderTrackList(filter=""){
  const list = $("trackList");
  list.innerHTML = "";

  const files = THEMES[currentTheme] || [];

  files
    .filter(f => f.name.toLowerCase().includes(filter.toLowerCase()))
    .forEach(f => {

      const row = document.createElement("div");
      row.className = "track";

      const title = document.createElement("div");
      title.innerText = f.name;

      const amb = document.createElement("button");
      amb.innerText = "🌫️ Ambiente";

      amb.onclick = () => {
        removeFocus();
        playAmbient(f.url, amb);
      };

      const efx = document.createElement("button");
      efx.innerText = "⚡ Efeito";

      efx.onclick = () => {
        removeFocus();
        playEffect(f.url);
      };

      row.appendChild(title);
      row.appendChild(amb);
      row.appendChild(efx);

      list.appendChild(row);
    });
}

function playAmbient(url, btn){
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = 0.5;
  audio.play();

  btn.innerText = "⏹️ Parar";

  btn.onclick = () => {
    audio.pause();
    btn.innerText = "🌫️ Ambiente";
    btn.onclick = () => {
      removeFocus();
      playAmbient(url, btn);
    };
  };
}

function playEffect(url){
  const audio = new Audio(url);
  audio.volume = 0.8;
  audio.play();
}

document.addEventListener("DOMContentLoaded", () => {
  loadThemes();

  $("themeSearch").addEventListener("input", (e) => {
    renderTrackList(e.target.value);
  });
});
