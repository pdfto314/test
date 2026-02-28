// =====================================================
// Jogatina Soundboard — Auto temas por pasta (GitHub API)
// Repo: https://zimbpdf0.github.io/Pdf001/
// OWNER/REPO já configurados
// =====================================================

const OWNER = "pdfto314";
const REPO  = "test";
const BRANCH = "main";
const AUDIO_ROOT = "audio";

// Cache (pra não bater na API toda hora)
const CACHE_KEY = "jsb_cache_v1";
const BRANCH_CANDIDATES = ["main", "master"];
const AUDIO_ROOT_CANDIDATES = ["audio", "Audio"];

let ACTIVE_BRANCH = null;
let ACTIVE_AUDIO_ROOT = null;

function safePath(path){
  return String(path).split("/").map(encodeURIComponent).join("/");
}

async function listGithubDir(path, branch){
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${safePath(path)}?ref=${branch}`;
  const r = await fetch(api, { cache: "no-store" });

  if (!r.ok){
    let msg = "";
    try{
      const j = await r.json();
      if (j?.message) msg = ` — ${j.message}`;
    }catch(_){}
    throw new Error(`GitHub API ${r.status} (${branch}) em "${path}"${msg}`);
  }
  return r.json();
}

async function detectRepoLayout(){
  for (const br of BRANCH_CANDIDATES){
    for (const root of AUDIO_ROOT_CANDIDATES){
      try{
        const rootList = await listGithubDir(root, br);
        if (Array.isArray(rootList)){
          ACTIVE_BRANCH = br;
          ACTIVE_AUDIO_ROOT = root;
          return;
        }
      }catch(_){}
    }
  }
  throw new Error("Não encontrei /audio (ou /Audio) em main/master.");
}

async function loadThemes(){
  const now = Date.now();
  if (CACHE.themes && (now - CACHE.ts < CACHE_TTL_MS)){
    THEMES = CACHE.themes;
    renderThemes();
    return;
  }

  try{
    if (!ACTIVE_BRANCH || !ACTIVE_AUDIO_ROOT){
      await detectRepoLayout();
    }

    const root = await listGithubDir(ACTIVE_AUDIO_ROOT, ACTIVE_BRANCH);
    const folders = root.filter(x => x.type === "dir");

    const out = {};
    for (const folder of folders){
      const files = await listGithubDir(`${ACTIVE_AUDIO_ROOT}/${folder.name}`, ACTIVE_BRANCH);

      out[folder.name] = files
        .filter(f => f.type === "file" && /\.mp3$/i.test(f.name))
        .map(f => ({ name: f.name.replace(/\.mp3$/i, ""), url: f.download_url }))
        .sort((a,b)=>a.name.localeCompare(b.name, "pt-BR"));
    }

    THEMES = out;
    CACHE = { ts: now, themes: out };
    renderThemes();

  }catch(err){
    console.error(err);
    alert(
      "Erro ao listar áudios automaticamente.\n\n" +
      "Tentado main/master + audio/Audio.\n\n" +
      "Detalhe: " + err.message
    );
  }
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

// 2 canais: ambiente (loop) + efeitos (one-shot e pode sobrepor)
let ambientAudio = null; // legado (mantido por compatibilidade)
let ambientLayers = []; // [{url, audio, btn, title}]
let ambientNowBtn = null;

let effectAudios = [];
const MAX_EFFECTS = 6;

// iOS/Safari/Edge costumam exigir “unlock” por gesto do usuário
let audioUnlocked = false;
let audioCtx = null;

function $(id){ return document.getElementById(id); }

// Encode correto para GitHub contents API (não pode encodeURIComponent no path inteiro, senão quebra as "/")
function encodePath(path){
  return String(path).split("/").map(encodeURIComponent).join("/");
}

// Detecta iOS/iPadOS (pra evitar abrir teclado automaticamente)
function isIOS(){
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS13Plus = (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS || iPadOS13Plus;
}

// Se true, foca automaticamente o campo "Buscar dentro do tema" ao abrir um tema (desligado pra iPad)
const AUTO_FOCUS_THEME_SEARCH = false;


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

function findAmbientLayer(url){
  return ambientLayers.find(l => l.url === url) || null;
}

function stopAmbientLayer(layer){
  try{ layer.audio.pause(); layer.audio.currentTime = 0; }catch(_){}
  if (layer.btn) layer.btn.classList.remove("now");
  ambientLayers = ambientLayers.filter(l => l !== layer);
}

function syncAmbientVolumes(){
  const v = getVolAmbient();
  ambientLayers.forEach(l => { try{ l.audio.volume = v; }catch(_){ } });
}

function themeEmoji(folder){
  const n = folder.toLowerCase();

  // chuva / tempestade
  if (n.includes("chuva") || n.includes("rain")) return "🌧️";
  if (n.includes("trov") || n.includes("thunder") || n.includes("tempest")) return "⛈️";

  // lugares
  if (n.includes("vila") || n.includes("cidade") || n.includes("town")) return "🏘️";
  if (n.includes("taverna") || n.includes("tavern") || n.includes("inn")) return "🍺";
  if (n.includes("floresta") || n.includes("forest") || n.includes("woods")) return "🌲";
  if (n.includes("caverna") || n.includes("cave") || n.includes("dungeon")) return "🕳️";
  if (n.includes("castelo") || n.includes("castle") || n.includes("fort")) return "🏰";
  if (n.includes("templo") || n.includes("temple") || n.includes("ruin")) return "🏛️";
  if (n.includes("montanha") || n.includes("mount")) return "⛰️";
  if (n.includes("mar") || n.includes("oceano") || n.includes("sea")) return "🌊";
  if (n.includes("deserto") || n.includes("desert")) return "🏜️";

  // clima / vibes
  if (n.includes("noite") || n.includes("night")) return "🌙";
  if (n.includes("neve") || n.includes("snow") || n.includes("gelo")) return "❄️";
  if (n.includes("vento") || n.includes("wind")) return "🌬️";
  if (n.includes("fogo") || n.includes("fire")) return "🔥";
  if (n.includes("tens") || n.includes("susp") || n.includes("horror")) return "🕯️";
  if (n.includes("batalha") || n.includes("battle") || n.includes("boss")) return "⚔️";
  if (n.includes("magia") || n.includes("arcano") || n.includes("magic")) return "✨";

  return "🎧";
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
  // Para TODOS os ambientes (layers)
  ambientLayers.forEach(l => {
    try{ l.audio.pause(); l.audio.currentTime = 0; }catch(_){}
    l.btn?.classList.remove("now");
  });
  ambientLayers = [];
  ambientAudio = null;
  ambientNowBtn = null;
  setPill(null, "Ambientes parados.");
}

function stopEffects(){
  for (const a of effectAudios){
    try{ a.pause(); a.currentTime = 0; }catch(_){}
  }
  effectAudios = [];
}



// -----------------------------------------------------
// Audio unlock (iOS/Chrome autoplay policy)
// -----------------------------------------------------
let AUDIO_UNLOCKED = false;

function unlockAudio(){
  if (AUDIO_UNLOCKED) return;

  // 1) AudioContext "wake up" (helps iOS)
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC){
      const ctx = new AC();
      ctx.resume?.();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.00001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
    }
  }catch(_){}

  // 2) muted HTMLAudioElement play attempt
  try{
    const a = new Audio();
    a.muted = true;
    a.play?.().catch(()=>{});
  }catch(_){}

  AUDIO_UNLOCKED = true;
}

function playAmbient(url, btn){
  
  unlockAudio();
unlockAudioOnce();

  // Toggle: se já está tocando esse mesmo url, para só ele
  const existing = findAmbientLayer(url);
  if (existing){
    stopAmbientLayer(existing);
    setPill(true, ambientLayers.length ? `Ambientes tocando: ${ambientLayers.length} ✅` : "Ambiente parado ✅");
    return;
  }

  const a = new Audio(url);
  a.loop = true;
  a.volume = getVolAmbient();

  const layer = { url, audio: a, btn, title: "" };
  ambientLayers.push(layer);

  btn?.classList.add("now");

  a.play().then(()=>{
    setPill(true, `Ambientes tocando: ${ambientLayers.length} ✅`);
  }).catch(()=>{
    // se falhar, remove layer
    stopAmbientLayer(layer);
    setPill(false, "Bloqueado pelo navegador. Clique de novo ou use Safari/Chrome.");
  });
}

function playEffect(url){
  
  unlockAudio();
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



// Sets (cenas) — salvos no navegador (localStorage)
const SCENE_KEY = "jogatina_scenes_v1";
let SCENES = {}; // {name:{ambients:[{url,title}], volAmbient, volEffects}}
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

function openTheme(folder){
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
    if (AUTO_FOCUS_THEME_SEARCH && !isIOS()) themeSearch.focus();
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
    amb.onclick = (ev) => { ev?.preventDefault?.(); amb.blur?.(); playAmbient(f.url, amb); };

    const efx = document.createElement("button");
    efx.className = "pill efx";
    efx.textContent = "✨ Efeito";
    efx.onclick = (ev) => { ev?.preventDefault?.(); efx.blur?.(); playEffect(f.url); };

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
      amb.onclick = (ev) => { ev?.preventDefault?.(); amb.blur?.(); playAmbient(m.file.url, amb); };

      const efx = document.createElement("button");
      efx.className = "pill efx";
      efx.textContent = "✨ Efeito";
      efx.onclick = (ev) => { ev?.preventDefault?.(); efx.blur?.(); playEffect(m.file.url); };

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




function loadScenes(){
  try{
    SCENES = JSON.parse(localStorage.getItem(SCENE_KEY) || "{}") || {};
  }catch(_){
    SCENES = {};
  }
  renderSceneSelect();
}

function saveScenes(){
  try{
    localStorage.setItem(SCENE_KEY, JSON.stringify(SCENES));
  }catch(_){}
}

function renderSceneSelect(){
  const sel = document.getElementById("sceneSelect");
  if (!sel) return;

  const current = sel.value;
  sel.innerHTML = '<option value="">(Sem set salvo)</option>';

  Object.keys(SCENES).sort((a,b)=>a.localeCompare(b,"pt-BR")).forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  if (current && SCENES[current]) sel.value = current;
}

function snapshotCurrentScene(){
  // Captura apenas AMBIENTES tocando no momento + volumes globais
  return {
    ambients: ambientLayers.map(l => ({ url: l.url, title: l.title || "" })),
    volAmbient: getVolAmbient(),
    volEffects: getVolEffects()
  };
}


// -----------------------------------------------------
// UI: salvar set (modal ao invés de prompt)
// -----------------------------------------------------
function openSceneNameModal(){
  const snap = snapshotCurrentScene();
  if (!snap.ambients.length){
    alert("Nenhum ambiente tocando para salvar. Toque em alguns 'Ambiente' primeiro.");
    return;
  }

  const m = document.getElementById("sceneNameModal");
  const input = document.getElementById("sceneNameInput");
  const hint = document.getElementById("sceneNameHint");
  if (!m || !input) return;

  hint.textContent = `Ambientes no set: ${snap.ambients.length}`;
  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");

  // iPad: não forçar foco (evita teclado subir se você não quiser),
  // mas em desktop é útil focar.
  if (!isIOS()){
    input.focus();
    input.select?.();
  }

  // Guarda snapshot no modal pra confirmar depois
  m._snap = snap;
}

function closeSceneNameModal(){
  const m = document.getElementById("sceneNameModal");
  if (!m) return;
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
  m._snap = null;
  document.getElementById("sceneNameInput")?.blur?.();
}

function confirmSaveSceneFromModal(){
  const m = document.getElementById("sceneNameModal");
  const input = document.getElementById("sceneNameInput");
  const hint = document.getElementById("sceneNameHint");
  if (!m || !input) return;

  const name = (input.value || "").trim();
  const snap = m._snap;

  if (!name){
    hint.textContent = "Digite um nome para salvar.";
    return;
  }
  if (!snap || !snap.ambients || !snap.ambients.length){
    hint.textContent = "Não achei ambientes tocando. Tente novamente.";
    return;
  }

  SCENES[name] = snap;
  saveScenes();
  renderSceneSelect();

  const sel = document.getElementById("sceneSelect");
  if (sel) sel.value = name;

  setPill(true, `Set salvo: ${name} ✅`);
  closeSceneNameModal();
}

function applySceneByName(name){
  const sc = SCENES[name];
  if (!sc) return;

  // volumes
  const vA = document.getElementById("volAmbient");
  const vE = document.getElementById("volEffects");
  if (vA && typeof sc.volAmbient === "number") vA.value = String(sc.volAmbient);
  if (vE && typeof sc.volEffects === "number") vE.value = String(sc.volEffects);

  // Para ambientes atuais e sobe os do set
  stopAmbient();

  // Reproduz todos os ambientes do set
  (sc.ambients || []).forEach(item=>{
    // btn pode ser null (se o tema não está aberto). Mesmo assim toca.
    const a = new Audio(item.url);
    a.loop = true;
    a.volume = getVolAmbient();
    const layer = { url: item.url, audio: a, btn: null, title: item.title || "" };
    ambientLayers.push(layer);
    a.play().catch(()=>{ stopAmbientLayer(layer); });
  });

  setPill(true, `Set aplicado: ${name} ✅`);
}


function deleteSelectedScene(){
  const sel = document.getElementById("sceneSelect");
  const name = sel?.value;
  if (!name) return;
  if (!confirm(`Excluir o set "${name}"?`)) return;
  delete SCENES[name];
  saveScenes();
  renderSceneSelect();
  setPill(true, "Set excluído ✅");
}



// Modal salvar set
document.getElementById("sceneNameConfirm")?.addEventListener("click", confirmSaveSceneFromModal);
document.getElementById("sceneNameCancel")?.addEventListener("click", closeSceneNameModal);
document.getElementById("sceneNameModal")?.addEventListener("click", (e)=>{
  if (e.target?.id === "sceneNameModal") closeSceneNameModal();
});
document.getElementById("sceneNameInput")?.addEventListener("keydown", (e)=>{
  if (e.key === "Enter") confirmSaveSceneFromModal();
  if (e.key === "Escape") closeSceneNameModal();
});
