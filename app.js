/* Jogatina Soundboard — feito para iPad
   - Biblioteca vem do playlist.json (audio/<Grupo>/<Tema>/<Som>.mp3)
   - Sons curtos são efeitos (toque = toca 1×); longos são ambientes (toque = loop)
   - Volumes via Web Audio: no iPad o volume do <audio> é somente leitura
   - Cenas, volumes e recentes salvos no aparelho (localStorage)
*/
import { initUpload } from "./upload.js";

const FX_MAX_SECONDS = 20;   // até isso, o som é tratado como efeito
const FADE_IN = 1.2;
const FADE_OUT = 0.8;
const SCENE_FADE = 1.5;
const RECENT_MAX = 16;
const RECENT_KEY = "__recentes";

const LS_TRACKVOL = "jogatina_track_vol_v1";  // { url: 0..1 }
const LS_SETS = "jogatina_sets_v2";           // { sets:[{id,name,scene}] }
const LS_CACHE = "jogatina_library_cache_v1"; // { themes, ts }
const LS_LAST = "jogatina_last_scene_v4";     // { scene, lastThemeName }
const LS_RECENT = "jogatina_recent_v1";       // [url]
const LS_MIGRATED = "jogatina_paths_v2";      // pastas reorganizadas (renomeados.json) já aplicadas

const GROUP_ORDER = ["Ambientes", "Trilhas", "Criaturas", "Efeitos"];
const GROUP_ICONS = { Ambientes: "🌄", Trilhas: "🎻", Criaturas: "🐾", Efeitos: "💥", "": "📁" };
const THEME_ICONS = [
  [/aranha|spider/, "🕷️"], [/borderlands|cidade/, "🏰"], [/combate|espada/, "⚔️"], [/batalha|battle/, "🥁"],
  [/cavalo|horse/, "🐎"], [/chuva|tempestade|rain/, "🌧️"], [/coruja|owl/, "🦉"], [/cult|seita/, "🕯️"],
  [/drag/, "🐉"], [/caverna|masmorra|dungeon/, "🗝️"], [/floresta|campo|forest/, "🌲"], [/goblin|orc/, "👺"],
  [/lobo|wolf/, "🐺"], [/warg/, "🐕"], [/mar\b|porto|ocean|navio/, "🌊"], [/minotauro/, "🐂"],
  [/morto|zumbi|zombie|undead|esqueleto/, "🧟"], [/rato|rat/, "🐀"], [/ritua|magia|magic|infern/, "🔮"],
  [/tensao|misterio|suspense|horror|medo/, "🌫️"], [/taverna|tavern/, "🍺"], [/fogo|fire|fogueira/, "🔥"],
  [/vento|wind/, "💨"], [/musica|music|trilha/, "🎶"],
];

const $ = (id) => document.getElementById(id);
const els = {
  search: $("search"),
  scenesBtn: $("scenesBtn"),
  uploadBtn: $("uploadBtn"),
  refreshBtn: $("refreshBtn"),
  creditsBtn: $("creditsBtn"),
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
  creditsDlg: $("creditsDlg"),
  creditsList: $("creditsList"),
  toast: $("toast"),
};

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
function themeIcon(name){
  const n = norm(name);
  return THEME_ICONS.find(([re]) => re.test(n))?.[1] ?? "🎵";
}
function groupLabel(group){ return group || "Outros"; }
function themeLabel(name){ return name.replaceAll("_", " "); }
function fixMojibake(s){
  // nomes salvos com codificação errada: "TÃ¼bingen" -> "Tübingen"
  if (!/[ÃÂ]/.test(s)) return s;
  try{ return decodeURIComponent(escape(s)); }catch{ return s; }
}
function displayTitle(title){
  const t = fixMojibake(String(title)).replace(/\.(wav|flac|aiff?|mp3|ogg|m4a)$/i, "").replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1) || "Som";
}
function titleFromUrl(url){
  let file = url.split("/").pop() || "";
  try{ file = decodeURIComponent(file); }catch{}
  return displayTitle(file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
}
function formatDuration(sec){
  if (typeof sec !== "number") return "";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

let toastTimer = 0;
function toast(msg, ms = 2600){
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), ms);
}

