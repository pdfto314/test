// =====================================================
// Jogatina Soundboard — Auto temas por pasta (GitHub API)
// Repo: https://zimbpdf0.github.io/Pdf001/
// OWNER/REPO já configurados
// =====================================================

const OWNER = "zimbpdf0";
const REPO  = "Pdf001";
const BRANCH = "main";
const AUDIO_ROOT = "audio";

// Cache (pra não bater na API toda hora)
const CACHE_KEY = "jsb_cache_v1";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

// 2 canais: ambiente (loop) + efeitos (one-shot e pode sobrepor)
let ambientAudio = null;
let ambientNowBtn = null;

let effectAudios = [];
const MAX_EFFECTS = 6;

// iOS/Safari/Edge costumam exigir “unlock” por gesto do usuário
let audioUnlocked = false;
let audioCtx = null;

function $(id){ return document.getElementById(id); }

function setPill(ok, text){
  const dot = $("audioDot");
  const label = $("audioText");
  if (!dot || !label) return;

  if (ok === true){
    dot.style.background = "var(--good)";
    dot.style.boxShadow = "0 0 0 4px rgba(62,224,127,.12)";
  } else if (ok === false){
    dot.style.background = "var(--bad)";
    dot.style.boxShadow = "0 0 0 4px rgba(255,90,106,.12)";
  } else {
    dot.style.background = "var(--warn)";
    dot.style.boxShadow = "0 0 0 4px rgba(255,209,102,.12)";
  }
  label.textContent = text;
}

function setStatus(text){
  const s = $("status");
  if (s) s.textContent = text;
}

function getVolAmbient(){ return Number($("volAmbient")?.value ?? 0.85); }
function getVolEffects(){ return Number($("volEffects")?.value ?? 0.90); }

function cleanName(filename){
  return filename
    .replace(/\.mp3$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function themeEmoji(name){
  const key = String(name).toLowerCase();

  if (key.includes("chuva")) return "🌧️";
  if (key.includes("dungeon")) return "🏰";
  if (key.includes("floresta")) return "🌲";
  if (key.includes("mar")) return "🌊";
  if (key.includes("tens")) return "🩸";

  if (key.includes("goblin")) return "👺";
  if (key.includes("warg") || key.includes("lobo")) return "🐺";
  if (key.includes("morto") || key.includes("undead")) return "💀";
  if (key.includes("cult")) return "🕯️";
  if (key.includes("aranha") || key.includes("spider")) return "🕷️";
  if (key.includes("dragao") || key.includes("dragon")) return "🐉";

  if (key.includes("batalha")) return "⚔️";
  if (key.includes("emboscada")) return "🎯";
  if (key.includes("ritual")) return "🔮";

  return "🎵";
}

// cor “surpresa” (determinística por texto)
function hashHue(str){
  let h = 0;
  for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

function unlockAudioOnce(){
  if (audioUnlocked) return;
  audioUnlocked = true;

  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC){
      audioCtx = new AC();
      // cria um som mudo curtinho pra “destravar”
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      g.gain.value = 0.00001;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.02);
      audioCtx.resume?.();
    }
  }catch(_){}

  setPill(true, "Áudio liberado ✅");
}

function stopAmbient(){
  if (ambientAudio){
    ambientAudio.pause();
    ambientAudio.currentTime = 0;
    ambientAudio = null;
  }
  if (ambientNowBtn){
    ambientNowBtn.classList.remove("now");
    ambientNowBtn = null;
  }
}

function stopEffects(){
  for (const a of effectAudios){
    try{ a.pause(); a.currentTime = 0; }catch(_){}
  }
  effectAudios = [];
}

function playAmbient(url, btn){
  unlockAudioOnce();
  stopAmbient();

  ambientAudio = new Audio(url);
  ambientAudio.loop = true;
  ambientAudio.volume = getVolAmbient();

  ambientNowBtn = btn;
  ambientNowBtn?.classList.add("now");

  ambientAudio.play().then(()=>{
    setPill(true, "Tocando ambiente (loop) ✅");
  }).catch(()=>{
    setPill(false, "Bloqueado pelo navegador. Clique de novo ou use Safari/Chrome.");
  });
}

