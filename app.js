/* Jogatina Soundboard — feito para iPad
   - Biblioteca vem do playlist.json (atualizado pelo GitHub Action / gerar_playlist.py)
   - Toque no som = loop (ambiente) · botão 1× = toca uma vez (efeito)
   - Volumes via Web Audio: no iPad o volume do <audio> é somente leitura
   - Cenas e volumes salvos no aparelho (localStorage)
*/
import { initUpload } from "./upload.js";

const FADE_IN = 1.2;
const FADE_OUT = 0.8;
const SCENE_FADE = 1.5;

const LS_TRACKVOL = "jogatina_track_vol_v1";  // { url: 0..1 }
const LS_SETS = "jogatina_sets_v2";           // { sets:[{id,name,scene}] }
const LS_CACHE = "jogatina_library_cache_v1"; // { themes, ts }
const LS_LAST = "jogatina_last_scene_v4";     // { scene, lastThemeName }

const $ = (id) => document.getElementById(id);
const els = {
  search: $("search"),
  scenesBtn: $("scenesBtn"),
  uploadBtn: $("uploadBtn"),
  refreshBtn: $("refreshBtn"),
  themeList: $("themeList"),
  main: $("main"),
  gridTitle: $("gridTitle"),
  grid: $("grid"),
  playingCount: $("playingCount"),
  dockList: $("dockList"),
  ambVol: $("ambVol"),
  fxVol: $("fxVol"),
  stopAllBtn: $("stopAllBtn"),
  startScreen: $("startScreen"),
  startBtn: $("startBtn"),
  resumeBtn: $("resumeBtn"),
  scenesDlg: $("scenesDlg"),
  saveSceneForm: $("saveSceneForm"),
  sceneName: $("sceneName"),
  sceneList: $("sceneList"),
  toast: $("toast"),
};

const ICONS = [
  [/aranha|spider/, "🕷️"], [/batalhas?_?sit|cidade|borderlands/, "🏰"], [/batalha|combate|battle/, "⚔️"],
  [/cavalo|horse/, "🐎"], [/chuva|rain|tempestade/, "🌧️"], [/coruja|owl/, "🦉"], [/cult|seita/, "🕯️"],
  [/drag/, "🐉"], [/dungeon|caverna|masmorra/, "🗝️"], [/floresta|forest|mata/, "🌲"], [/goblin|orc/, "👺"],
  [/lobo|wolf/, "🐺"], [/warg/, "🐕"], [/mar|ocean|navio|porto/, "🌊"], [/minotauro/, "🐂"],
  [/morto|zumbi|zombie|undead|esqueleto/, "🧟"], [/procura|busca|explora/, "🔎"], [/rato|rat/, "🐀"],
  [/ritual|magia|magic/, "🔮"], [/tensao|suspense|medo|horror/, "😰"], [/taverna|tavern/, "🍺"],
  [/fogo|fire|fogueira/, "🔥"], [/vento|wind/, "💨"], [/musica|music/, "🎶"],
];

/* ---------- utilidades ---------- */
function readJson(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch{ return fallback; }
}
function writeJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}
function clamp01(v){ v = Number(v); return Number.isNaN(v) ? 1 : Math.max(0, Math.min(1, v)); }
function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function norm(s){ return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function themeLabel(name){ return name.replace(/[_-]+/g, " ").trim(); }
function themeIcon(name){
  const n = norm(name);
  return ICONS.find(([re]) => re.test(n))?.[1] ?? "🎵";
}
function niceTitle(url){
  let file = url.split("/").pop() || "";
  try{ file = decodeURIComponent(file); }catch{}
  return file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Som";
}

let toastTimer = 0;
function toast(msg, ms = 2600){
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), ms);
}

/* ---------- estado ---------- */
let themes = [];                 // [{ name, items:[{title,file,url}] }]
let currentTheme = null;
let query = "";
let trackVol = readJson(LS_TRACKVOL, {});
let pending = new Set();         // sons recém-enviados que o GitHub Pages ainda está publicando
const byUrl = new Map();         // url -> { title, theme }
const loops = new Map();         // url -> player (ambiente em loop)
const shots = new Map();         // url -> player (efeito, toca 1×)