/* ---------- estado ---------- */
let themes = [];                 // [{ key, name, group, items:[{title,file,url,duration}] }]
let currentTheme = null;         // key do tema aberto, ou RECENT_KEY
let query = "";
let trackVol = readJson(LS_TRACKVOL, {});
let recent = readJson(LS_RECENT, []);
const pending = new Set();       // sons recém-enviados que o GitHub Pages ainda está publicando
const byUrl = new Map();         // url -> { item, theme }
const loops = new Map();         // url -> player (ambiente em loop)
const shots = new Map();         // url -> player (efeito, toca 1×)

const themeKey = (group, name) => `${group}/${name}`;
const titleOf = (url) => displayTitle(byUrl.get(url)?.item.title ?? titleFromUrl(url));
function isFx(url){
  const d = byUrl.get(url)?.item.duration;
  return typeof d === "number" && d <= FX_MAX_SECONDS;
}

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

function remember(url){
  recent = [url, ...recent.filter(u => u !== url)].slice(0, RECENT_MAX);
  writeJson(LS_RECENT, recent);
  const count = els.themeList.querySelector(`[data-key="${RECENT_KEY}"] .themeCount`);
  if (count) count.textContent = String(recent.filter(u => byUrl.has(u)).length);
  else renderThemeList();   // primeira vez: aparece o item "Recentes"
}

