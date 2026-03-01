/* Jogatina Soundboard - UI bonita + funções pedidas:
   ✅ Auto-lista /audio via GitHub API (cada subpasta = Tema)
   ✅ iPad unlock
   ✅ Ambientes múltiplos (camadas) + Efeitos múltiplos
   ✅ Volume individual por áudio (persistido)
   ✅ Sets salvam: ambientes (múltiplos) + efeitos + volumes globais + volumes individuais
*/

const OWNER = "pdfto314";      // <<< ajuste
const REPO  = "test";          // <<< ajuste
const BRANCH = "main";         // <<< ajuste
const AUDIO_PATH = "audio";    // <<< ajuste

const EXT_OK = [".mp3", ".wav", ".ogg", ".m4a"];

const els = {
  status: document.getElementById("status"),
  themes: document.getElementById("themes"),
  themeFilter: document.getElementById("themeFilter"),
  reloadBtn: document.getElementById("reloadBtn"),
  tracksTitle: document.getElementById("tracksTitle"),
  tracks: document.getElementById("tracks"),

  unlockBtn: document.getElementById("unlockBtn"),
  unlockDot: document.getElementById("unlockDot"),
  ambientVol: document.getElementById("ambientVol"),
  fxVol: document.getElementById("fxVol"),
  stopAllAmbientBtn: document.getElementById("stopAllAmbientBtn"),
  clearFxBtn: document.getElementById("clearFxBtn"),
  resetTrackVolBtn: document.getElementById("resetTrackVolBtn"),
  nowAmbients: document.getElementById("nowAmbients"),
  fxCount: document.getElementById("fxCount"),

  setSelect: document.getElementById("setSelect"),
  applySetBtn: document.getElementById("applySetBtn"),
  saveSetBtn: document.getElementById("saveSetBtn"),
  deleteSetBtn: document.getElementById("deleteSetBtn"),
  setName: document.getElementById("setName"),
};

let unlocked = false;

const ambientPlayers = new Map(); // url -> Audio (loop)
const fxPlayers = new Map();      // url -> Audio (one-shot, may repeat if you click)

const LS_TRACKVOL = "jogatina_track_vol_v1"; // { url: 0..1 }
const LS_SETS = "jogatina_sets_v2";          // { sets:[{id,name,scene}] }
const LS_LAST = "jogatina_last_scene_v3";    // last scene

let trackVol = readJson(LS_TRACKVOL, {});
let lastTheme = null;

function ghUrl(path){
  const p = encodeURIComponent(path).replace(/%2F/g, "/");
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${p}?ref=${encodeURIComponent(BRANCH)}`;
}
function isAudioFile(name){
  const low = name.toLowerCase();
  return EXT_OK.some(ext => low.endsWith(ext));
}
function niceTitle(fileName){
  return fileName.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
function setStatus(msg){ els.status.textContent = msg; }

async function fetchJson(url){
  const res = await fetch(url, { headers: { "Accept": "application/vnd.github+json" } });
  if (!res.ok){
    const text = await res.text().catch(()=> "");
    throw new Error(`GitHub API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}
async function listDir(path){
  const data = await fetchJson(ghUrl(path));
  return Array.isArray(data) ? data : [];
}
function clamp01(v){
  if (Number.isNaN(v)) return 1;
  return Math.max(0, Math.min(1, v));
}
function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/* Volume individual */
function getTrackVol(url){
  const v = trackVol[url];
  return (typeof v === "number" && v >= 0 && v <= 1) ? v : 1.0;
}
function setTrackVol(url, v){
  trackVol[url] = clamp01(v);
  writeJson(LS_TRACKVOL, trackVol);
}

/* Volume efetivo = vol canal × vol individual */
function effectiveAmbientVol(url){
  return clamp01(clamp01(parseFloat(els.ambientVol.value)) * getTrackVol(url));
}
function effectiveFxVol(url){
  return clamp01(clamp01(parseFloat(els.fxVol.value)) * getTrackVol(url));
}

