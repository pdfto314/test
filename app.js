/* =====================================================
   Jogatina Soundboard — versão SEM GitHub API (anti rate-limit)
   Carrega tudo do arquivo local playlist.json (GitHub Pages).
   Repo/site: https://pdfto314.github.io/test/
   ===================================================== */

const PLAYLIST_URL = "playlist.json";
const CACHE_TTL_MS = 10 * 60 * 1000;

let CACHE = { ts: 0, themes: null };
let THEMES = {};              // { themeName: [ {title,url,type,tags,loop,volume} ] }
let currentTheme = null;

// Elementos
const themeGrid   = document.getElementById("themeGrid");
const modal       = document.getElementById("modal");
const themeTitle  = document.getElementById("themeTitle");
const trackList   = document.getElementById("trackList");
const themeSearch = document.getElementById("themeSearch");
const closeBtn    = document.getElementById("closeBtn");

// -----------------------------------------------------
// iOS / áudio unlock
// -----------------------------------------------------
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let AUDIO_UNLOCKED = false;
function unlockAudio(){
  if (AUDIO_UNLOCKED) return;

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

  try{
    const a = new Audio();
    a.muted = true;
    a.play?.().catch(()=>{});
  }catch(_){}

  AUDIO_UNLOCKED = true;
}

function removeFocus(){
  document.activeElement?.blur?.();
}

// -----------------------------------------------------
// UI status pill (se existir no HTML)
// -----------------------------------------------------
function setPill(ok, text){
  const dot = document.getElementById("audioDot");
  const label = document.getElementById("audioText");
  if (!dot || !label) return;

  if (ok === true) dot.className = "dot ok";
  else if (ok === false) dot.className = "dot bad";
  else dot.className = "dot";

  label.textContent = text || "";
}

// -----------------------------------------------------
// Audio layers (multi-ambiente)
// -----------------------------------------------------
let ambientLayers = []; // [{url, audio, btn, title}]

function getVolAmbient(){
  const el = document.getElementById("volAmbient");
  const v = el ? Number(el.value) : 0.6;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
}
function getVolEffects(){
  const el = document.getElementById("volEffects");
  const v = el ? Number(el.value) : 0.85;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.85;
}

function findAmbientLayer(url){
  return ambientLayers.find(l => l.url === url) || null;
}
function stopAmbientLayer(layer){
  try{ layer.audio.pause(); layer.audio.currentTime = 0; }catch(_){}
  layer.btn?.classList.remove("now");
  ambientLayers = ambientLayers.filter(l => l !== layer);
}
function syncAmbientVolumes(){
  const v = getVolAmbient();
  ambientLayers.forEach(l => { try{ l.audio.volume = v; }catch(_){ } });
}

function stopAmbient(){
  ambientLayers.forEach(l => {
    try{ l.audio.pause(); l.audio.currentTime = 0; }catch(_){}
    l.btn?.classList.remove("now");
  });
  ambientLayers = [];
  setPill(null, "Ambientes parados.");
}

function stopEffects(){
  // efeitos são one-shot; aqui só limpa status
  setPill(null, "Efeitos ok.");
}

function playAmbient(url, btn, title=""){
  unlockAudio();

  const absUrl = new URL(url, window.location.href).href;

  const existing = findAmbientLayer(absUrl);
  if (existing){
    stopAmbientLayer(existing);
    setPill(true, ambientLayers.length ? `Ambientes tocando: ${ambientLayers.length} ✅` : "Ambiente parado ✅");
    return;
  }

  const a = new Audio(absUrl);
  a.loop = true;
  a.volume = getVolAmbient();

  const layer = { url: absUrl, audio: a, btn, title };
  ambientLayers.push(layer);

  btn?.classList.add("now");

  a.play().then(()=>{
    setPill(true, `Ambientes tocando: ${ambientLayers.length} ✅`);
  }).catch(()=>{
    stopAmbientLayer(layer);
    setPill(false, "Bloqueado pelo navegador. Toque novamente.");
  });
}

function playEffect(url){
  unlockAudio();

  const absUrl = new URL(url, window.location.href).href;

  const a = new Audio(absUrl);
  a.volume = getVolEffects();
  a.play().catch(()=>{
    setPill(false, "Bloqueado pelo navegador. Toque novamente.");
  });
}

// -----------------------------------------------------
// Sets (cenas) — localStorage
// -----------------------------------------------------
const SCENE_KEY = "jogatina_scenes_v2";
let SCENES = {}; // {name:{ambients:[{url,title}], volAmbient, volEffects}}

function loadScenes(){
  try{
    SCENES = JSON.parse(localStorage.getItem(SCENE_KEY) || "{}") || {};
  }catch(_){
    SCENES = {};
  }
  renderSceneSelect();
}
function saveScenes(){
  try{ localStorage.setItem(SCENE_KEY, JSON.stringify(SCENES)); }catch(_){}
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
  return {
    ambients: ambientLayers.map(l => ({ url: l.url, title: l.title || "" })),
    volAmbient: getVolAmbient(),
    volEffects: getVolEffects()
  };
}