function startLoop(url){
  if (loops.has(url)) return;
  const p = createPlayer(url, true);
  loops.set(url, p);
  remember(url);
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
  remember(url);
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

/* toque principal do card: efeito toca 1×, ambiente liga/desliga o loop */
function primaryAction(url){
  if (isFx(url)) playShot(url);
  else toggleLoop(url);
}
function secondaryAction(url){
  if (isFx(url)) toggleLoop(url);
  else playShot(url);
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
    els.sceneList.innerHTML = `<div class="empty">Nenhuma cena salva ainda.<br>Ligue alguns ambientes e salve aqui.</div>`;
    return;
  }
  for (const s of sets){
    const urls = s.scene?.ambients || [];
    const names = urls.slice(0, 3).map(titleOf).join(" · ") + (urls.length > 3 ? ` +${urls.length - 3}` : "");
    const row = document.createElement("div");
    row.className = "sceneItem";
    row.innerHTML = `
      <button class="sceneApply" type="button">
        <b>${escapeHtml(s.name)}</b>
        <span>${escapeHtml(names || "vazia")}</span>
      </button>
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
  if (loops.size === 0){ toast("Ligue alguns ambientes antes de salvar a cena."); return; }

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
  updateLiveDots();
  saveLastScene();
  syncWakeLock();
}

function playingThemeKeys(){
  const set = new Set();
  for (const url of [...loops.keys(), ...shots.keys()]){
    const t = byUrl.get(url)?.theme;
    if (t) set.add(t.key);
  }
  return set;
}

function sortedGroups(){
  const groups = [...new Set(themes.map(t => t.group))];
  const rank = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? (g ? 100 : 200) : i; };
  return groups.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "pt-BR"));
}

function themeButton(key, icon, label, count){
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "themeBtn" + (!query && key === currentTheme ? " active" : "");
  btn.dataset.key = key;
  btn.innerHTML = `
    <span class="themeIcon">${icon}</span>
    <span class="themeName">${escapeHtml(label)}</span>
    <span class="liveDot" hidden></span>
    <span class="themeCount">${count}</span>`;
  btn.addEventListener("click", () => openTheme(key));
  return btn;
}

function renderThemeList(){
  els.themeList.innerHTML = "";
  const frag = document.createDocumentFragment();

  const recentCount = recent.filter(u => byUrl.has(u)).length;
  if (recentCount){
    frag.appendChild(themeButton(RECENT_KEY, "🕘", "Recentes", recentCount));
  }
  for (const group of sortedGroups()){
    const head = document.createElement("div");
    head.className = "groupHead";
    head.textContent = `${GROUP_ICONS[group] ?? "📁"} ${groupLabel(group)}`;
    frag.appendChild(head);
    for (const t of themes.filter(x => x.group === group)){
      frag.appendChild(themeButton(t.key, themeIcon(t.name), themeLabel(t.name), t.items.length));
    }
  }
  els.themeList.appendChild(frag);
  updateLiveDots();
}

function updateLiveDots(){
  const live = playingThemeKeys();
  for (const btn of els.themeList.querySelectorAll(".themeBtn")){
    btn.querySelector(".liveDot").hidden = !live.has(btn.dataset.key);
  }
}

function openTheme(key){
  currentTheme = key;
  query = "";
  els.search.value = "";
  for (const btn of els.themeList.querySelectorAll(".themeBtn")){
    btn.classList.toggle("active", btn.dataset.key === key);
  }
  renderGrid();
  els.main.scrollTop = 0;
  saveLastScene();
}

function gridEntries(){
  if (query){
    const q = norm(query);
    const list = [];
    for (const t of themes){
      const themeHit = norm(t.name).includes(q) || norm(t.group).includes(q);
      for (const it of t.items){
        if (themeHit || norm(it.title).includes(q)) list.push(it);
      }
    }
    return { title: `🔎 “${query}”`, sub: `${list.length} ${list.length === 1 ? "som" : "sons"}`, list, showTheme: true };
  }
  if (currentTheme === RECENT_KEY){
    const list = recent.filter(u => byUrl.has(u)).map(u => byUrl.get(u).item);
    return { title: "🕘 Recentes", sub: "os últimos que você tocou", list, showTheme: true };
  }
  const t = themes.find(x => x.key === currentTheme);
  if (!t) return { title: themes.length ? "Escolha um tema" : "Nenhum som ainda", sub: "", list: [], showTheme: false };
  return { title: `${themeIcon(t.name)} ${themeLabel(t.name)}`, sub: groupLabel(t.group), list: t.items, showTheme: false };
}

function renderGrid(){
  const { title, sub, list, showTheme } = gridEntries();
  els.gridTitle.innerHTML = `${escapeHtml(title)}${sub ? ` <small>${escapeHtml(sub)}</small>` : ""}`;

  els.grid.innerHTML = "";
  if (list.length === 0){
    els.grid.innerHTML = `<div class="empty">${query ? "Nada encontrado." : "Nenhum som aqui. Use ＋ Sons para adicionar."}</div>`;
    return;
  }

  // num tema, efeitos primeiro (ficam à mão), depois ambientes/trilhas
  const ordered = showTheme ? list : [...list.filter(it => isFx(it.url)), ...list.filter(it => !isFx(it.url))];

  const frag = document.createDocumentFragment();
  for (const it of ordered){
    const fx = isFx(it.url);
    const theme = byUrl.get(it.url)?.theme;
    const tile = document.createElement("div");
    tile.className = `tile ${fx ? "fx" : "loop"}`;
    tile.dataset.url = it.url;
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", `${displayTitle(it.title)} (${fx ? "efeito" : "ambiente"})`);
    tile.innerHTML = `
      <div class="tileTop">
        <span class="kind">${fx ? "💥 Efeito" : "🔁 Ambiente"}</span>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <div class="tileName">${escapeHtml(displayTitle(it.title))}</div>
      <div class="tileMeta">
        ${showTheme && theme ? `<span class="tileTheme">${themeIcon(theme.name)} ${escapeHtml(themeLabel(theme.name))}</span>` : ""}
        <span class="tileDur">${formatDuration(it.duration)}</span>
      </div>
      <button class="alt" type="button" aria-label="${fx ? "Tocar em loop" : "Tocar uma vez"}" title="${fx ? "Tocar em loop" : "Tocar uma vez"}">${fx ? "🔁" : "1×"}</button>
      <div class="prog"><span></span></div>`;
    tile.addEventListener("click", () => primaryAction(it.url));
    tile.querySelector(".alt").addEventListener("click", (e) => {
      e.stopPropagation();
      secondaryAction(it.url);
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
    const theme = byUrl.get(url)?.theme;
    const div = document.createElement("div");
    div.className = `dockCard ${kind}`;
    div.dataset.url = url;
    div.innerHTML = `
      <div class="dcTop">
        <span class="dcIcon" aria-hidden="true">${theme ? themeIcon(theme.name) : (kind === "loop" ? "🔁" : "💥")}</span>
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

/* ---------- créditos ---------- */
function licenseLabel(url){
  if (!url) return "";
  if (/publicdomain\/zero/.test(url)) return "CC0";
  const m = url.match(/licenses\/([a-z-]+)\/([\d.]+)/);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : "licença";
}
async function showCredits(){
  els.creditsDlg.showModal();
  if (els.creditsList.dataset.loaded) return;
  els.creditsList.innerHTML = `<div class="muted">Carregando…</div>`;
  try{
    const res = await fetch(`credits.json?t=${Date.now()}`, { cache: "no-store" });
    const list = await res.json();
    list.sort((a, b) => titleOf(a.file).localeCompare(titleOf(b.file), "pt-BR"));
    els.creditsList.innerHTML = list.map(c => `
      <div class="credit">
        <div><b>${escapeHtml(titleOf(c.file))}</b>${c.title ? ` <span class="muted">· ${escapeHtml(fixMojibake(c.title))}</span>` : ""}</div>
        <div class="muted small">
          ${c.author ? `por ${escapeHtml(c.author)} · ` : ""}${c.license ? `<a href="${escapeHtml(c.license)}" target="_blank" rel="noopener">${licenseLabel(c.license)}</a> · ` : ""}<a href="${escapeHtml(c.source)}" target="_blank" rel="noopener">fonte</a>
        </div>
      </div>`).join("");
    els.creditsList.dataset.loaded = "1";
  }catch{
    els.creditsList.innerHTML = `<div class="muted">Não foi possível carregar os créditos.</div>`;
  }
}

/* ---------- biblioteca ---------- */
function setLibrary(list){
  themes = (Array.isArray(list) ? list : [])
    .map(t => ({
      name: String(t.name),
      group: String(t.group ?? ""),
      items: Array.isArray(t.items) ? t.items : [],
    }))
    .filter(t => t.items.length > 0)
    .map(t => ({ ...t, key: themeKey(t.group, t.name) }));

  byUrl.clear();
  for (const t of themes){
    for (const it of t.items) byUrl.set(it.url, { item: it, theme: t });
  }
  const valid = currentTheme === RECENT_KEY ? recent.some(u => byUrl.has(u)) : themes.some(t => t.key === currentTheme);
  if (!valid) currentTheme = themes[0]?.key ?? null;

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

/* as pastas foram reorganizadas: atualiza volumes, cenas e recentes salvos no aparelho */
async function migrateSavedPaths(){
  if (localStorage.getItem(LS_MIGRATED)) return;
  const hasData = [LS_TRACKVOL, LS_SETS, LS_LAST, LS_RECENT].some(k => localStorage.getItem(k));
  if (hasData){
    try{
      const res = await fetch("renomeados.json", { cache: "no-store" });
      if (!res.ok) return;
      const map = await res.json();
      const fix = (u) => map[String(u).normalize("NFC")] ?? map[u] ?? u;
      const fixVols = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([u, v]) => [fix(u), v]));
      const fixScene = (sc) => sc && ({ ...sc,
        ambients: (sc.ambients || []).map(fix),
        fx: (sc.fx || []).map(fix),
        trackVol: fixVols(sc.trackVol),
      });

      trackVol = fixVols(trackVol);
      writeJson(LS_TRACKVOL, trackVol);
      writeSets(readSets().map(s => ({ ...s, scene: fixScene(s.scene) })));
      const last = readJson(LS_LAST, null);
      if (last?.scene) writeJson(LS_LAST, { ...last, scene: fixScene(last.scene), lastThemeName: null });
      recent = [...new Set(recent.map(fix))];
      writeJson(LS_RECENT, recent);
    }catch{ return; }
  }
  try{ localStorage.setItem(LS_MIGRATED, "1"); }catch{}
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

async function init(){
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
    for (const btn of els.themeList.querySelectorAll(".themeBtn")){
      btn.classList.toggle("active", !query && btn.dataset.key === currentTheme);
    }
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
  els.creditsBtn.addEventListener("click", showCredits);

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
    getThemes: () => themes.map(t => ({ group: t.group, name: t.name, key: t.key })),
    getGroups: () => sortedGroups().filter(Boolean),
    getCurrentTheme: () => currentTheme,
    toast,
    onUploaded(list, urls, key){
      setLibrary(list);
      openTheme(key);
      waitForPublish(urls);
    },
  });

  renderDock();

  // dados salvos no aparelho (com caminhos atualizados para as pastas novas)
  await migrateSavedPaths();
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

  await loadLibrary();
}

init();