/* UI updates */
function updateAmbientPill(){
  if (ambientPlayers.size === 0){
    els.nowAmbients.textContent = "Ambientes: —";
    return;
  }
  const names = [...ambientPlayers.keys()].slice(0, 3).map(u => shortName(u));
  const more = ambientPlayers.size > 3 ? ` +${ambientPlayers.size - 3}` : "";
  els.nowAmbients.textContent = `Ambientes: ${names.join(", ")}${more}`;
}
function updateFxCount(){
  els.fxCount.textContent = `Efeitos: ${fxPlayers.size}`;
}
function shortName(url){
  try{
    const name = decodeURIComponent(url.split("/").pop() || url);
    return niceTitle(name).slice(0, 18);
  }catch{
    return "Áudio";
  }
}

/* Playback */
function toggleAmbient(track){
  ensureUnlocked();

  const url = track.url;

  if (ambientPlayers.has(url)){
    const a = ambientPlayers.get(url);
    try{ a.pause(); }catch(e){}
    ambientPlayers.delete(url);
    updateAmbientPill();
    saveLastScene();
    return;
  }

  const a = new Audio(url);
  a.loop = true;
  a.preload = "auto";
  a.volume = effectiveAmbientVol(url);
  a.play().catch(()=>{});
  ambientPlayers.set(url, a);

  updateAmbientPill();
  saveLastScene();
}

function stopAllAmbient(){
  for (const a of ambientPlayers.values()){
    try{ a.pause(); }catch(e){}
  }
  ambientPlayers.clear();
  updateAmbientPill();
  saveLastScene();
}

function playFx(track){
  ensureUnlocked();

  const url = track.url;

  // reusar se já existe (pra permitir parar/limpar contagem)
  const existing = fxPlayers.get(url);
  if (existing){
    existing.currentTime = 0;
    existing.volume = effectiveFxVol(url);
    existing.play().catch(()=>{});
    return;
  }

  const a = new Audio(url);
  a.preload = "auto";
  a.volume = effectiveFxVol(url);

  a.addEventListener("ended", () => {
    fxPlayers.delete(url);
    updateFxCount();
    saveLastScene();
  });

  fxPlayers.set(url, a);
  updateFxCount();
  a.play().catch(()=>{});
  saveLastScene();
}

function clearFx(){
  for (const a of fxPlayers.values()){
    try{ a.pause(); }catch(e){}
  }
  fxPlayers.clear();
  updateFxCount();
  saveLastScene();
}

/* iOS unlock */
function ensureUnlocked(){
  if (unlocked) return;
}
async function unlockAudio(){
  try{
    const a = new Audio();
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    a.volume = 0;
    await a.play();
    a.pause();
  }catch(e){}
  unlocked = true;
  els.unlockDot.classList.add("on");
}

/* Load library */
async function loadLibrary(){
  els.themes.innerHTML = "";
  els.tracks.innerHTML = "";
  els.tracksTitle.textContent = "Selecione um tema";
  setStatus("Carregando temas do GitHub…");

  const root = await listDir(AUDIO_PATH);
  const folders = root.filter(x => x.type === "dir").sort((a,b)=>a.name.localeCompare(b.name, "pt-BR"));

  if (folders.length === 0){
    setStatus(`Nenhuma pasta em /${AUDIO_PATH}. Crie: audio/Floresta/*.mp3`);
    return;
  }

  const themes = [];
  for (const f of folders){
    const children = await listDir(`${AUDIO_PATH}/${f.name}`);
    const audios = children.filter(x => x.type === "file" && isAudioFile(x.name));
    themes.push({
      name: f.name,
      count: audios.length,
      items: audios.map(a => ({ title: niceTitle(a.name), file: a.name, url: a.download_url }))
    });
  }

  window.__THEMES = themes;
  renderThemes(themes);
  setStatus(`Pronto: ${themes.length} tema(s).`);
}

