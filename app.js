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

const EXT_OK = [".mp3", ".wav", ".ogg", ".m4a", ".mpeg"];

const els = {
  status: document.getElementById("status"),
  themes: document.getElementById("themes"),
  themeFilter: document.getElementById("themeFilter"),
  reloadBtn: document.getElementById("reloadBtn"),
  tracksTitle: document.getElementById("tracksTitle"),
  tracks: document.getElementById("tracks"),

  unlockBtn: document.getElementById("unlockBtn"),
  unlockDot: document.getElementById("unlockDot"),
  unlockLabel: document.getElementById("unlockLabel"),
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

const ambientPlayers = new Map(); // url -> Audio
const fxPlayers = new Map();

const LS_TRACKVOL = "jogatina_track_vol_v1";  // { url: 0..1 }
const LS_SETS = "jogatina_sets_v2";           // { sets:[...] }
const LS_CACHE = "jogatina_library_cache_v1"; // {themes:[...], ts}
const LS_LAST = "jogatina_last_scene_v4";

let trackVol = readJson(LS_TRACKVOL, {});
let themes = [];
let swapOptionsHtml = "";   // <option>s do "Trocar por…", montado 1x por biblioteca
let libraryStatus = "";
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

function fileName(url){
  try{ return decodeURIComponent(url.split("/").pop() || ""); }
  catch{ return url.split("/").pop() || ""; }
}
function shortName(url){ return niceTitle(fileName(url)).slice(0, 18) || "Áudio"; }

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

function refreshVolumes(){
  for (const [url, a] of ambientPlayers) a.volume = effectiveAmbientVol(url);
  for (const [url, a] of fxPlayers) a.volume = effectiveFxVol(url);
}

/* Muda o volume individual e sincroniza todos os sliders da mesma faixa */
function changeTrackVol(url, v, source){
  setTrackVol(url, v);
  refreshVolumes();
  for (const el of document.querySelectorAll("input[data-vol-url]")){
    if (el !== source && el.dataset.volUrl === url) el.value = getTrackVol(url);
  }
  saveLastScene();
}

function updateAmbientPill(){
  if (ambientPlayers.size === 0){ els.nowAmbients.textContent = "Ambientes: —"; return; }
  const names = [...ambientPlayers.keys()].slice(0,3).map(shortName);
  const more = ambientPlayers.size > 3 ? ` +${ambientPlayers.size - 3}` : "";
  els.nowAmbients.textContent = `Ambientes: ${names.join(", ")}${more}`;
}
function updateFxCount(){ els.fxCount.textContent = `Efeitos: ${fxPlayers.size}`; }

/* Atualiza botões/sliders da lista de faixas aberta sem recriá-la */
function syncTrackList(){
  for (const btn of els.tracks.querySelectorAll(".ambBtn")){
    btn.textContent = ambientPlayers.has(btn.dataset.url) ? "Ambiente ✓" : "Ambiente+";
  }
  for (const el of els.tracks.querySelectorAll("input[data-vol-url]")){
    el.value = getTrackVol(el.dataset.volUrl);
  }
}

function refreshUI(){
  updateAmbientPill();
  updateFxCount();
  renderNowPlaying();
  syncTrackList();
  saveLastScene();
}

/* playback */
function createAudio(url, loop, volume){
  const a = new Audio(url);
  a.loop = loop;
  a.preload = "auto";
  a.volume = volume;
  return a;
}

function startAmbient(url){
  if (!url || ambientPlayers.has(url)) return;
  const a = createAudio(url, true, effectiveAmbientVol(url));
  // Se o iOS bloquear (sem toque do usuário), fica pausado e volta no "Liberar áudio"
  a.play().catch(()=>{});
  ambientPlayers.set(url, a);
}
function stopAmbient(url){
  ambientPlayers.get(url)?.pause();
  ambientPlayers.delete(url);
}

function startFx(url){
  const existing = fxPlayers.get(url);
  if (existing){
    existing.currentTime = 0;
    existing.volume = effectiveFxVol(url);
    existing.play().catch(()=>{});
    return;
  }

  const a = createAudio(url, false, effectiveFxVol(url));
  const done = () => {
    if (fxPlayers.get(url) !== a) return;
    fxPlayers.delete(url);
    updateFxCount();
    saveLastScene();
  };
  a.addEventListener("ended", done);
  fxPlayers.set(url, a);
  // efeito que não conseguiu tocar não deve ficar preso no contador
  a.play().catch(done);
}

function stopAllPlayers(){
  for (const a of ambientPlayers.values()) a.pause();
  for (const a of fxPlayers.values()) a.pause();
  ambientPlayers.clear();
  fxPlayers.clear();
}

function toggleAmbient(url){
  if (ambientPlayers.has(url)) stopAmbient(url);
  else startAmbient(url);
  refreshUI();
}

function swapAmbient(oldUrl, newUrl){
  if (!newUrl || newUrl === oldUrl || ambientPlayers.has(newUrl)) return;

  // mantém o volume individual do antigo no novo (se o novo ainda não tiver)
  if (trackVol[newUrl] == null) setTrackVol(newUrl, getTrackVol(oldUrl));

  stopAmbient(oldUrl);
  startAmbient(newUrl);
  refreshUI();
}

function stopAllAmbient(){
  for (const a of ambientPlayers.values()) a.pause();
  ambientPlayers.clear();
  refreshUI();
}

function playFx(url){
  startFx(url);
  updateFxCount();
  saveLastScene();
}

function clearFx(){
  for (const a of fxPlayers.values()) a.pause();
  fxPlayers.clear();
  updateFxCount();
  saveLastScene();
}

function unlockAudio(){
  // No iOS o play() só é liberado dentro de um toque; aproveita para retomar
  // ambientes que ficaram pausados (ex.: cena restaurada ao abrir a página).
  for (const a of ambientPlayers.values()){
    if (a.paused) a.play().catch(()=>{});
  }
  els.unlockDot.classList.add("on");
  els.unlockLabel.textContent = "Áudio liberado";
}

/* now playing (trocar/volume individual) */
function renderNowPlaying(){
  els.nowPlayingList.innerHTML = "";

  if (ambientPlayers.size === 0){
    const div = document.createElement("div");
    div.className = "status";
    div.textContent = "Nenhum ambiente tocando.";
    els.nowPlayingList.appendChild(div);
    return;
  }

  for (const url of ambientPlayers.keys()){
    const div = document.createElement("div");
    div.className = "nowItem";

    div.innerHTML = `
      <div class="nowLeft">
        <div class="nowTitle">${escapeHtml(shortName(url))}</div>
        <div class="nowMeta">${escapeHtml(fileName(url))}</div>
      </div>
      <div class="nowRight">
        <div class="volBox compact">
          <label>Vol</label>
          <input class="volSlider" type="range" min="0" max="1" step="0.01" value="${getTrackVol(url)}" data-vol-url="${escapeHtml(url)}">
        </div>
        <select class="swapSelect">
          <option value="">Trocar por…</option>
          ${swapOptionsHtml}
        </select>
        <button class="btn danger stopOne" type="button" title="Parar este ambiente">✕</button>
      </div>
    `;

    const sel = div.querySelector(".swapSelect");
    const slider = div.querySelector(".volSlider");

    div.querySelector(".stopOne").addEventListener("click", () => {
      stopAmbient(url);
      refreshUI();
    });
    sel.addEventListener("change", () => {
      const newUrl = sel.value;
      sel.value = "";
      swapAmbient(url, newUrl);
    });
    slider.addEventListener("input", () => changeTrackVol(url, parseFloat(slider.value), slider));

    els.nowPlayingList.appendChild(div);
  }
}

/* GitHub API helpers (somente usado no botão Recarregar) */
async function ghFetch(url){
  const res = await fetch(url, { headers: { "Accept":"application/vnd.github+json" }});
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.json();
}
async function listDir(path){
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`;
  return await ghFetch(api);
}

function renderThemes(){
  els.themes.innerHTML = "";
  const filter = (els.themeFilter.value || "").trim().toLowerCase();

  const filtered = themes.filter(t => !filter || t.name.toLowerCase().includes(filter));
  setStatus(filtered.length === 0 ? "Nenhum tema com esse filtro." : libraryStatus);

  for (const theme of filtered){
    const div = document.createElement("div");
    div.className = "theme";
    div.innerHTML = `
      <div class="name">${escapeHtml(theme.name)}</div>
      <div class="count">${theme.items?.length || 0} arquivo(s)</div>
    `;
    div.addEventListener("click", () => openTheme(theme));
    els.themes.appendChild(div);
  }
}

function setLibrary(newThemes, source){
  themes = newThemes;

  const all = [];
  for (const t of themes){
    for (const it of (t.items || [])) all.push({ theme: t.name, title: it.title, url: it.url });
  }
  all.sort((a,b)=>(a.theme + " " + a.title).localeCompare(b.theme + " " + b.title, "pt-BR"));
  swapOptionsHtml = all
    .map(t => `<option value="${escapeHtml(t.url)}">${escapeHtml(`${t.theme} — ${t.title}`)}</option>`)
    .join("");

  libraryStatus = `Pronto: ${themes.length} tema(s) (${source}).`;
  renderThemes();
  renderNowPlaying();

  // reabre o tema que estava aberto (ou o da última sessão) com os dados novos
  const name = lastTheme?.name ?? readJson(LS_LAST, null)?.lastThemeName;
  const t = themes.find(x => x.name === name);
  if (t) openTheme(t);
}

function openTheme(theme){
  lastTheme = theme;
  els.tracksTitle.textContent = `Tema: ${theme.name}`;
  els.tracks.innerHTML = "";
  saveLastScene();

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
        <div class="volBox">
          <label>Vol</label>
          <input class="trackVol" type="range" min="0" max="1" step="0.01" value="${getTrackVol(it.url)}" data-vol-url="${escapeHtml(it.url)}">
        </div>
        <button class="btn primary ambBtn" type="button" data-url="${escapeHtml(it.url)}">${ambientPlayers.has(it.url) ? "Ambiente ✓" : "Ambiente+"}</button>
        <button class="btn fxBtn" type="button">Efeito</button>
      </div>
    `;

    const volSlider = row.querySelector(".trackVol");
    volSlider.addEventListener("input", () => changeTrackVol(it.url, parseFloat(volSlider.value), volSlider));
    row.querySelector(".ambBtn").addEventListener("click", () => toggleAmbient(it.url));
    row.querySelector(".fxBtn").addEventListener("click", () => playFx(it.url));

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
    setLibrary(data.themes, "playlist.json");
  }catch(e){
    const cache = readJson(LS_CACHE, null);
    if (Array.isArray(cache?.themes)){
      setLibrary(cache.themes, "cache");
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

  const newThemes = [];
  for (const f of folders){
    const children = await listDir(f.path);
    const audios = children.filter(x => x.type === "file" && isAudioFile(x.name));
    newThemes.push({
      name: f.name,
      count: audios.length,
      // caminho relativo (igual ao playlist.json) para não perder volumes/sets salvos
      items: audios.map(a => ({ title: niceTitle(a.name), file: a.name, url: a.path }))
    });
  }

  writeJson(LS_CACHE, { themes: newThemes, ts: Date.now() });
  setLibrary(newThemes, "GitHub API");
}

/* scenes / sets */
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

function currentScene(){
  return {
    ambientVol: clamp01(parseFloat(els.ambientVol.value)),
    fxVol: clamp01(parseFloat(els.fxVol.value)),
    ambients: [...ambientPlayers.keys()],
    fx: [...fxPlayers.keys()],
    trackVol
  };
}

function applyScene(scene, { withFx }){
  stopAllPlayers();

  els.ambientVol.value = clamp01(scene.ambientVol ?? 0.7);
  els.fxVol.value = clamp01(scene.fxVol ?? 0.9);

  if (scene.trackVol && typeof scene.trackVol === "object"){
    trackVol = { ...scene.trackVol };
    writeJson(LS_TRACKVOL, trackVol);
  }

  for (const url of (scene.ambients || [])) startAmbient(url);
  if (withFx){
    for (const url of (scene.fx || [])) startFx(url);
  }
  refreshUI();
}

function saveLastScene(){
  writeJson(LS_LAST, { scene: currentScene(), lastThemeName: lastTheme?.name || null });
}

function restoreLastScene(){
  const data = readJson(LS_LAST, null);
  if (!data?.scene) return;
  // efeitos são pontuais: não faz sentido tocá-los de novo ao reabrir a página
  applyScene(data.scene, { withFx: false });
  // applyScene salva a cena com lastTheme ainda vazio; preserva o tema anterior
  writeJson(LS_LAST, { ...readJson(LS_LAST, {}), lastThemeName: data.lastThemeName || null });
}

function refreshSetUI(){
  const { sets } = readSets();
  els.setSelect.innerHTML = `<option value="">Selecione…</option>` + sets.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
}

function saveSet(){
  const name = (els.setName.value || "").trim();
  if (!name){ alert("Dê um nome para o set."); return; }

  const { sets } = readSets();
  const scene = currentScene();

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
  const s = readSets().sets.find(x => x.id === id);
  if (s) applyScene(s.scene, { withFx: true });
}

/* reset vols */
function resetTrackVols(){
  if (!confirm("Resetar volumes individuais para 100%?")) return;
  trackVol = {};
  writeJson(LS_TRACKVOL, trackVol);
  refreshVolumes();
  refreshUI();
}

/* init */
els.themeFilter.addEventListener("input", renderThemes);
els.reloadBtn.addEventListener("click", async () => {
  try{ await reloadFromGitHubAPI(); }
  catch(e){ setStatus("Falha ao recarregar via GitHub API (rate limit?)."); }
});
els.unlockBtn.addEventListener("click", unlockAudio);
els.stopAllAmbientBtn.addEventListener("click", stopAllAmbient);
els.clearFxBtn.addEventListener("click", clearFx);
els.resetTrackVolBtn.addEventListener("click", resetTrackVols);

for (const slider of [els.ambientVol, els.fxVol]){
  slider.addEventListener("input", () => {
    refreshVolumes();
    saveLastScene();
  });
}

els.saveSetBtn.addEventListener("click", saveSet);
els.deleteSetBtn.addEventListener("click", deleteSet);
els.applySetBtn.addEventListener("click", applySet);

els.setSelect.addEventListener("change", () => {
  const id = els.setSelect.value;
  if (!id) return;
  const s = readSets().sets.find(x => x.id === id);
  if (s) els.setName.value = s.name;
});

refreshSetUI();
restoreLastScene();
loadLibraryPreferManifest();
