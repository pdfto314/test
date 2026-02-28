// Jogatina Soundboard — FULL UI (sem GitHub API, usa playlist.json)

const PLAYLIST_URL = "playlist.json";
const CACHE_TTL_MS = 10 * 60 * 1000;

let CACHE = { ts: 0, themes: null };
let THEMES = {};              // { themeName: [items...] }
let currentTheme = null;

// DOM
const themeGrid   = document.getElementById("themeGrid");
const modal       = document.getElementById("modal");
const themeTitle  = document.getElementById("themeTitle");
const trackList   = document.getElementById("trackList");
const themeSearch = document.getElementById("themeSearch");
const themeFilter = document.getElementById("themeFilter");

// ---------------- iOS helpers ----------------
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function blurActive(){ document.activeElement?.blur?.(); }

// ---------------- Status pill ----------------
function setPill(ok, text){
  const dot = document.getElementById("audioDot");
  const label = document.getElementById("audioText");
  if (!dot || !label) return;

  if (ok === true) dot.className = "dot ok";
  else if (ok === false) dot.className = "dot bad";
  else dot.className = "dot";

  label.textContent = text || "";
}

// ---------------- Audio unlock ----------------
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

// ---------------- Volumes ----------------
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

// ---------------- Multi-ambient layers ----------------
let ambientLayers = []; // [{url, audio, btn, title}]

function findLayer(url){ return ambientLayers.find(l=>l.url===url) || null; }

function stopLayer(layer){
  try{ layer.audio.pause(); layer.audio.currentTime = 0; }catch(_){}
  layer.btn?.classList.remove("now");
  ambientLayers = ambientLayers.filter(l => l !== layer);
}

function syncAmbientVolumes(){
  const v = getVolAmbient();
  ambientLayers.forEach(l=>{ try{ l.audio.volume = v; }catch(_){ } });
}

function stopAmbient(){
  ambientLayers.forEach(l=>{
    try{ l.audio.pause(); l.audio.currentTime = 0; }catch(_){}
    l.btn?.classList.remove("now");
  });
  ambientLayers = [];
  setPill(null, "Ambientes parados.");
}

function stopEffects(){
  setPill(null, "Efeitos ok.");
}

function playAmbient(url, btn, title=""){
  unlockAudio();

  const absUrl = new URL(url, window.location.href).href;
  const existing = findLayer(absUrl);
  if (existing){
    stopLayer(existing);
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
    stopLayer(layer);
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

// ---------------- Scenes (Sets) ----------------
const SCENE_KEY = "jogatina_scenes_v3";
let SCENES = {};

function loadScenes(){
  try{ SCENES = JSON.parse(localStorage.getItem(SCENE_KEY) || "{}") || {}; }
  catch(_){ SCENES = {}; }
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
    a.play().catch(()=>{ stopLayer(layer); });
  });

  setPill(true, `Set aplicado: ${name} ✅`);
}