function playEffect(url){
  unlockAudioOnce();

  // limita sobreposição
  if (effectAudios.length >= MAX_EFFECTS){
    const old = effectAudios.shift();
    try{ old.pause(); old.currentTime = 0; }catch(_){}
  }

  const a = new Audio(url);
  a.loop = false;
  a.volume = getVolEffects();
  effectAudios.push(a);

  a.play().then(()=>{
    setPill(true, "Efeito tocando ✅");
  }).catch(()=>{
    setPill(false, "Bloqueado pelo navegador. Clique de novo ou use Safari/Chrome.");
  });

  a.addEventListener("ended", ()=>{
    effectAudios = effectAudios.filter(x => x !== a);
  });
}

// ---------- GitHub API ----------
async function listGithubDir(path){
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`;
  const r = await fetch(api, { cache: "no-store" });
  if (!r.ok) throw new Error(`GitHub API erro ${r.status} em ${path}`);
  return r.json();
}

async function scanMp3Recursive(path){
  const items = await listGithubDir(path);
  let files = [];

  for (const it of items){
    if (it.type === "dir"){
      const deeper = await scanMp3Recursive(it.path);
      files = files.concat(deeper);
    } else if (it.type === "file" && it.name.toLowerCase().endsWith(".mp3")){
      files.push({
        name: it.name,
        path: it.path,
        url: it.download_url
      });
    }
  }
  return files;
}

function groupByTheme(files){
  const groups = {};
  for (const f of files){
    const rel = f.path.startsWith(AUDIO_ROOT + "/")
      ? f.path.slice((AUDIO_ROOT + "/").length)
      : f.path;

    const folder = rel.includes("/") ? rel.split("/")[0] : "Outros";
    (groups[folder] ||= []).push(f);
  }
  // ordenar
  for (const k of Object.keys(groups)){
    groups[k].sort((a,b)=>a.name.localeCompare(b.name));
  }
  return groups;
}

function saveCache(data){
  try{
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      at: Date.now(),
      data
    }));
  }catch(_){}
}

function loadCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.at || !obj?.data) return null;
    if (Date.now() - obj.at > CACHE_TTL_MS) return null;
    return obj.data;
  }catch(_){
    return null;
  }
}

// ---------- UI ----------
let THEMES = {};   // { folder: [files...] }
let THEME_KEYS = []; // sorted
let currentTheme = null;

function renderThemeGrid(filterText=""){
  const grid = $("themeGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const q = filterText.trim().toLowerCase();

  const keys = THEME_KEYS.filter(folder => {
    if (!q) return true;
    if (folder.toLowerCase().includes(q)) return true;
    // também procura dentro das faixas
    return THEMES[folder].some(f => f.name.toLowerCase().includes(q));
  });

  if (!keys.length){
    setStatus("Nada encontrado. Tente outro termo.");
    return;
  }

  setStatus(`Temas: ${keys.length} • Áudios: ${THEME_KEYS.reduce((n,k)=>n+THEMES[k].length,0)}`);

  for (const folder of keys){
    const hue = hashHue(folder);
    const emoji = themeEmoji(folder);

    const card = document.createElement("div");
    card.className = "theme-card";

    const icon = document.createElement("div");
    icon.className = "theme-emoji";
    icon.textContent = emoji;
    icon.style.borderColor = `hsla(${hue}, 90%, 70%, .25)`;
    icon.style.boxShadow = `0 0 0 4px hsla(${hue}, 90%, 70%, .08)`;

    const info = document.createElement("div");
    info.className = "theme-info";
    info.innerHTML = `
      <div class="name">${folder}</div>
      <div class="meta">${THEMES[folder].length} áudio(s) • clique para abrir</div>
    `;

    card.appendChild(icon);
    card.appendChild(info);

    card.onclick = () => openTheme(folder);

    grid.appendChild(card);
  }
}

function ensureModal(){
  // Se o HTML não tiver o modal (algumas versões antigas), cria dinamicamente.
  let modal = document.getElementById("modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.id = "modal";
  modal.setAttribute("role","dialog");
  modal.setAttribute("aria-modal","true");

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <button class="btn ghost" id="modalBack">← Voltar</button>

        <div class="modal-title-wrap">
          <div class="modal-title">
            <span class="modal-emoji" id="modalEmoji">🎧</span>
            <span id="modalTitle">Tema</span>
          </div>
          <div class="modal-sub" id="modalSub">0 áudios</div>
        </div>

        <div class="modal-actions">
          <input id="themeSearch" type="search" placeholder="Buscar dentro do tema…" />
        </div>
      </div>

      <div class="modal-body" id="trackList"></div>
    </div>
  `;
  document.body.appendChild(modal);

  // wire básico
  const back = document.getElementById("modalBack");
  if (back) back.addEventListener("click", closeTheme);

  // fechar clicando fora
  modal.addEventListener("click", (e)=>{
    if (e.target === modal) closeTheme();
  });

  // ESC fecha
  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") closeTheme();
  });

  // buscar dentro do tema (sem focar automaticamente, pra não abrir teclado no iPad)
  const search = document.getElementById("themeSearch");
  if (search){
    search.addEventListener("input", ()=>{
      if (!currentTheme) return;
      renderTrackList(currentTheme, search.value || "");
    });
  }

  return modal;
}