/* Render themes & tracks */
function renderThemes(themes){
  const filter = (els.themeFilter.value || "").toLowerCase().trim();
  const filtered = !filter ? themes : themes.filter(t => t.name.toLowerCase().includes(filter));

  els.themes.innerHTML = "";
  for (const t of filtered){
    const btn = document.createElement("button");
    btn.className = "themeBtn";
    btn.type = "button";
    btn.innerHTML = `
      <span class="name">${escapeHtml(t.name)}</span>
      <span class="count">${t.count}</span>
    `;
    btn.addEventListener("click", () => openTheme(t));
    els.themes.appendChild(btn);
  }

  if (filtered.length === 0){
    const div = document.createElement("div");
    div.className = "status";
    div.textContent = "Nenhum tema com esse filtro.";
    els.themes.appendChild(div);
  }
}

function openTheme(theme){
  lastTheme = theme;
  els.tracksTitle.textContent = `Tema: ${theme.name}`;
  els.tracks.innerHTML = "";

  const items = theme.items || [];
  if (items.length === 0){
    const div = document.createElement("div");
    div.className = "status";
    div.textContent = "Sem arquivos de áudio nesta pasta.";
    els.tracks.appendChild(div);
    return;
  }

  for (const it of items){
    const row = document.createElement("div");
    row.className = "track";

    const initialVol = getTrackVol(it.url);
    const isAmbientOn = ambientPlayers.has(it.url);

    row.innerHTML = `
      <div class="left">
        <div class="title">${escapeHtml(it.title)}</div>
        <div class="meta">${escapeHtml(it.file)}</div>
      </div>

      <div class="right">
        <div class="volBox" title="Volume individual salvo no navegador">
          <label>Vol</label>
          <input class="trackVol" type="range" min="0" max="1" step="0.01" value="${initialVol}">
        </div>
        <button class="btn primary ambBtn" type="button">${isAmbientOn ? "Ambiente ✓" : "Ambiente+"}</button>
        <button class="btn fxBtn" type="button">Efeito</button>
      </div>
    `;

    const volSlider = row.querySelector(".trackVol");
    const ambBtn = row.querySelector(".ambBtn");
    const fxBtn = row.querySelector(".fxBtn");

    volSlider.addEventListener("input", () => {
      const v = clamp01(parseFloat(volSlider.value));
      setTrackVol(it.url, v);

      // ajustar se tocando
      const amb = ambientPlayers.get(it.url);
      if (amb) amb.volume = effectiveAmbientVol(it.url);
      const fx = fxPlayers.get(it.url);
      if (fx) fx.volume = effectiveFxVol(it.url);

      saveLastScene();
    });

    ambBtn.addEventListener("click", () => {
      toggleAmbient(it);
      // refresh label
      ambBtn.textContent = ambientPlayers.has(it.url) ? "Ambiente ✓" : "Ambiente+";
    });

    fxBtn.addEventListener("click", () => playFx(it));

    els.tracks.appendChild(row);
  }
}