// Modal salvar set
function openSceneNameModal(){
  const snap = snapshotCurrentScene();
  if (!snap.ambients.length){
    alert("Nenhum ambiente tocando para salvar. Toque em alguns '🌫️ Ambiente' primeiro.");
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
  }else{
    input.blur();
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
  if (!snap?.ambients?.length){
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

// ---------------- Playlist loader (no GitHub API) ----------------
function normalizeThemeData(data){
  const out = {};
  for (const cat of (data.categories || [])){
    const name = cat.name || "Sem nome";
    out[name] = (cat.items || []).map(it => ({
      title: it.title || it.name || "Sem título",
      url: it.url,
      type: (it.type || "ambience").toLowerCase(), // ambience/effect
      tags: it.tags || [],
      loop: !!it.loop,
      volume: (typeof it.volume === "number") ? it.volume : null,
      emoji: it.emoji || null
    }));
  }
  return out;
}

async function loadThemes(){
  const now = Date.now();
  if (CACHE.themes && (now - CACHE.ts < CACHE_TTL_MS)){
    THEMES = CACHE.themes;
    renderThemes();
    return;
  }

  try{
    setPill(null, "Carregando playlist.json…");
    const r = await fetch(`${PLAYLIST_URL}?t=${Date.now()}`, { cache:"no-store" });
    if (!r.ok) throw new Error(`Falha ao carregar playlist.json (HTTP ${r.status})`);
    const data = await r.json();

    THEMES = normalizeThemeData(data);
    CACHE = { ts: now, themes: THEMES };
    renderThemes();
    setPill(true, "Playlist carregada ✅");
  }catch(err){
    console.error(err);
    setPill(false, "Erro ao carregar playlist.json.");
    alert("Erro ao carregar playlist.json.\n\nDetalhe: " + err.message);
  }
}

function themeEmoji(name){
  const key = String(name).toLowerCase();
  if (key.includes("chuva")) return "🌧️";
  if (key.includes("dungeon")) return "🏰";
  if (key.includes("floresta")) return "🌲";
  if (key.includes("mar")) return "🌊";
  if (key.includes("tens")) return "⚡";
  return "🎵";
}

function renderThemes(){
  const q = (themeFilter?.value || "").trim().toLowerCase();
  themeGrid.innerHTML = "";

  const names = Object.keys(THEMES)
    .filter(n => n.toLowerCase().includes(q))
    .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  if (!names.length){
    const div = document.createElement("div");
    div.className = "small";
    div.textContent = "Nenhum tema encontrado (filtro ou playlist vazia).";
    themeGrid.appendChild(div);
    return;
  }

  names.forEach(name=>{
    const items = THEMES[name] || [];
    const card = document.createElement("div");
    card.className = "theme-card";
    card.innerHTML = `
      <div class="theme-emoji">${themeEmoji(name)}</div>
      <div>
        <div class="theme-name">${name}</div>
        <div class="theme-count">${items.length} áudio(s)</div>
      </div>
    `;
    card.addEventListener("click", ()=>openTheme(name));
    themeGrid.appendChild(card);
  });
}

// ---------------- Theme modal ----------------
function openTheme(name){
  currentTheme = name;
  themeTitle.textContent = name;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");

  themeSearch.value = "";
  // iPad: não focar automaticamente (evita teclado)
  if (!isIOS()) themeSearch.focus();
  else themeSearch.blur();

  renderTrackList("");
}

function closeModal(){
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  blurActive();
}

function renderTrackList(filter){
  trackList.innerHTML = "";
  const q = (filter || "").toLowerCase().trim();

  const all = (THEMES[currentTheme] || []);
  const items = all.filter(it =>
    it.title.toLowerCase().includes(q) ||
    (it.tags || []).some(t => String(t).toLowerCase().includes(q))
  );

  if (!items.length){
    const div = document.createElement("div");
    div.className = "small";
    div.textContent = "Nenhum áudio encontrado.";
    trackList.appendChild(div);
    return;
  }

  items.forEach(it=>{
    const row = document.createElement("div");
    row.className = "track";

    const left = document.createElement("div");
    left.innerHTML = `<div class="track-title">${it.title}</div>
                      <div class="tagline">${it.type === "effect" ? "⚡ efeito (1x)" : "🌫️ ambiente (loop)"} • ${it.url}</div>`;

    const amb = document.createElement("button");
    amb.className = "btn";
    amb.textContent = "🌫️ Ambiente";
    if (it.type === "effect"){
      amb.disabled = true;
      amb.style.opacity = "0.45";
    }

    const efx = document.createElement("button");
    efx.className = "btn";
    efx.textContent = "⚡ Efeito";

    amb.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      blurActive();
      if (!it.url) return;
      playAmbient(it.url, amb, it.title);
    });

    efx.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      blurActive();
      if (!it.url) return;
      playEffect(it.url);
    });

    row.appendChild(left);
    row.appendChild(amb);
    row.appendChild(efx);
    trackList.appendChild(row);
  });
}

// ---------------- Generator buttons etc ----------------
document.addEventListener("DOMContentLoaded", ()=>{
  // unlock on first interaction
  document.addEventListener("pointerdown", unlockAudio, { passive:true });
  document.addEventListener("touchstart", unlockAudio, { passive:true });

  loadThemes();
  loadScenes();

  document.getElementById("reloadBtn")?.addEventListener("click", ()=>{
    CACHE.ts = 0;
    loadThemes();
  });

  themeFilter?.addEventListener("input", renderThemes);

  document.getElementById("closeBtn")?.addEventListener("click", closeModal);
  modal?.addEventListener("click", (e)=>{ if (e.target === modal) closeModal(); });

  themeSearch?.addEventListener("input", (e)=>renderTrackList(e.target.value));

  // volumes
  document.getElementById("volAmbient")?.addEventListener("input", syncAmbientVolumes);

  document.getElementById("stopAmbient")?.addEventListener("click", stopAmbient);
  document.getElementById("stopEffects")?.addEventListener("click", stopEffects);

  // scenes
  document.getElementById("saveScene")?.addEventListener("click", openSceneNameModal);
  document.getElementById("applyScene")?.addEventListener("click", ()=>{
    const name = document.getElementById("sceneSelect")?.value;
    if (name) applySceneByName(name);
  });
  document.getElementById("deleteScene")?.addEventListener("click", deleteSelectedScene);

  // scene modal
  document.getElementById("sceneNameConfirm")?.addEventListener("click", confirmSaveSceneFromModal);
  document.getElementById("sceneNameCancel")?.addEventListener("click", closeSceneNameModal);
  document.getElementById("sceneNameModal")?.addEventListener("click", (e)=>{
    if (e.target?.id === "sceneNameModal") closeSceneNameModal();
  });
  document.getElementById("sceneNameInput")?.addEventListener("keydown", (e)=>{
    if (e.key === "Enter") confirmSaveSceneFromModal();
    if (e.key === "Escape") closeSceneNameModal();
  });

  // iOS: tocar fora tira teclado
  document.addEventListener("touchstart", (e)=>{
    if (!e.target.matches("input, textarea")) blurActive();
  }, { passive:true });
});
