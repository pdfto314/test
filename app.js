/* Jogatina Soundboard - Manifest-first (evita GitHub API rate limit no iPad)
   - Carrega /playlist.json (estático no repo)
   - Botão Recarregar: tenta GitHub API para rebuild e salva no cache (localStorage)
   - Multi-ambiente + FX
   - Volume individual por áudio (persistido)
   - Sets com multi-ambiente + volumes
*/

const OWNER = "pdfto314";      // opcional: usado apenas no "Recarregar" via API
const REPO  = "test";
const BRANCH = "main";
const AUDIO_PATH = "audio";

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
  nowPlayingList: document.getElementById("nowPlayingList"),

  setSelect: document.getElementById("setSelect"),
  applySetBtn: document.getElementById("applySetBtn"),
  saveSetBtn: document.getElementById("saveSetBtn"),
  deleteSetBtn: document.getElementById("deleteSetBtn"),
  setName: document.getElementById("setName"),
};

let unlocked = false;

const ambientPlayers = new Map(); // url -> Audio
const fxPlayers = new Map();

const LS_TRACKVOL = "jogatina_track_vol_v1";  // { url: 0..1 }
const LS_SETS = "jogatina_sets_v2";           // { sets:[...] }
const LS_CACHE = "jogatina_library_cache_v1"; // {themes:[...], ts}
const LS_LAST = "jogatina_last_scene_v4";

let trackVol = readJson(LS_TRACKVOL, {});
let lastTheme = null;

function clamp01(v){ if (Number.isNaN(v)) return 1; return Math.max(0, Math.min(1, v)); }
function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function setStatus(msg){ els.status.textContent = msg; }
function isAudioFile(name){ const low = name.toLowerCase(); return EXT_OK.some(ext => low.endsWith(ext)); }

function readJson(key, fallback){
  try{ const raw = localStorage.getItem(key); if (!raw) return fallback; return JSON.parse(raw); }
  catch{ return fallback; }
}
function writeJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}

function niceTitle(file){
  return file
    .replace(/\.[^.]+$/,"")
    .replaceAll("_"," ")
    .replaceAll("-"," ")
    .replace(/\s+/g," ")
    .trim();
}

function shortName(url){
  try{
    const last = decodeURIComponent(url.split("/").pop() || "");
    return niceTitle(last).slice(0, 18);
  }catch{ return "Áudio"; }
}

function getTrackVol(url){
  const v = trackVol?.[url];
  return (typeof v === "number") ? clamp01(v) : 1;
}
function setTrackVol(url, v){
  trackVol[url] = clamp01(v);
  writeJson(LS_TRACKVOL, trackVol);
}

function effectiveAmbientVol(url){
  return clamp01(getTrackVol(url) * parseFloat(els.ambientVol.value));
}
function effectiveFxVol(url){
  return clamp01(getTrackVol(url) * parseFloat(els.fxVol.value));
}

function updateAmbientPill(){
  if (ambientPlayers.size === 0){ els.nowAmbients.textContent = "Ambientes: —"; return; }
  const names = [...ambientPlayers.keys()].slice(0,3).map(shortName);
  const more = ambientPlayers.size > 3 ? ` +${ambientPlayers.size - 3}` : "";
  els.nowAmbients.textContent = `Ambientes: ${names.join(", ")}${more}`;
}
function updateFxCount(){ els.fxCount.textContent = `Efeitos: ${fxPlayers.size}`; }

/* now playing (trocar/volume individual) */
function stopOneAmbient(url){
  const a = ambientPlayers.get(url);
  if (a){ try{ a.pause(); }catch(e){} }
  ambientPlayers.delete(url);
  updateAmbientPill();
  renderNowPlaying();
  saveLastScene();
}
function startAmbientByUrl(url){
  if (!url || ambientPlayers.has(url)) return;
  ensureUnlocked();
  const a = new Audio(url);
  a.loop = true;
  a.preload = "auto";
  a.volume = effectiveAmbientVol(url);
  a.play().catch(()=>{});
  ambientPlayers.set(url, a);
  updateAmbientPill();
  renderNowPlaying();
  saveLastScene();
}
function swapAmbient(oldUrl, newUrl){
  if (!newUrl || newUrl === oldUrl) return;

  // mantém o volume individual do antigo no novo (se o novo ainda não tiver)
  const oldV = getTrackVol(oldUrl);
  if (trackVol[newUrl] == null) setTrackVol(newUrl, oldV);

  stopOneAmbient(oldUrl);
  startAmbientByUrl(newUrl);
}