/* Sets */
function readSets(){
  return readJson(LS_SETS, { sets: [] });
}
function writeSets(obj){
  writeJson(LS_SETS, obj);
}
function refreshSetSelect(){
  const { sets } = readSets();
  els.setSelect.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Selecione um set…";
  els.setSelect.appendChild(opt0);

  for (const s of sets){
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    els.setSelect.appendChild(opt);
  }
}
function currentScene(){
  return {
    ambients: [...ambientPlayers.keys()],
    fx: [...fxPlayers.keys()],
    ambientVol: clamp01(parseFloat(els.ambientVol.value)),
    fxVol: clamp01(parseFloat(els.fxVol.value)),
    trackVol: trackVol,
    ts: Date.now()
  };
}
function saveSet(){
  const name = (els.setName.value || "").trim();
  if (!name){ alert("Digite um nome para o set."); return; }
  const obj = readSets();
  const id = String(Date.now());
  obj.sets.push({ id, name, scene: currentScene() });
  writeSets(obj);
  els.setName.value = "";
  refreshSetSelect();
  els.setSelect.value = id;
}
function deleteSet(){
  const id = els.setSelect.value;
  if (!id){ alert("Selecione um set para excluir."); return; }
  const obj = readSets();
  obj.sets = obj.sets.filter(s => s.id !== id);
  writeSets(obj);
  refreshSetSelect();
}
function applySet(){
  const id = els.setSelect.value;
  if (!id){ alert("Selecione um set para aplicar."); return; }
  const { sets } = readSets();
  const s = sets.find(x => x.id === id);
  if (!s) return;

  // stop current
  stopAllAmbient();
  clearFx();

  // restore volumes
  els.ambientVol.value = clamp01(s.scene.ambientVol ?? 0.7);
  els.fxVol.value = clamp01(s.scene.fxVol ?? 0.9);

  if (s.scene.trackVol && typeof s.scene.trackVol === "object"){
    trackVol = s.scene.trackVol;
    writeJson(LS_TRACKVOL, trackVol);
  }

  // start ambients
  for (const url of (s.scene.ambients || [])){
    const a = new Audio(url);
    a.loop = true;
    a.preload = "auto";
    a.volume = effectiveAmbientVol(url);
    a.play().catch(()=>{});
    ambientPlayers.set(url, a);
  }

  // start fx (one shot)
  for (const url of (s.scene.fx || [])){
    const a = new Audio(url);
    a.preload = "auto";
    a.volume = effectiveFxVol(url);
    a.addEventListener("ended", () => {
      fxPlayers.delete(url);
      updateFxCount();
      saveLastScene();
    });
    fxPlayers.set(url, a);
    a.play().catch(()=>{});
  }

  updateAmbientPill();
  updateFxCount();
  if (lastTheme) openTheme(lastTheme); // refresh sliders/labels
  saveLastScene();
}

/* Reset per-track volumes */
function resetTrackVols(){
  if (!confirm("Resetar volumes individuais para 100%?")) return;
  trackVol = {};
  writeJson(LS_TRACKVOL, trackVol);
  if (lastTheme) openTheme(lastTheme);
  // ajustar players ativos
  for (const [url, a] of ambientPlayers) a.volume = effectiveAmbientVol(url);
  for (const [url, a] of fxPlayers) a.volume = effectiveFxVol(url);
  saveLastScene();
}

/* Persistence helpers */
function readJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    const obj = raw ? JSON.parse(raw) : fallback;
    return obj ?? fallback;
  }catch{
    return fallback;
  }
}
function writeJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}

/* Last scene restore (preload, doesn't autoplay on iOS) */
function saveLastScene(){
  writeJson(LS_LAST, currentScene());
}
function restoreLastScene(){
  const s = readJson(LS_LAST, null);
  if (!s) return;

  els.ambientVol.value = clamp01(s.ambientVol ?? 0.7);
  els.fxVol.value = clamp01(s.fxVol ?? 0.9);

  if (s.trackVol && typeof s.trackVol === "object"){
    trackVol = s.trackVol;
    writeJson(LS_TRACKVOL, trackVol);
  }else{
    trackVol = readJson(LS_TRACKVOL, {});
  }

  // We don't autoplay ambients/fx here to avoid iOS block.
  updateAmbientPill();
  updateFxCount();
}

/* Events */
els.reloadBtn.addEventListener("click", () => loadLibrary().catch(err => setStatus(err.message)));
els.themeFilter.addEventListener("input", () => renderThemes(window.__THEMES || []));

els.unlockBtn.addEventListener("click", () => unlockAudio());

els.ambientVol.addEventListener("input", () => {
  for (const [url, a] of ambientPlayers){
    a.volume = effectiveAmbientVol(url);
  }
  saveLastScene();
});
els.fxVol.addEventListener("input", () => {
  for (const [url, a] of fxPlayers){
    a.volume = effectiveFxVol(url);
  }
  saveLastScene();
});

els.stopAllAmbientBtn.addEventListener("click", stopAllAmbient);
els.clearFxBtn.addEventListener("click", clearFx);
els.resetTrackVolBtn.addEventListener("click", resetTrackVols);

els.saveSetBtn.addEventListener("click", saveSet);
els.deleteSetBtn.addEventListener("click", deleteSet);
els.applySetBtn.addEventListener("click", applySet);

/* init */
refreshSetSelect();
restoreLastScene();
updateAmbientPill();
updateFxCount();
loadLibrary().catch(err => setStatus(err.message));
