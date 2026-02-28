/* Jogatina Soundboard - versão estável (do jeito que você queria no início)
   - GitHub Pages
   - lista MP3 automaticamente da pasta /audio via GitHub API
   - cada subpasta vira um "Tema"
   - botões: tocar como Ambiente (loop, 1 canal) ou Efeito (multi-camadas)
   - Sets salvos em localStorage (ambiente + efeitos)
*/

const OWNER = "pdfto314";      // <<< ajuste aqui
const REPO  = "test";          // <<< ajuste aqui
const BRANCH = "main";         // <<< ajuste aqui
const AUDIO_PATH = "audio";    // <<< pasta base

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
  stopAmbientBtn: document.getElementById("stopAmbientBtn"),
  clearFxBtn: document.getElementById("clearFxBtn"),
  nowAmbient: document.getElementById("nowAmbient"),
  fxCount: document.getElementById("fxCount"),

  setSelect: document.getElementById("setSelect"),
  applySetBtn: document.getElementById("applySetBtn"),
  saveSetBtn: document.getElementById("saveSetBtn"),
  deleteSetBtn: document.getElementById("deleteSetBtn"),
  setName: document.getElementById("setName"),
};

let unlocked = false;

// Um canal de ambiente (loop)
const ambient = new Audio();
ambient.loop = true;
ambient.preload = "auto";

// Multi canal de efeitos
const fxPlayers = new Map(); // url -> Audio

function ghUrl(path){
  const p = encodeURIComponent(path).replace(/%2F/g, "/");
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${p}?ref=${encodeURIComponent(BRANCH)}`;
}

function isAudioFile(name){
  const low = name.toLowerCase();
  return EXT_OK.some(ext => low.endsWith(ext));
}

function niceTitle(fileName){
  // "forest_rain_01.mp3" -> "forest rain 01"
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setStatus(msg){
  els.status.textContent = msg;
}

async function fetchJson(url){
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json"
    }
  });
  if (!res.ok){
    const text = await res.text().catch(()=>"");
    throw new Error(`GitHub API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

async function listDir(path){
  const data = await fetchJson(ghUrl(path));
  if (!Array.isArray(data)) return [];
  return data;
}

async function loadLibrary(){
  els.themes.innerHTML = "";
  els.tracks.innerHTML = "";
  els.tracksTitle.textContent = "Selecione um tema";

  setStatus("Carregando temas do GitHub…");
  const root = await listDir(AUDIO_PATH);

  const folders = root
    .filter(x => x.type === "dir")
    .sort((a,b) => a.name.localeCompare(b.name, "pt-BR"));

  if (folders.length === 0){
    setStatus(`Nenhuma pasta em /${AUDIO_PATH}. Crie: audio/Floresta/*.mp3`);
    return;
  }

  // Pré-carrega contagem (sem baixar tudo pesado)
  const themes = [];
  for (const f of folders){
    const children = await listDir(`${AUDIO_PATH}/${f.name}`);
    const audios = children.filter(x => x.type === "file" && isAudioFile(x.name));
    themes.push({
      name: f.name,
      path: `${AUDIO_PATH}/${f.name}`,
      count: audios.length,
      // guarda lista crua pra abrir mais rápido
      items: audios.map(a => ({
        title: niceTitle(a.name),
        file: a.name,
        url: a.download_url, // direto pro raw CDN
      }))
    });
  }

  renderThemes(themes);
  setStatus(`Pronto: ${themes.length} tema(s).`);
  window.__THEMES = themes;
}

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
    row.innerHTML = `
      <div class="left">
        <div class="title">${escapeHtml(it.title)}</div>
        <div class="meta">${escapeHtml(it.file)}</div>
      </div>
      <div class="right">
        <button class="btn primary" type="button">Ambiente</button>
        <button class="btn" type="button">Efeito</button>
      </div>
    `;

    const [btnAmb, btnFx] = row.querySelectorAll("button");
    btnAmb.addEventListener("click", () => playAmbient(it));
    btnFx.addEventListener("click", () => playFx(it));
    els.tracks.appendChild(row);
  }
}

function playAmbient(track){
  ensureUnlocked();
  ambient.pause();
  ambient.src = track.url;
  ambient.volume = clamp01(parseFloat(els.ambientVol.value));
  ambient.currentTime = 0;
  ambient.play().catch(()=>{ /* iOS pode bloquear até unlock */ });

  els.nowAmbient.textContent = `Ambiente: ${track.title}`;
  saveLastScene();
}

function stopAmbient(){
  ambient.pause();
  ambient.src = "";
  els.nowAmbient.textContent = "Ambiente: —";
  saveLastScene();
}