function renderNowPlaying(){
  if (!els.nowPlayingList) return;

  const all = window.__ALL_TRACKS || [];
  const mkOptions = () => {
    const opts = ['<option value="">Trocar por…</option>'];
    for (const t of all){
      const label = `${t.theme} — ${t.title}`;
      opts.push(`<option value="${escapeHtml(t.url)}">${escapeHtml(label)}</option>`);
    }
    return opts.join("");
  };

  els.nowPlayingList.innerHTML = "";

  const ambUrls = [...ambientPlayers.keys()];
  if (ambUrls.length === 0){
    const div = document.createElement("div");
    div.className = "status";
    div.textContent = "Nenhum ambiente tocando.";
    els.nowPlayingList.appendChild(div);
    return;
  }

  for (const url of ambUrls){
    const div = document.createElement("div");
    div.className = "nowItem";

    const currentVol = getTrackVol(url);

    div.innerHTML = `
      <div class="nowLeft">
        <div class="nowTitle">${escapeHtml(shortName(url))}</div>
        <div class="nowMeta">${escapeHtml(decodeURIComponent(url.split("/").pop() || ""))}</div>
      </div>
      <div class="nowRight">
        <div class="volBox compact">
          <label>Vol</label>
          <input class="volSlider" type="range" min="0" max="1" step="0.01" value="${currentVol}">
        </div>
        <select class="swapSelect">
          ${mkOptions()}
        </select>
        <button class="btn danger stopOne" type="button" title="Parar este ambiente">✕</button>
      </div>
    `;

    const stopBtn = div.querySelector(".stopOne");
    const sel = div.querySelector(".swapSelect");
    const slider = div.querySelector(".volSlider");

    stopBtn.addEventListener("click", () => stopOneAmbient(url));

    sel.addEventListener("change", () => {
      const newUrl = sel.value;
      sel.value = "";
      swapAmbient(url, newUrl);
    });

    slider.addEventListener("input", () => {
      const v = clamp01(parseFloat(slider.value));
      setTrackVol(url, v);
      const amb = ambientPlayers.get(url);
      if (amb) amb.volume = effectiveAmbientVol(url);
      saveLastScene();
    });

    els.nowPlayingList.appendChild(div);
  }
}

/* playback */
function ensureUnlocked(){
  /* iOS gate */
  if (unlocked) return;
  // só marca como desbloqueado quando usuário clicar no botão
}

function unlockAudio(){
  try{
    const a = new Audio();
    a.muted = true;
    a.play().catch(()=>{});
  }catch(e){}
  unlocked = true;
  els.unlockDot.classList.add("on");
}

function toggleAmbient(track){
  ensureUnlocked();
  const url = track.url;

  if (ambientPlayers.has(url)){
    try{ ambientPlayers.get(url).pause(); }catch(e){}
    ambientPlayers.delete(url);
    updateAmbientPill();
    renderNowPlaying();
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
  renderNowPlaying();
  saveLastScene();
}

function stopAllAmbient(){
  for (const a of ambientPlayers.values()){ try{ a.pause(); }catch(e){} }
  ambientPlayers.clear();
  updateAmbientPill();
  renderNowPlaying();
  saveLastScene();
}

function playFx(track){
  ensureUnlocked();
  const url = track.url;

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
  for (const a of fxPlayers.values()){ try{ a.pause(); }catch(e){} }
  fxPlayers.clear();
  updateFxCount();
  saveLastScene();
}

/* GitHub API helpers (somente usado no botão Recarregar) */
async function ghFetch(url){
  const res = await fetch(url, { headers: { "Accept":"application/vnd.github+json" }});
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.json();
}
async function listDir(path){
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  return await ghFetch(api);
}

function renderThemes(themes){
  els.themes.innerHTML = "";
  const filter = (els.themeFilter.value || "").trim().toLowerCase();

  const filtered = themes.filter(t => !filter || t.name.toLowerCase().includes(filter));
  if (filtered.length === 0){
    setStatus("Nenhum tema com esse filtro.");
  }

  for (const theme of filtered){
    const div = document.createElement("div");
    div.className = "theme";
    div.innerHTML = `
      <div class="name">${escapeHtml(theme.name)}</div>
      <div class="count">${theme.count || (theme.items?.length || 0)} arquivo(s)</div>
    `;
    div.addEventListener("click", () => openTheme(theme));
    els.themes.appendChild(div);
  }
}

function flattenAllTracks(themes){
  const all = [];
  for (const t of (themes || [])){
    for (const it of (t.items || [])){
      all.push({ theme: t.name, title: it.title, file: it.file, url: it.url });
    }
  }
  all.sort((a,b)=>(a.theme + " " + a.title).localeCompare(b.theme + " " + b.title, "pt-BR"));
  window.__ALL_TRACKS = all;
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
        <div class="volBox">
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
      const amb = ambientPlayers.get(it.url);
      if (amb) amb.volume = effectiveAmbientVol(it.url);
      const fx = fxPlayers.get(it.url);
      if (fx) fx.volume = effectiveFxVol(it.url);
      renderNowPlaying();
      saveLastScene();
    });

    ambBtn.addEventListener("click", () => {
      toggleAmbient(it);
      ambBtn.textContent = ambientPlayers.has(it.url) ? "Ambiente ✓" : "Ambiente+";
    });
    fxBtn.addEventListener("click", () => playFx(it));

    els.tracks.appendChild(row);
  }
}