function openTheme(folder){
  ensureModal();
  currentTheme = folder;
  const modal = $("modal");
  const title = $("modalTitle");
  const sub = $("modalSub");
  const emojiEl = $("modalEmoji");
  const themeSearch = $("themeSearch");

  if (!modal || !title || !sub || !emojiEl) return;

  title.textContent = folder;
  emojiEl.textContent = themeEmoji(folder);
  sub.textContent = `${THEMES[folder].length} áudio(s)`;

  modal.classList.remove("hidden");
  if (themeSearch){
    themeSearch.value = "";
    // (não focar automaticamente no iPad)
}

  renderTrackList(folder, "");
}

function closeTheme(){
  const modal = $("modal");
  if (modal) modal.classList.add("hidden");
  currentTheme = null;
}

function renderTrackList(folder, filterText){
  const list = $("trackList");
  if (!list) return;
  list.innerHTML = "";

  const q = filterText.trim().toLowerCase();
  const items = THEMES[folder].filter(f => {
    if (!q) return true;
    return f.name.toLowerCase().includes(q) || cleanName(f.name).toLowerCase().includes(q);
  });

  if (!items.length){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "Nenhum áudio encontrado nesse tema.";
    list.appendChild(empty);
    return;
  }

  for (const f of items){
    const row = document.createElement("div");
    row.className = "track";

    const left = document.createElement("div");
    left.innerHTML = `
      <div class="tname">${cleanName(f.name)}</div>
      <div class="tfile">${f.name}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "track-actions";

    const amb = document.createElement("button");
    amb.className = "pill amb";
    amb.textContent = "🌫️ Ambiente";
    amb.onclick = () => playAmbient(f.url, amb);

    const efx = document.createElement("button");
    efx.className = "pill efx";
    efx.textContent = "✨ Efeito";
    efx.onclick = () => playEffect(f.url);

    actions.appendChild(amb);
    actions.appendChild(efx);

    row.appendChild(left);
    row.appendChild(actions);

    list.appendChild(row);
  }
}

function showGlobalResults(matches){
  const box = $("globalResults");
  const list = $("globalResultsList");
  if (!box || !list) return;

  list.innerHTML = "";
  if (!matches.length){
    list.innerHTML = `<div class="hint">Nenhum resultado.</div>`;
  } else {
    for (const m of matches){
      const row = document.createElement("div");
      row.className = "track";

      const left = document.createElement("div");
      left.innerHTML = `
        <div class="tname">${cleanName(m.file.name)}</div>
        <div class="tfile">${m.theme} • ${m.file.name}</div>
      `;

      const actions = document.createElement("div");
      actions.className = "track-actions";

      const open = document.createElement("button");
      open.className = "pill";
      open.textContent = "📁 Abrir Tema";
      open.onclick = () => openTheme(m.theme);

      const amb = document.createElement("button");
      amb.className = "pill amb";
      amb.textContent = "🌫️ Ambiente";
      amb.onclick = () => playAmbient(m.file.url, amb);

      const efx = document.createElement("button");
      efx.className = "pill efx";
      efx.textContent = "✨ Efeito";
      efx.onclick = () => playEffect(m.file.url);

      actions.appendChild(open);
      actions.appendChild(amb);
      actions.appendChild(efx);

      row.appendChild(left);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  box.classList.remove("hidden");
}

function hideGlobalResults(){
  $("globalResults")?.classList.add("hidden");
}

function findGlobalMatches(query){
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches = [];
  for (const theme of THEME_KEYS){
    for (const f of THEMES[theme]){
      const name = cleanName(f.name).toLowerCase();
      const raw = f.name.toLowerCase();
      if (theme.toLowerCase().includes(q) || name.includes(q) || raw.includes(q)){
        matches.push({ theme, file: f });
        if (matches.length >= 30) return matches; // limite
      }
    }
  }
  return matches;
}

// ---------- Init ----------
async function init(){
  setPill(null, "Clique em um áudio para liberar som");

  // controles
  $("stopAmbient")?.addEventListener("click", stopAmbient);
  $("stopEffects")?.addEventListener("click", stopEffects);

  $("volAmbient")?.addEventListener("input", ()=>{
    if (ambientAudio) ambientAudio.volume = getVolAmbient();
  });

  $("volEffects")?.addEventListener("input", ()=>{
    // efeitos novos já pegam o volume; não mexemos nos já tocando
  });

  // desbloqueio por clique em qualquer lugar
  window.addEventListener("pointerdown", unlockAudioOnce, { once:true });

  // modal
  $("modalBack")?.addEventListener("click", closeTheme);
  $("modal")?.addEventListener("click", (e)=>{
    if (e.target === $("modal")) closeTheme();
  });
  window.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") closeTheme();
  });

  $("themeSearch")?.addEventListener("input", (e)=>{
    if (!currentTheme) return;
    renderTrackList(currentTheme, e.target.value);
  });

  // busca global
  $("globalSearch")?.addEventListener("input", (e)=>{
    const q = e.target.value;
    renderThemeGrid(q);

    const matches = findGlobalMatches(q);
    if (q.trim().length >= 2){
      showGlobalResults(matches);
    } else {
      hideGlobalResults();
    }
  });

  $("closeResults")?.addEventListener("click", ()=>{
    hideGlobalResults();
    $("globalSearch").value = "";
    renderThemeGrid("");
  });

  // tenta cache primeiro
  const cached = loadCache();
  if (cached){
    THEMES = cached.THEMES;
    THEME_KEYS = cached.THEME_KEYS;
    setStatus("Carregado do cache ✅ (atualizando em segundo plano…)");

    renderThemeGrid("");

    // atualiza em segundo plano
    refreshFromGithub().catch(()=>{});
    return;
  }

  // senão, carrega normal
  await refreshFromGithub();
}

async function refreshFromGithub(){
  setStatus("Carregando temas do GitHub…");

  const files = await scanMp3Recursive(AUDIO_ROOT);
  THEMES = groupByTheme(files);
  THEME_KEYS = Object.keys(THEMES).sort((a,b)=>a.localeCompare(b));

  saveCache({ THEMES, THEME_KEYS });

  if (!THEME_KEYS.length){
    setStatus("Não achei MP3 em /audio. Suba em audio/AlgumaPasta/arquivo.mp3");
    renderThemeGrid("");
    return;
  }

  setStatus(`Pronto ✅ Temas: ${THEME_KEYS.length} • Áudios: ${files.length}`);
  renderThemeGrid("");
}

window.addEventListener("DOMContentLoaded", ()=>{
  init().catch(err=>{
    console.error(err);
    setPill(false, "Erro ao carregar. Veja console (F12) ou tente de novo.");
    setStatus("Erro ao listar áudios automaticamente. Verifique se /audio existe e se BRANCH está correto.");
  });
});


/* noselect patch */
(function(){
  const styleId = "sb-noselect-style";
  if (document.getElementById(styleId)) return;
  const st = document.createElement("style");
  st.id = styleId;
  st.textContent = `
    .theme-card, .theme-card * { user-select: none; -webkit-user-select: none; }
    .theme-card { cursor: pointer; }
  `;
  document.head.appendChild(st);
})();
