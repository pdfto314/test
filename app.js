// =====================================================
// Jogatina Soundboard — Auto temas por pasta (GitHub API)
// Site: https://pdfto314.github.io/test/
// =====================================================

const OWNER = "pdfto314";
const REPO  = "test";
const BRANCH = "main";        // se não funcionar, troque para "master"
const AUDIO_ROOT = "audio";   // pasta /audio no repo

// Cache
const CACHE_TTL_MS = 10 * 60 * 1000;
let CACHE = { ts: 0, themes: null };

// Estado
let THEMES = {};              // { folder: [{name,url}] }
let currentTheme = null;

// Elementos
const themeGrid  = document.getElementById("themeGrid");
const modal      = document.getElementById("modal");
const themeTitle = document.getElementById("themeTitle");
const trackList  = document.getElementById("trackList");
const themeSearch= document.getElementById("themeSearch");
const closeBtn   = document.getElementById("closeBtn");

// -----------------------------------------------------
// Utils
// -----------------------------------------------------
function isIOS(){
  // iPadOS 13+ pode aparecer como MacIntel com touch
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function removeFocus(){
  document.activeElement?.blur?.();
}

// path seguro SEM quebrar as barras "/"
function safePath(path){
  return path.split("/").map(encodeURIComponent).join("/");
}

async function listGithubDir(path){
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${safePath(path)}?ref=${BRANCH}`;
  const r = await fetch(api, { cache: "no-store" });

  if (!r.ok){
    let msg = "";
    try{
      const j = await r.json();
      if (j?.message) msg = ` — ${j.message}`;
    }catch(_){}
    throw new Error(`GitHub API erro ${r.status} em "${path}"${msg}`);
  }

  return r.json();
}

// -----------------------------------------------------
// Render temas
// -----------------------------------------------------
function renderThemes(){
  themeGrid.innerHTML = "";

  const folders = Object.keys(THEMES).sort((a,b)=>a.localeCompare(b, "pt-BR"));

  if (!folders.length){
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "Nenhum tema encontrado. Verifique a pasta /audio.";
    themeGrid.appendChild(div);
    return;
  }

  folders.forEach(folder => {
    const card = document.createElement("div");
    card.className = "theme-card";
    card.textContent = folder;
    card.addEventListener("click", () => openTheme(folder));
    themeGrid.appendChild(card);
  });
}

// -----------------------------------------------------
// Modal
// -----------------------------------------------------
function openTheme(folder){
  currentTheme = folder;
  themeTitle.textContent = folder;
  modal.classList.remove("hidden");

  // limpa busca
  themeSearch.value = "";

  // iPad: não foca automaticamente (evita abrir teclado)
  if (!isIOS()) themeSearch.focus();
  else themeSearch.blur();

  renderTrackList();
}

function closeModal(){
  modal.classList.add("hidden");
  removeFocus();
}

// -----------------------------------------------------
// Lista de faixas
// -----------------------------------------------------
function renderTrackList(filter=""){
  trackList.innerHTML = "";

  const files = THEMES[currentTheme] || [];
  const q = (filter || "").toLowerCase().trim();

  const filtered = files.filter(f => f.name.toLowerCase().includes(q));

  if (!filtered.length){
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "Nenhum áudio encontrado.";
    trackList.appendChild(div);
    return;
  }

  filtered.forEach(f => {
    const row = document.createElement("div");
    row.className = "track";

    const title = document.createElement("div");
    title.className = "track-title";
    title.textContent = f.name;

    const amb = document.createElement("button");
    amb.className = "btn";
    amb.type = "button";
    amb.textContent = "🌫️ Ambiente";

    const efx = document.createElement("button");
    efx.className = "btn";
    efx.type = "button";
    efx.textContent = "⚡ Efeito";

    amb.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeFocus();
      playAmbient(f.url, amb);
    });

    efx.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeFocus();
      playEffect(f.url);
    });

    row.appendChild(title);
    row.appendChild(amb);
    row.appendChild(efx);
    trackList.appendChild(row);
  });
}

// -----------------------------------------------------
// Player simples
// -----------------------------------------------------
function playAmbient(url, btn){
  // se já tem um ambiente tocando nesse botão, para
  const prev = btn._audio;
  if (prev){
    prev.pause();
    btn._audio = null;
    btn.textContent = "🌫️ Ambiente";
    return;
  }

  // cria novo loop
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = 0.55;

  audio.play().catch(err => {
    console.warn("Play bloqueado pelo browser:", err);
    alert("O navegador bloqueou o play automático. Toque novamente no botão.");
  });

  btn._audio = audio;
  btn.textContent = "⏹️ Parar";
}

function playEffect(url){
  const audio = new Audio(url);
  audio.volume = 0.85;
  audio.play().catch(err => {
    console.warn("Play bloqueado pelo browser:", err);
    alert("O navegador bloqueou o play automático. Toque novamente no botão.");
  });
}

// -----------------------------------------------------
// Load
// -----------------------------------------------------
async function loadThemes(){
  const now = Date.now();
  if (CACHE.themes && (now - CACHE.ts < CACHE_TTL_MS)){
    THEMES = CACHE.themes;
    renderThemes();
    return;
  }

  try{
    // lista pastas dentro de /audio
    const root = await listGithubDir(AUDIO_ROOT);

    const folders = root.filter(x => x.type === "dir");
    const out = {};

    for (const folder of folders){
      const files = await listGithubDir(`${AUDIO_ROOT}/${folder.name}`);

      out[folder.name] = files
        .filter(f => f.type === "file" && /\.mp3$/i.test(f.name))
        .map(f => ({
          name: f.name.replace(/\.mp3$/i, ""),
          url: f.download_url
        }))
        .sort((a,b)=>a.name.localeCompare(b.name, "pt-BR"));
    }

    THEMES = out;
    CACHE = { ts: now, themes: out };
    renderThemes();

  }catch(err){
    console.error(err);
    alert(`Erro ao carregar temas do GitHub:\n${err.message}`);
  }
}

// -----------------------------------------------------
// Eventos
// -----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadThemes();

  themeSearch?.addEventListener("input", (e) => {
    renderTrackList(e.target.value);
  });

  closeBtn?.addEventListener("click", closeModal);

  // fechar modal clicando fora
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // iOS: se tocar fora de input, remove foco (fecha teclado)
  document.addEventListener("touchstart", (e) => {
    if (!e.target.matches("input, textarea")) removeFocus();
  }, { passive: true });
});