/* load library: prefer manifest, then cache */
async function loadLibraryPreferManifest(){
  setStatus("Carregando playlist.json…");
  try{
    const res = await fetch("./playlist.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`playlist.json ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.themes)) throw new Error("playlist.json inválido (esperado: {themes:[...]})");

    writeJson(LS_CACHE, { themes: data.themes, ts: Date.now() });
    window.__THEMES = data.themes;
    flattenAllTracks(data.themes);
    renderThemes(data.themes);
    setStatus(`Pronto: ${data.themes.length} tema(s) (playlist.json).`);
    renderNowPlaying();
    return;
  }catch(e){
    const cache = readJson(LS_CACHE, null);
    if (cache?.themes){
      window.__THEMES = cache.themes;
      flattenAllTracks(cache.themes);
      renderThemes(cache.themes);
      setStatus(`Pronto: ${cache.themes.length} tema(s) (cache).`);
      renderNowPlaying();
      return;
    }
    setStatus("Falha ao carregar playlist.json e cache vazio. Use Recarregar (GitHub API).");
  }
}

async function reloadFromGitHubAPI(){
  setStatus("Recarregando via GitHub API…");
  const root = await listDir(AUDIO_PATH);
  const folders = root.filter(x => x.type === "dir").sort((a,b)=>a.name.localeCompare(b.name, "pt-BR"));
  if (folders.length === 0){
    setStatus(`Nenhuma pasta em /${AUDIO_PATH}.`);
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
  flattenAllTracks(themes);
  renderThemes(themes);
  writeJson(LS_CACHE, { themes, ts: Date.now() });
  setStatus(`Pronto: ${themes.length} tema(s) (GitHub API).`);
  renderNowPlaying();
}

/* sets */
function readSets(){
  const data = readJson(LS_SETS, { sets: [] });
  if (!Array.isArray(data.sets)) data.sets = [];
  return data;
}
function writeSets(sets){
  writeJson(LS_SETS, { sets });
}
function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function saveLastScene(){
  const scene = {
    ambientVol: clamp01(parseFloat(els.ambientVol.value)),
    fxVol: clamp01(parseFloat(els.fxVol.value)),
    ambients: [...ambientPlayers.keys()],
    fx: [...fxPlayers.keys()],
    trackVol
  };
  writeJson(LS_LAST, { scene, lastThemeName: lastTheme?.name || null });
}
function restoreLastScene(){
  const data = readJson(LS_LAST, null);
  if (!data?.scene) return;

  els.ambientVol.value = clamp01(data.scene.ambientVol ?? 0.7);
  els.fxVol.value = clamp01(data.scene.fxVol ?? 0.9);

  if (data.scene.trackVol && typeof data.scene.trackVol === "object"){
    trackVol = data.scene.trackVol;
    writeJson(LS_TRACKVOL, trackVol);
  }

  for (const url of (data.scene.ambients || [])){
    const a = new Audio(url);
    a.loop = true;
    a.preload = "auto";
    a.volume = effectiveAmbientVol(url);
    a.play().catch(()=>{});
    ambientPlayers.set(url, a);
  }

  for (const url of (data.scene.fx || [])){
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
  renderNowPlaying();

  // tenta abrir o último tema quando a lib estiver pronta (feito depois do load)
  window.__LAST_THEME_NAME = data.lastThemeName || null;
}

function refreshSetUI(){
  const { sets } = readSets();
  els.setSelect.innerHTML = `<option value="">Selecione…</option>` + sets.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

function saveSet(){
  const name = (els.setName.value || "").trim();
  if (!name){ alert("Dê um nome para o set."); return; }

  const { sets } = readSets();
  const scene = {
    ambientVol: clamp01(parseFloat(els.ambientVol.value)),
    fxVol: clamp01(parseFloat(els.fxVol.value)),
    ambients: [...ambientPlayers.keys()],
    fx: [...fxPlayers.keys()],
    trackVol
  };

  const existing = sets.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (existing){
    if (!confirm("Já existe um set com esse nome. Sobrescrever?")) return;
    existing.scene = scene;
  }else{
    sets.push({ id: uid(), name, scene });
  }
  writeSets(sets);
  refreshSetUI();
  alert("Set salvo!");
}

function deleteSet(){
  const id = els.setSelect.value;
  if (!id){ alert("Selecione um set para excluir."); return; }
  const { sets } = readSets();
  const idx = sets.findIndex(x => x.id === id);
  if (idx < 0) return;
  if (!confirm(`Excluir o set "${sets[idx].name}"?`)) return;
  sets.splice(idx, 1);
  writeSets(sets);
  refreshSetUI();
  els.setName.value = "";
}

function applySet(){
  const id = els.setSelect.value;
  if (!id){ alert("Selecione um set para aplicar."); return; }
  const { sets } = readSets();
  const s = sets.find(x => x.id === id);
  if (!s) return;

  stopAllAmbient();
  clearFx();

  els.ambientVol.value = clamp01(s.scene.ambientVol ?? 0.7);
  els.fxVol.value = clamp01(s.scene.fxVol ?? 0.9);

  if (s.scene.trackVol && typeof s.scene.trackVol === "object"){
    trackVol = s.scene.trackVol;
    writeJson(LS_TRACKVOL, trackVol);
  }

  for (const url of (s.scene.ambients || [])){
    const a = new Audio(url);
    a.loop = true;
    a.preload = "auto";
    a.volume = effectiveAmbientVol(url);
    a.play().catch(()=>{});
    ambientPlayers.set(url, a);
  }

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
  renderNowPlaying();
  if (lastTheme) openTheme(lastTheme);
  saveLastScene();
}

/* reset vols */
function resetTrackVols(){
  if (!confirm("Resetar volumes individuais para 100%?")) return;
  trackVol = {};
  writeJson(LS_TRACKVOL, trackVol);
  if (lastTheme) openTheme(lastTheme);
  renderNowPlaying();
  saveLastScene();
}

/* init */
els.themeFilter.addEventListener("input", () => {
  const themes = window.__THEMES || [];
  renderThemes(themes);
});
els.reloadBtn.addEventListener("click", async () => {
  try{ await reloadFromGitHubAPI(); }
  catch(e){ setStatus("Falha ao recarregar via GitHub API (rate limit?)."); }
});
els.unlockBtn.addEventListener("click", () => {
  unlockAudio();
  els.unlockBtn.classList.add("primary");
});
els.stopAllAmbientBtn.addEventListener("click", stopAllAmbient);
els.clearFxBtn.addEventListener("click", clearFx);
els.resetTrackVolBtn.addEventListener("click", resetTrackVols);

els.ambientVol.addEventListener("input", () => {
  for (const [url, a] of ambientPlayers.entries()){
    a.volume = effectiveAmbientVol(url);
  }
  saveLastScene();
});
els.fxVol.addEventListener("input", () => {
  for (const [url, a] of fxPlayers.entries()){
    a.volume = effectiveFxVol(url);
  }
  saveLastScene();
});

els.saveSetBtn.addEventListener("click", saveSet);
els.deleteSetBtn.addEventListener("click", deleteSet);
els.applySetBtn.addEventListener("click", applySet);

els.setSelect.addEventListener("change", () => {
  const id = els.setSelect.value;
  if (!id) return;
  const { sets } = readSets();
  const s = sets.find(x => x.id === id);
  if (s) els.setName.value = s.name;
});

refreshSetUI();
restoreLastScene();

loadLibraryPreferManifest().then(() => {
  // tenta abrir o último tema, se existir
  const target = window.__LAST_THEME_NAME;
  if (target && Array.isArray(window.__THEMES)){
    const t = window.__THEMES.find(x => x.name === target);
    if (t) openTheme(t);
  }
  renderNowPlaying();
});