/* "rain_ambience.wav" -> "Rain ambience" (nomes de arquivo viram títulos legíveis) */
function fixMojibake(s){
  // nomes salvos com codificação errada: "TÃ¼bingen" -> "Tübingen"
  if (!/[ÃÂ]/.test(s)) return s;
  try{ return decodeURIComponent(escape(s)); }catch{ return s; }
}
function displayTitle(title){
  const t = fixMojibake(String(title)).replace(/\.(wav|flac|aiff?|mp3|ogg|m4a)$/i, "").replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const titleOf = (url) => displayTitle(byUrl.get(url)?.title ?? niceTitle(url));

/* ---------- motor de áudio ---------- */
let ctx = null, ambBus = null, fxBus = null;

function ensureAudio(){
  if (!ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    ambBus = ctx.createGain();
    fxBus = ctx.createGain();
    ambBus.gain.value = clamp01(els.ambVol.value);
    fxBus.gain.value = clamp01(els.fxVol.value);
    ambBus.connect(ctx.destination);
    fxBus.connect(ctx.destination);
  }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
}

function ramp(param, value, secs){
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(value, t + secs);
}

function getVol(url){
  const v = trackVol[url];
  return typeof v === "number" ? clamp01(v) : 1;
}
function setVol(url, v){
  trackVol[url] = clamp01(v);
  writeJson(LS_TRACKVOL, trackVol);
  for (const p of [loops.get(url), shots.get(url)]){
    if (p) ramp(p.gain.gain, trackVol[url], 0.05);
  }
  saveLastScene();
}
function applyMasterVolumes(){
  if (!ctx) return;
  ramp(ambBus.gain, clamp01(els.ambVol.value), 0.05);
  ramp(fxBus.gain, clamp01(els.fxVol.value), 0.05);
}

function createPlayer(url, loop){
  ensureAudio();
  const el = new Audio();
  el.preload = "auto";
  el.loop = loop;
  el.src = url;
  const source = ctx.createMediaElementSource(el);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(loop ? ambBus : fxBus);
  return { url, el, source, gain };
}
function disposePlayer(p){
  p.el.pause();
  try{ p.source.disconnect(); p.gain.disconnect(); }catch{}
  // libera a memória do arquivo (importante no iPad com muitos sons)
  p.el.removeAttribute("src");
  p.el.load();
}
function failed(map, p){
  if (map.get(p.url) !== p) return;   // já foi parado/substituído
  map.delete(p.url);
  disposePlayer(p);
  toast(`Não foi possível tocar “${titleOf(p.url)}”.`);
  changed();
}

function startLoop(url){
  if (loops.has(url)) return;
  const p = createPlayer(url, true);
  loops.set(url, p);
  p.el.addEventListener("error", () => failed(loops, p));
  p.el.play()
    .then(() => { if (loops.get(url) === p) ramp(p.gain.gain, getVol(url), FADE_IN); })
    .catch(() => failed(loops, p));
}
function stopLoop(url, fade = FADE_OUT){
  const p = loops.get(url);
  if (!p) return;
  loops.delete(url);
  ramp(p.gain.gain, 0, fade);
  setTimeout(() => disposePlayer(p), fade * 1000 + 100);
}
function toggleLoop(url){
  if (loops.has(url)) stopLoop(url);
  else startLoop(url);
  changed();
}

function playShot(url){
  const existing = shots.get(url);
  if (existing){
    existing.el.currentTime = 0;
    existing.el.play().catch(() => {});
    return;
  }
  const p = createPlayer(url, false);
  p.gain.gain.value = getVol(url);
  shots.set(url, p);
  p.el.addEventListener("ended", () => {
    if (shots.get(url) !== p) return;
    shots.delete(url);
    disposePlayer(p);
    changed();
  });
  p.el.addEventListener("timeupdate", () => updateProgress(url, p));
  p.el.addEventListener("error", () => failed(shots, p));
  p.el.play().catch(() => failed(shots, p));
  changed();
}
function stopShot(url){
  const p = shots.get(url);
  if (!p) return;
  shots.delete(url);
  disposePlayer(p);
}

function stopAll(){
  for (const url of [...loops.keys()]) stopLoop(url);
  for (const url of [...shots.keys()]) stopShot(url);
  changed();
}

/* mantém a tela do iPad acesa enquanto houver som tocando */
let wakeLock = null;
async function syncWakeLock(){
  const want = loops.size > 0 || shots.size > 0;
  try{
    if (want && !wakeLock && navigator.wakeLock && document.visibilityState === "visible"){
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }else if (!want && wakeLock){
      await wakeLock.release();
      wakeLock = null;
    }
  }catch{}
}

/* ---------- cenas ---------- */
function currentScene(){
  return {
    ambientVol: clamp01(els.ambVol.value),
    fxVol: clamp01(els.fxVol.value),
    ambients: [...loops.keys()],
    fx: [],
    trackVol,
  };
}
function saveLastScene(){
  writeJson(LS_LAST, { scene: currentScene(), lastThemeName: currentTheme });
}

function applyScene(scene){
  ensureAudio();
  if (scene.trackVol && typeof scene.trackVol === "object"){
    trackVol = { ...scene.trackVol };
    writeJson(LS_TRACKVOL, trackVol);
  }
  if (scene.ambientVol != null) els.ambVol.value = clamp01(scene.ambientVol);
  if (scene.fxVol != null) els.fxVol.value = clamp01(scene.fxVol);
  applyMasterVolumes();

  // transição suave: o que sai some devagar, o que fica ajusta o volume, o que entra aparece
  const want = new Set(scene.ambients || []);
  for (const url of [...loops.keys()]){
    if (!want.has(url)) stopLoop(url, SCENE_FADE);
  }
  for (const url of want){
    const p = loops.get(url);
    if (p) ramp(p.gain.gain, getVol(url), 0.3);
    else startLoop(url);
  }
  for (const url of scene.fx || []) playShot(url);   // sets antigos guardavam efeitos
  changed();
}

function readSets(){
  const data = readJson(LS_SETS, { sets: [] });
  return Array.isArray(data?.sets) ? data.sets : [];
}
function writeSets(sets){ writeJson(LS_SETS, { sets }); }

function renderScenes(){
  const sets = readSets();
  els.sceneList.innerHTML = "";
  if (sets.length === 0){
    els.sceneList.innerHTML = `<div class="empty">Nenhuma cena salva ainda.<br>Toque alguns sons e salve aqui.</div>`;
    return;
  }
  for (const s of sets){
    const n = s.scene?.ambients?.length || 0;
    const row = document.createElement("div");
    row.className = "sceneItem";
    row.innerHTML = `
      <button class="sceneApply" type="button"><b>${escapeHtml(s.name)}</b><span>${n} ${n === 1 ? "som" : "sons"}</span></button>
      <button class="btn danger sceneDel" type="button" aria-label="Excluir cena">🗑</button>`;
    row.querySelector(".sceneApply").addEventListener("click", () => {
      applyScene(s.scene || {});
      els.scenesDlg.close();
      toast(`🎬 ${s.name}`);
    });
    row.querySelector(".sceneDel").addEventListener("click", () => {
      if (!confirm(`Excluir a cena “${s.name}”?`)) return;
      writeSets(readSets().filter(x => x.id !== s.id));
      renderScenes();
    });
    els.sceneList.appendChild(row);
  }
}

function saveScene(e){
  e.preventDefault();
  const name = els.sceneName.value.trim();
  if (!name){ els.sceneName.focus(); return; }
  if (loops.size === 0){ toast("Toque alguns sons em loop antes de salvar a cena."); return; }

  const sets = readSets();
  const scene = JSON.parse(JSON.stringify(currentScene()));
  const existing = sets.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (existing){
    if (!confirm(`Já existe “${existing.name}”. Substituir?`)) return;
    existing.scene = scene;
  }else{
    sets.push({ id: Math.random().toString(16).slice(2) + Date.now().toString(16), name, scene });
  }
  writeSets(sets);
  els.sceneName.value = "";
  renderScenes();
  toast("Cena salva ✓");
}

/* ---------- interface ---------- */
function changed(){
  updateTiles();
  renderDock();
  renderThemeList();
  saveLastScene();
  syncWakeLock();
}

function playingThemes(){
  const set = new Set();
  for (const url of [...loops.keys(), ...shots.keys()]){
    const t = byUrl.get(url)?.theme;
    if (t) set.add(t);
  }
  return set;
}

function renderThemeList(){
  const live = playingThemes();
  els.themeList.innerHTML = "";
  for (const t of themes){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "themeBtn" + (!query && t.name === currentTheme ? " active" : "");
    btn.innerHTML = `
      <span class="themeIcon">${themeIcon(t.name)}</span>
      <span class="themeName">${escapeHtml(themeLabel(t.name))}</span>
      ${live.has(t.name) ? `<span class="liveDot" title="Tocando"></span>` : ""}
      <span class="themeCount">${t.items.length}</span>`;
    btn.addEventListener("click", () => openTheme(t.name));
    els.themeList.appendChild(btn);
  }
}

function openTheme(name){
  currentTheme = name;
  query = "";
  els.search.value = "";
  renderThemeList();
  renderGrid();
  els.main.scrollTop = 0;
  saveLastScene();
}

function renderGrid(){
  let list = [];
  const showTheme = Boolean(query);

  if (query){
    const q = norm(query);
    for (const t of themes){
      for (const it of t.items){
        if (norm(it.title).includes(q) || norm(themeLabel(t.name)).includes(q)) list.push([it, t.name]);
      }
    }
    els.gridTitle.textContent = `🔎 “${query}” · ${list.length}`;
  }else{
    const t = themes.find(x => x.name === currentTheme);
    if (t){
      list = t.items.map(it => [it, t.name]);
      els.gridTitle.textContent = `${themeIcon(t.name)} ${themeLabel(t.name)}`;
    }else{
      els.gridTitle.textContent = themes.length ? "Escolha um tema" : "Nenhum som ainda";
    }
  }

  els.grid.innerHTML = "";
  if (list.length === 0){
    els.grid.innerHTML = `<div class="empty">${query ? "Nada encontrado." : "Nenhum som aqui. Use ＋ Sons para adicionar."}</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const [it, themeName] of list){
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.url = it.url;
    tile.setAttribute("role", "button");
    tile.innerHTML = `
      <div class="tileTop">
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
        ${showTheme ? `<span class="tileTheme">${themeIcon(themeName)} ${escapeHtml(themeLabel(themeName))}</span>` : ""}
      </div>
      <div class="tileName">${escapeHtml(displayTitle(it.title))}</div>
      <button class="once" type="button" aria-label="Tocar uma vez">1×</button>
      <div class="prog"><span></span></div>`;
    tile.addEventListener("click", () => toggleLoop(it.url));
    tile.querySelector(".once").addEventListener("click", (e) => {
      e.stopPropagation();
      playShot(it.url);
    });
    frag.appendChild(tile);
  }
  els.grid.appendChild(frag);
  updateTiles();
}

function updateTiles(){
  for (const tile of els.grid.querySelectorAll(".tile")){
    const url = tile.dataset.url;
    tile.classList.toggle("on", loops.has(url));
    tile.classList.toggle("shot", shots.has(url));
    tile.classList.toggle("pending", pending.has(url));
    if (!shots.has(url)) tile.querySelector(".prog span").style.width = "0";
  }
}

function updateProgress(url, p){
  const d = p.el.duration;
  if (!d || !isFinite(d)) return;
  const pct = `${Math.min(100, (p.el.currentTime / d) * 100)}%`;
  for (const bar of document.querySelectorAll(`[data-url="${CSS.escape(url)}"] .prog span`)){
    bar.style.width = pct;
  }
}

function renderDock(){
  const total = loops.size + shots.size;
  els.playingCount.textContent = String(total);
  els.dockList.innerHTML = "";

  if (total === 0){
    els.dockList.innerHTML = `<div class="dockEmpty">Nada tocando. Toque num som para começar.</div>`;
    return;
  }

  const card = (url, kind) => {
    const div = document.createElement("div");
    div.className = `dockCard ${kind}`;
    div.dataset.url = url;
    div.innerHTML = `
      <div class="dcTop">
        <span aria-hidden="true">${kind === "loop" ? "🔁" : "💥"}</span>
        <span class="dcName">${escapeHtml(titleOf(url))}</span>
        <button class="dcStop" type="button" aria-label="Parar">✕</button>
      </div>
      <input class="range" type="range" min="0" max="1" step="0.01" value="${getVol(url)}" aria-label="Volume" />
      ${kind === "shot" ? `<div class="prog"><span></span></div>` : ""}`;
    div.querySelector(".dcStop").addEventListener("click", () => {
      if (kind === "loop") stopLoop(url); else stopShot(url);
      changed();
    });
    const slider = div.querySelector(".range");
    slider.addEventListener("input", () => setVol(url, slider.value));
    return div;
  };

  for (const url of loops.keys()) els.dockList.appendChild(card(url, "loop"));
  for (const url of shots.keys()) els.dockList.appendChild(card(url, "shot"));
}

/* ---------- biblioteca ---------- */
function setLibrary(list){
  themes = (Array.isArray(list) ? list : [])
    .map(t => ({ name: String(t.name), items: Array.isArray(t.items) ? t.items : [] }))
    .filter(t => t.items.length > 0);

  byUrl.clear();
  for (const t of themes){
    for (const it of t.items) byUrl.set(it.url, { title: it.title, theme: t.name });
  }
  if (!themes.some(t => t.name === currentTheme)) currentTheme = themes[0]?.name ?? null;

  renderThemeList();
  renderGrid();
  renderDock();
}

async function fetchPlaylist(){
  const res = await fetch(`playlist.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`playlist.json ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.themes)) throw new Error("playlist.json inválido");
  return data.themes;
}

async function loadLibrary(){
  try{
    const list = await fetchPlaylist();
    writeJson(LS_CACHE, { themes: list, ts: Date.now() });
    setLibrary(list);
    return true;
  }catch{
    const cache = readJson(LS_CACHE, null);
    if (Array.isArray(cache?.themes)){
      setLibrary(cache.themes);
      toast("Sem conexão: usando a lista salva neste aparelho.");
    }else{
      els.gridTitle.textContent = "Não foi possível carregar os sons";
      els.grid.innerHTML = `<div class="empty">Verifique a internet e toque em ↻.</div>`;
    }
    return false;
  }
}

/* após um envio, espera o GitHub Pages publicar os novos arquivos */
function waitForPublish(urls){
  for (const u of urls) pending.add(u);
  updateTiles();
  let tries = 0;
  const check = async () => {
    tries++;
    try{
      const list = await fetchPlaylist();
      const published = new Set(list.flatMap(t => (t.items || []).map(i => i.url)));
      if (urls.every(u => published.has(u))){
        // o Pages publica tudo de uma vez: playlist nova = arquivos novos no ar
        for (const u of urls) pending.delete(u);
        writeJson(LS_CACHE, { themes: list, ts: Date.now() });
        setLibrary(list);
        toast("Novos sons prontos ✓");
        return;
      }
    }catch{}
    if (tries < 20) setTimeout(check, 15000);
    else{
      for (const u of urls) pending.delete(u);
      updateTiles();
    }
  };
  setTimeout(check, 20000);
}

/* ---------- início ---------- */
function start(resume){
  ensureAudio();
  els.startScreen.hidden = true;
  if (resume){
    const last = readJson(LS_LAST, null);
    if (last?.scene) applyScene({ ...last.scene, fx: [] });
  }
}

function init(){
  const last = readJson(LS_LAST, null);
  if (last?.scene){
    els.ambVol.value = clamp01(last.scene.ambientVol ?? 0.7);
    els.fxVol.value = clamp01(last.scene.fxVol ?? 0.9);
  }
  currentTheme = last?.lastThemeName ?? null;

  const lastCount = last?.scene?.ambients?.length || 0;
  if (lastCount > 0){
    els.resumeBtn.hidden = false;
    els.resumeBtn.textContent = `▶ Continuar cena anterior (${lastCount} ${lastCount === 1 ? "som" : "sons"})`;
    els.startBtn.textContent = "Começar em silêncio";
  }
  els.startBtn.addEventListener("click", () => start(false));
  els.resumeBtn.addEventListener("click", () => start(true));

  // iOS pode suspender o áudio ao trocar de app; qualquer toque reativa
  document.addEventListener("pointerdown", () => {
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncWakeLock();
  });

  els.search.addEventListener("input", () => {
    query = els.search.value.trim();
    renderThemeList();
    renderGrid();
    els.main.scrollTop = 0;
  });
  els.refreshBtn.addEventListener("click", async () => {
    if (await loadLibrary()) toast("Lista de sons atualizada ✓");
  });
  els.stopAllBtn.addEventListener("click", stopAll);
  for (const slider of [els.ambVol, els.fxVol]){
    slider.addEventListener("input", () => { applyMasterVolumes(); saveLastScene(); });
  }

  els.scenesBtn.addEventListener("click", () => { renderScenes(); els.scenesDlg.showModal(); });
  els.saveSceneForm.addEventListener("submit", saveScene);

  for (const dlg of document.querySelectorAll("dialog")){
    dlg.querySelector("[data-close]")?.addEventListener("click", () => dlg.close());
    // tocar fora da folha (no fundo escuro) fecha
    dlg.addEventListener("click", (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
  }

  initUpload({
    button: els.uploadBtn,
    getThemes: () => themes.map(t => t.name),
    getCurrentTheme: () => currentTheme,
    toast,
    onUploaded(list, urls, theme){
      setLibrary(list);
      openTheme(theme);
      waitForPublish(urls);
    },
  });

  renderDock();
  loadLibrary();
}

init();