function applySceneByName(name){
  const sc = SCENES[name];
  if (!sc) return;

  const vA = document.getElementById("volAmbient");
  const vE = document.getElementById("volEffects");
  if (vA && typeof sc.volAmbient === "number") vA.value = String(sc.volAmbient);
  if (vE && typeof sc.volEffects === "number") vE.value = String(sc.volEffects);

  stopAmbient();

  (sc.ambients || []).forEach(item=>{
    const a = new Audio(item.url);
    a.loop = true;
    a.volume = getVolAmbient();
    const layer = { url: item.url, audio: a, btn: null, title: item.title || "" };
    ambientLayers.push(layer);
    a.play().catch(()=>{ stopAmbientLayer(layer); });
  });

  setPill(true, `Set aplicado: ${name} ✅`);
}

// Modal salvar set (sem prompt)
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

  if (!isIOS()){
    input.focus();
    input.select?.();
  }

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

// -----------------------------------------------------
// Playlist loader (sem GitHub API)
// -----------------------------------------------------
async function loadThemes(){
  const now = Date.now();
  if (CACHE.themes && (now - CACHE.ts < CACHE_TTL_MS)){
    THEMES = CACHE.themes;
    renderThemes();
    return;
  }

  try{
    const r = await fetch(`${PLAYLIST_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`Falha ao carregar ${PLAYLIST_URL} (HTTP ${r.status})`);
    const data = await r.json();

    const out = {};
    for (const cat of (data.categories || [])){
      const name = cat.name || "Sem nome";
      out[name] = (cat.items || []).map(it => ({
        title: it.title || it.name || "Sem título",
        url: it.url,
        type: it.type || "ambience", // "ambience" ou "effect"
        tags: it.tags || [],
        loop: !!it.loop,
        volume: (typeof it.volume === "number") ? it.volume : null
      }));
    }

    THEMES = out;
    CACHE = { ts: now, themes: out };
    renderThemes();
  }catch(err){
    console.error(err);
    alert("Erro ao listar áudios pelo playlist.json.\n\nDetalhe: " + err.message);
  }
}

function renderThemes(){
  themeGrid.innerHTML = "";
  const names = Object.keys(THEMES).sort((a,b)=>a.localeCompare(b,"pt-BR"));

  if (!names.length){
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "Nenhuma categoria no playlist.json.";
    themeGrid.appendChild(div);
    return;
  }

  names.forEach(folder=>{
    const card = document.createElement("div");
    card.className = "theme-card";
    card.textContent = folder;
    card.addEventListener("click", ()=>openTheme(folder));
    themeGrid.appendChild(card);
  });
}

function openTheme(themeName){
  currentTheme = themeName;
  themeTitle.textContent = themeName;
  modal.classList.remove("hidden");

  themeSearch.value = "";
  if (!isIOS()) themeSearch.focus();
  else themeSearch.blur();

  renderTrackList();
}

function closeModal(){
  modal.classList.add("hidden");
  removeFocus();
}

function renderTrackList(filter=""){
  trackList.innerHTML = "";
  const q = (filter || "").toLowerCase().trim();
  const items = (THEMES[currentTheme] || []).filter(it =>
    it.title.toLowerCase().includes(q) ||
    (it.tags || []).some(t => String(t).toLowerCase().includes(q))
  );

  if (!items.length){
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "Nenhum áudio encontrado.";
    trackList.appendChild(div);
    return;
  }

  items.forEach(it=>{
    const row = document.createElement("div");
    row.className = "track";

    const title = document.createElement("div");
    title.className = "track-title";
    title.textContent = it.title;

    const amb = document.createElement("button");
    amb.className = "btn";
    amb.type = "button";
    amb.textContent = "🌫️ Ambiente";

    const efx = document.createElement("button");
    efx.className = "btn";
    efx.type = "button";
    efx.textContent = "⚡ Efeito";

    // Se item for effect, deixa Ambiente desabilitado (e vice-versa)
    if (it.type === "effect"){
      amb.disabled = true;
      amb.style.opacity = 0.45;
    }
    if (it.type === "ambience"){
      // efeito ainda pode tocar como one-shot se você quiser, então não desabilito
    }

    amb.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      removeFocus();
      if (!it.url) return;
      playAmbient(it.url, amb, it.title);
    });

    efx.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      removeFocus();
      if (!it.url) return;
      playEffect(it.url);
    });

    row.appendChild(title);
    row.appendChild(amb);
    row.appendChild(efx);
    trackList.appendChild(row);
  });
}

// -----------------------------------------------------
// Init
// -----------------------------------------------------
document.addEventListener("DOMContentLoaded", ()=>{
  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.addEventListener("touchstart", unlockAudio, { passive: true });

  loadThemes();
  loadScenes();

  themeSearch?.addEventListener("input", (e)=>renderTrackList(e.target.value));
  closeBtn?.addEventListener("click", closeModal);

  modal?.addEventListener("click", (e)=>{ if (e.target === modal) closeModal(); });

  // Volumes
  document.getElementById("volAmbient")?.addEventListener("input", syncAmbientVolumes);

  document.getElementById("stopAmbient")?.addEventListener("click", stopAmbient);
  document.getElementById("stopEffects")?.addEventListener("click", stopEffects);

  // Sets (cenas)
  document.getElementById("saveScene")?.addEventListener("click", openSceneNameModal);
  document.getElementById("applyScene")?.addEventListener("click", ()=>{
    const name = document.getElementById("sceneSelect")?.value;
    if (name) applySceneByName(name);
  });
  document.getElementById("deleteScene")?.addEventListener("click", deleteSelectedScene);

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

  // iOS: tocar fora fecha teclado
  document.addEventListener("touchstart", (e)=>{
    if (!e.target.matches("input, textarea")) removeFocus();
  }, { passive: true });
});