function playFx(track){
  ensureUnlocked();

  // Se já está tocando, reinicia
  const existing = fxPlayers.get(track.url);
  if (existing){
    existing.currentTime = 0;
    existing.play().catch(()=>{});
    return;
  }

  const a = new Audio(track.url);
  a.preload = "auto";
  a.volume = clamp01(parseFloat(els.fxVol.value));
  a.addEventListener("ended", () => {
    fxPlayers.delete(track.url);
    updateFxCount();
    saveLastScene();
  });
  fxPlayers.set(track.url, a);
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

function updateFxCount(){
  els.fxCount.textContent = `Efeitos: ${fxPlayers.size}`;
}

function clamp01(v){
  if (Number.isNaN(v)) return 0.7;
  return Math.max(0, Math.min(1, v));
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* iOS unlock */
function ensureUnlocked(){
  if (unlocked) return;
  // tentar "desbloquear" automaticamente ao clicar em play
  // mas o botão dedicado é o mais confiável
}

async function unlockAudio(){
  try{
    // tocar um áudio "mudo" rápido para liberar
    const a = new Audio();
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    a.volume = 0;
    await a.play();
    a.pause();
    unlocked = true;
    els.unlockDot.classList.add("on");
  }catch(e){
    // mesmo se falhar, marca como tentado
    unlocked = true;
    els.unlockDot.classList.add("on");
  }
}

/* Sets (localStorage) */
const LS_KEY = "jogatina_sets_v1";
const LS_LAST = "jogatina_last_scene_v1";

function readSets(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    const obj = raw ? JSON.parse(raw) : { sets: [] };
    if (!Array.isArray(obj.sets)) obj.sets = [];
    return obj;
  }catch{
    return { sets: [] };
  }
}

function writeSets(obj){
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
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
    ambient: ambient.src ? { url: ambient.src, title: els.nowAmbient.textContent.replace(/^Ambiente:\s*/,"") } : null,
    fx: [...fxPlayers.keys()],
    ambientVol: clamp01(parseFloat(els.ambientVol.value)),
    fxVol: clamp01(parseFloat(els.fxVol.value)),
    ts: Date.now()
  };
}

function saveSet(){
  const name = (els.setName.value || "").trim();
  if (!name){
    alert("Digite um nome para o set.");
    return;
  }
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
  if (!id){
    alert("Selecione um set para excluir.");
    return;
  }
  const obj = readSets();
  obj.sets = obj.sets.filter(s => s.id !== id);
  writeSets(obj);
  refreshSetSelect();
}

function applySet(){
  const id = els.setSelect.value;
  if (!id){
    alert("Selecione um set para aplicar.");
    return;
  }
  const { sets } = readSets();
  const s = sets.find(x => x.id === id);
  if (!s) return;

  // volumes
  els.ambientVol.value = clamp01(s.scene.ambientVol ?? 0.7);
  els.fxVol.value = clamp01(s.scene.fxVol ?? 0.9);
  ambient.volume = clamp01(parseFloat(els.ambientVol.value));
  for (const a of fxPlayers.values()){
    a.volume = clamp01(parseFloat(els.fxVol.value));
  }

  // áudio
  stopAmbient();
  clearFx();

  if (s.scene.ambient?.url){
    playAmbient({ url: s.scene.ambient.url, title: s.scene.ambient.title || "Ambiente" });
  }
  for (const url of (s.scene.fx || [])){
    playFx({ url, title: "Efeito" });
  }
  saveLastScene();
}

function saveLastScene(){
  try{ localStorage.setItem(LS_LAST, JSON.stringify(currentScene())); }catch{}
}

function restoreLastScene(){
  try{
    const raw = localStorage.getItem(LS_LAST);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s) return;
    els.ambientVol.value = clamp01(s.ambientVol ?? 0.7);
    els.fxVol.value = clamp01(s.fxVol ?? 0.9);
    if (s.ambient?.url){
      // não auto-play no iOS; só prepara
      ambient.src = s.ambient.url;
      ambient.loop = true;
      ambient.volume = clamp01(parseFloat(els.ambientVol.value));
      els.nowAmbient.textContent = `Ambiente: ${s.ambient.title || "—"}`;
    }
    updateFxCount();
  }catch{}
}

/* events */
els.reloadBtn.addEventListener("click", () => loadLibrary().catch(err => setStatus(err.message)));
els.themeFilter.addEventListener("input", () => renderThemes(window.__THEMES || []));

els.unlockBtn.addEventListener("click", () => unlockAudio());
els.ambientVol.addEventListener("input", () => { ambient.volume = clamp01(parseFloat(els.ambientVol.value)); saveLastScene(); });
els.fxVol.addEventListener("input", () => {
  const v = clamp01(parseFloat(els.fxVol.value));
  for (const a of fxPlayers.values()) a.volume = v;
  saveLastScene();
});
els.stopAmbientBtn.addEventListener("click", stopAmbient);
els.clearFxBtn.addEventListener("click", clearFx);

els.saveSetBtn.addEventListener("click", saveSet);
els.deleteSetBtn.addEventListener("click", deleteSet);
els.applySetBtn.addEventListener("click", applySet);

/* init */
refreshSetSelect();
restoreLastScene();
loadLibrary().catch(err => setStatus(err.message));
