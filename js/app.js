/* Jogatina Soundboard — interface (feita para iPad)
   Telas: Início · tema · ⭐ favoritos · 🕘 recentes · busca
   Toque: ambiente liga/desliga loop · efeito toca 1× · segurar abre opções do som */
import {
  $, LS, readJson, writeJson, clamp01, escapeHtml, norm, plural, displayTitle, formatDuration,
  hashString, seeded, groupStyle, groupLabel, themeStyle, themeLabel, toast, attachPress, wireDialog, fixMojibake,
} from "./util.js";
import {
  lib, setLibrary, fetchPlaylist, themeOf, itemOf, titleOf, hasSound, isFx, isMusic, sortedGroups, themesOfGroup,
  totalSounds, favs, recent, isFav, toggleFav, remember, replaceUrlLists, dropUrl, loadCredits, licenseLabel,
} from "./library.js";
import * as engine from "./engine.js";
import { SPOT_FREQS } from "./engine.js";
import { allScenes, loadShared, setSharedData, fixLocalUrls, initScenes, applyScene, isActive, sceneHue, sceneSummary, onScenesChange } from "./scenes.js";
import { renderConnect, initAuthUi } from "./github.js";
import { initManage } from "./manage.js";

const VIEW_HOME = "home", VIEW_FAVS = "favs", VIEW_RECENT = "recent";
const FREQ_ORDER = ["often", "sometimes", "rare"];

const els = {
  homeBtn: $("homeBtn"), search: $("search"), scenesBtn: $("scenesBtn"), uploadBtn: $("uploadBtn"), settingsBtn: $("settingsBtn"),
  nav: $("nav"), main: $("main"),
  playingCount: $("playingCount"), dockList: $("dockList"), viz: $("viz"),
  ambVol: $("ambVol"), fxVol: $("fxVol"), stopAllBtn: $("stopAllBtn"),
  startScreen: $("startScreen"), startSub: $("startSub"), startBtn: $("startBtn"), resumeBtn: $("resumeBtn"),
  soundDlg: $("soundDlg"), settingsDlg: $("settingsDlg"), creditsDlg: $("creditsDlg"), creditsList: $("creditsList"),
  oneMusic: $("oneMusic"), libStats: $("libStats"), refreshBtn: $("refreshBtn"), creditsBtn: $("creditsBtn"),
};

let view = VIEW_HOME;
let query = "";
const pending = new Set();          // sons recém-enviados que o GitHub Pages ainda está publicando
let manage = null, scenesUi = null;

/* ======================= estado salvo ======================= */
function saveSession(){
  writeJson(LS.last, {
    scene: { ambientVol: clamp01(els.ambVol.value), fxVol: clamp01(els.fxVol.value), ...engine.currentMix(), fx: [] },
    lastThemeName: view,
  });
}
function setMasters(amb, fx){
  if (amb != null) els.ambVol.value = clamp01(amb);
  if (fx != null) els.fxVol.value = clamp01(fx);
  engine.setMasters(els.ambVol.value, els.fxVol.value);
}

/* ======================= ações de som ======================= */
function primaryAction(url){
  if (pending.has(url)) return;
  if (isFx(url)) engine.playShot(url);
  else engine.toggleLoop(url);
}
function secondaryAction(url){
  if (isFx(url)) engine.toggleLoop(url);
  else engine.playShot(url);
}
function stopEverything(url){
  engine.stopSpot(url);
  engine.stopLoop(url);
  engine.stopShot(url);
}

/* ======================= navegação ======================= */
function navButton(key, icon, label, count, hue){
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "navBtn";
  btn.dataset.key = key;
  if (hue != null) btn.style.setProperty("--h", hue);
  btn.innerHTML = `
    <span class="navIcon">${icon}</span>
    <span class="navName">${escapeHtml(label)}</span>
    <span class="liveDot" hidden></span>
    ${count != null ? `<span class="navCount">${count}</span>` : ""}`;
  btn.addEventListener("click", () => go(key));
  return btn;
}
function renderNav(){
  const frag = document.createDocumentFragment();
  frag.appendChild(navButton(VIEW_HOME, "🏠", "Início"));
  const favCount = favs.filter(hasSound).length;
  const recentCount = recent.filter(hasSound).length;
  frag.appendChild(navButton(VIEW_FAVS, "⭐", "Favoritos", favCount || null));
  if (recentCount) frag.appendChild(navButton(VIEW_RECENT, "🕘", "Recentes", recentCount));
  for (const group of sortedGroups()){
    const gs = groupStyle(group);
    const head = document.createElement("div");
    head.className = "navGroup";
    head.style.setProperty("--h", gs.hue);
    head.textContent = `${gs.icon} ${groupLabel(group)}`;
    frag.appendChild(head);
    for (const t of themesOfGroup(group)){
      const ts = themeStyle(t.name);
      frag.appendChild(navButton(t.key, ts.icon, themeLabel(t.name), t.items.length, ts.hue));
    }
  }
  els.nav.replaceChildren(frag);
  syncNav();
}
function syncNav(){
  const live = playingThemeKeys();
  for (const btn of els.nav.querySelectorAll(".navBtn")){
    btn.classList.toggle("active", !query && btn.dataset.key === view);
    const dot = btn.querySelector(".liveDot");
    if (dot) dot.hidden = !live.has(btn.dataset.key);
  }
}
function playingThemeKeys(){
  const set = new Set();
  for (const url of [...engine.loops.keys(), ...engine.shots.keys(), ...engine.spots.keys()]){
    const t = themeOf(url);
    if (t) set.add(t.key);
  }
  return set;
}

function go(key){
  view = key;
  query = "";
  els.search.value = "";
  syncNav();
  renderMain();
  els.main.scrollTo({ top: 0 });
  saveSession();
  // no modo retrato, mantém o tema escolhido visível na faixa
  els.nav.querySelector(".navBtn.active")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}

/* ======================= cards de som ======================= */
function waveBars(url, n = 22){
  const rnd = seeded(hashString(url));
  let prev = 0.5, html = "";
  for (let i = 0; i < n; i++){
    prev = Math.max(0.12, Math.min(1, prev * 0.55 + rnd() * 0.6));
    html += `<i style="height:${Math.round(prev * 100)}%;animation-delay:${(-rnd() * 1.2).toFixed(2)}s"></i>`;
  }
  return html;
}
function tileEl(it, { showTheme = false } = {}){
  const fx = isFx(it.url);
  const theme = themeOf(it.url);
  const ts = theme ? themeStyle(theme.name) : { icon: "🎵", hue: 45 };
  const tile = document.createElement("div");
  tile.className = `tile ${fx ? "fx" : "loop"}`;
  tile.dataset.url = it.url;
  tile.style.setProperty("--h", ts.hue);
  tile.setAttribute("role", "button");
  tile.tabIndex = 0;
  tile.setAttribute("aria-label", `${displayTitle(it.title)} (${fx ? "efeito" : "ambiente"})`);
  tile.innerHTML = `
    <div class="tileName">${escapeHtml(displayTitle(it.title))}</div>
    ${showTheme && theme ? `<div class="tileSub"><span>${ts.icon} ${escapeHtml(themeLabel(theme.name))}</span></div>` : ""}
    <div class="tileFoot">
      <span class="kindIcon" title="${fx ? "Efeito: toque toca uma vez" : "Ambiente: toque liga o loop"}">${fx ? "⚡" : "∞"}</span>
      <span class="flags"><span class="spotFlag" title="Aleatório">🎲</span><span class="favFlag" title="Favorito">★</span></span>
      <div class="wave" aria-hidden="true">${waveBars(it.url)}</div>
      <span class="dur">${formatDuration(it.duration)}</span>
    </div>
    <button class="alt" type="button" aria-label="${fx ? "Tocar em loop" : "Tocar uma vez"}" title="${fx ? "Tocar em loop" : "Tocar uma vez"}">${fx ? "∞" : "1×"}</button>
    <div class="prog"><span></span></div>`;
  attachPress(tile, { tap: () => primaryAction(it.url), long: () => openSoundSheet(it.url) });
  const alt = tile.querySelector(".alt");
  alt.addEventListener("pointerdown", (e) => e.stopPropagation());
  alt.addEventListener("click", (e) => { e.stopPropagation(); secondaryAction(it.url); });
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " "){ e.preventDefault(); primaryAction(it.url); }
  });
  return tile;
}
function tileGrid(items, opts){
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const it of items) grid.appendChild(tileEl(it, opts));
  return grid;
}
function syncTiles(){
  for (const tile of els.main.querySelectorAll(".tile")){
    const url = tile.dataset.url;
    tile.classList.toggle("on", engine.loops.has(url));
    tile.classList.toggle("shot", engine.shots.has(url));
    tile.classList.toggle("spot", engine.spots.has(url));
    tile.classList.toggle("fav", isFav(url));
    tile.classList.toggle("pending", pending.has(url));
    if (!engine.shots.has(url)) tile.querySelector(".prog span").style.width = "0";
  }
}
engine.onProgress((url, p) => {
  for (const bar of document.querySelectorAll(`[data-url="${CSS.escape(url)}"] .prog span`)){
    bar.style.width = `${p * 100}%`;
  }
});

/* ======================= telas ======================= */
function section(title, { hint = "", extra = "" } = {}){
  const s = document.createElement("section");
  s.className = "section";
  s.innerHTML = `<div class="sectionHead"><h2>${title}</h2>${hint ? `<span class="sectionHint">${hint}</span>` : ""}${extra}</div>`;
  return s;
}
/* esqueleto mostrado enquanto a biblioteca carrega */
function skeleton(){
  const d = document.createElement("div");
  d.className = "skeleton";
  d.innerHTML = `<div class="skLine w40"></div><div class="skLine w25"></div><div class="skGrid">${'<div class="skCard"></div>'.repeat(8)}</div>`;
  return d;
}
function greeting(){
  const h = new Date().getHours();
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
function emptyState(icon, text){
  const d = document.createElement("div");
  d.className = "empty";
  d.innerHTML = `<div class="emptyIcon">${icon}</div><div>${text}</div>`;
  return d;
}

function renderMain(){
  const frag = document.createDocumentFragment();
  if (query) renderSearch(frag);
  else if (view === VIEW_HOME) renderHome(frag);
  else if (view === VIEW_FAVS) renderList(frag, "⭐ Favoritos", favs.filter(hasSound), "Segure um som e toque em ☆ para favoritar. Seus favoritos ficam aqui, à mão.");
  else if (view === VIEW_RECENT) renderList(frag, "🕘 Recentes", recent.filter(hasSound), "Os últimos sons que você tocou aparecem aqui.");
  else renderTheme(frag);
  els.main.replaceChildren(frag);
  syncTiles();
  syncScenes();
}

function sceneCard(s){
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sceneCard";
  b.dataset.sceneId = s.id;
  b.style.setProperty("--h", sceneHue(s));
  b.innerHTML = `
    <span class="scIcon">${s.icon}</span>
    <span class="scName">${escapeHtml(s.name)}</span>
    <span class="scMeta">${escapeHtml(sceneSummary(s))}${s.shared ? "" : " · neste aparelho"}</span>
    <span class="scLive">▶ tocando</span>`;
  b.addEventListener("click", () => applyScene(s));
  return b;
}
function syncScenes(){
  const scenes = new Map(allScenes().map(s => [s.id, s]));
  for (const card of els.main.querySelectorAll(".sceneCard[data-scene-id]")){
    const s = scenes.get(card.dataset.sceneId);
    card.classList.toggle("active", Boolean(s && isActive(s)));
  }
}

function renderHome(frag){
  const scenes = allScenes().filter(s => [...s.ambients, ...s.spots.map(x => x.url)].some(hasSound));
  const hero = document.createElement("div");
  hero.className = "hero";
  hero.innerHTML = `
    <div class="heroText">
      <h1>${greeting()}, mestre.</h1>
      <p>${plural(totalSounds(), "som", "sons")} · ${plural(lib.themes.length, "tema", "temas")} · ${plural(scenes.length, "cena", "cenas")}</p>
    </div>
    <div class="heroTips">
      <span>∞ <b>toque</b> liga o ambiente</span>
      <span>⚡ efeitos tocam 1×</span>
      <span>✋ <b>segure</b> para opções</span>
    </div>`;
  frag.appendChild(hero);

  const sc = section("🎬 Cenas", { hint: "toque para trocar com transição suave", extra: `<button class="linkBtn" type="button" data-scenes>Gerenciar</button>` });
  sc.querySelector("[data-scenes]").addEventListener("click", () => scenesUi.open());
  const row = document.createElement("div");
  row.className = "sceneRow";
  for (const s of scenes) row.appendChild(sceneCard(s));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "sceneCard add";
  add.innerHTML = `<span class="scIcon">＋</span><span class="scName">Nova cena</span><span class="scMeta">salve o que está tocando</span>`;
  add.addEventListener("click", () => scenesUi.open());
  row.appendChild(add);
  sc.appendChild(row);
  frag.appendChild(sc);

  const favItems = favs.filter(hasSound).map(itemOf);
  if (favItems.length){
    const fs = section("⭐ Favoritos", { extra: `<button class="linkBtn" type="button" data-go="favs">Ver todos</button>` });
    fs.querySelector("[data-go]").addEventListener("click", () => go(VIEW_FAVS));
    fs.appendChild(tileGrid(favItems.slice(0, 8), { showTheme: true }));
    frag.appendChild(fs);
  }

  const live = playingThemeKeys();
  for (const group of sortedGroups()){
    const gs = groupStyle(group);
    const s = section(`${gs.icon} ${escapeHtml(groupLabel(group))}`, { hint: gs.hint });
    s.style.setProperty("--h", gs.hue);
    const grid = document.createElement("div");
    grid.className = "themeGrid";
    for (const t of themesOfGroup(group)){
      const ts = themeStyle(t.name);
      const fxCount = t.items.filter(it => isFx(it.url)).length;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "themeCard" + (live.has(t.key) ? " live" : "");
      card.dataset.key = t.key;
      card.style.setProperty("--h", ts.hue);
      card.innerHTML = `
        <span class="tcIcon" aria-hidden="true">${ts.icon}</span>
        <span class="tcName">${escapeHtml(themeLabel(t.name))}</span>
        <span class="tcMeta">${plural(t.items.length, "som", "sons")}${fxCount ? ` · ${plural(fxCount, "efeito", "efeitos")}` : ""}</span>
        <span class="tcLive">▶ tocando</span>`;
      card.addEventListener("click", () => go(t.key));
      grid.appendChild(card);
    }
    s.appendChild(grid);
    frag.appendChild(s);
  }
}

function renderTheme(frag){
  const t = lib.themes.find(x => x.key === view);
  if (!t){ renderHome(frag); return; }
  const ts = themeStyle(t.name);
  const fxItems = t.items.filter(it => isFx(it.url));
  const loopItems = t.items.filter(it => !isFx(it.url));

  const head = document.createElement("div");
  head.className = "themeHero";
  head.style.setProperty("--h", ts.hue);
  head.innerHTML = `
    <span class="thIcon" aria-hidden="true">${ts.icon}</span>
    <div class="thText">
      <h1>${escapeHtml(themeLabel(t.name))}</h1>
      <div class="thMeta">
        <span class="thGroup">${groupStyle(t.group).icon} ${escapeHtml(groupLabel(t.group))}</span>
        <span>${plural(t.items.length, "som", "sons")}${fxItems.length ? ` · ${plural(fxItems.length, "efeito", "efeitos")}` : ""}</span>
        <span class="thLive" hidden><b></b></span>
      </div>
    </div>
    <div class="thActions">
      ${fxItems.length > 1 ? `<button class="btn" type="button" data-random>🎲 Surpresa</button>` : ""}
      <button class="btn" type="button" data-stop-theme>■ Parar tema</button>
    </div>`;
  head.querySelector("[data-random]")?.addEventListener("click", () => {
    const pool = fxItems.filter(it => !engine.shots.has(it.url));
    const pick = (pool.length ? pool : fxItems)[Math.floor(Math.random() * (pool.length || fxItems.length))];
    engine.playShot(pick.url);
    toast(`🎲 ${displayTitle(pick.title)}`, 1800);
  });
  head.querySelector("[data-stop-theme]").addEventListener("click", () => {
    for (const it of t.items) stopEverything(it.url);
  });
  frag.appendChild(head);

  if (fxItems.length){
    const s = section("⚡ Efeitos", { hint: "toque toca uma vez · ∞ no canto põe em loop" });
    s.appendChild(tileGrid(fxItems));
    frag.appendChild(s);
  }
  if (loopItems.length){
    const s = section(loopItems.length === t.items.length ? "∞ Sons" : "∞ Ambientes e trilhas", { hint: "toque liga ou desliga o loop · 1× toca uma vez" });
    s.appendChild(tileGrid(loopItems));
    frag.appendChild(s);
  }
}

function renderList(frag, title, urls, emptyText){
  const head = document.createElement("div");
  head.className = "listHero";
  head.innerHTML = `<h1>${title}</h1><span class="muted">${plural(urls.length, "som", "sons")}</span>`;
  frag.appendChild(head);
  if (!urls.length){ frag.appendChild(emptyState(title.split(" ")[0], emptyText)); return; }
  frag.appendChild(tileGrid(urls.map(itemOf), { showTheme: true }));
}

function renderSearch(frag){
  const q = norm(query);
  const items = [];
  for (const t of lib.themes){
    const themeHit = norm(t.name).includes(q) || norm(t.group).includes(q);
    for (const it of t.items){
      if (themeHit || norm(it.title).includes(q)) items.push(it);
    }
  }
  const scenes = allScenes().filter(s => norm(s.name).includes(q));
  const head = document.createElement("div");
  head.className = "listHero";
  head.innerHTML = `<h1>🔎 “${escapeHtml(query)}”</h1><span class="muted">${plural(items.length, "som", "sons")}${scenes.length ? ` · ${plural(scenes.length, "cena", "cenas")}` : ""}</span>`;
  frag.appendChild(head);
  if (scenes.length){
    const row = document.createElement("div");
    row.className = "sceneRow";
    for (const s of scenes) row.appendChild(sceneCard(s));
    frag.appendChild(row);
  }
  if (!items.length && !scenes.length){ frag.appendChild(emptyState("🔎", "Nada encontrado.")); return; }
  if (items.length) frag.appendChild(tileGrid(items, { showTheme: true }));
}

/* ======================= painel do som (toque longo) ======================= */
let sheetUrl = null;
async function openSoundSheet(url){
  sheetUrl = url;
  renderSoundSheet();
  if (!els.soundDlg.open) els.soundDlg.showModal();
  const credits = await loadCredits();
  const c = credits.get(url);
  const box = els.soundDlg.querySelector(".shCredit");
  if (c && box && sheetUrl === url){
    box.innerHTML = `${c.author ? `por <b>${escapeHtml(c.author)}</b> · ` : ""}${c.license ? `<a href="${escapeHtml(c.license)}" target="_blank" rel="noopener">${licenseLabel(c.license)}</a> · ` : ""}<a href="${escapeHtml(c.source)}" target="_blank" rel="noopener">Freesound</a>${c.title ? ` · <span class="muted">“${escapeHtml(fixMojibake(c.title))}”</span>` : ""}`;
  }
}
function renderSoundSheet(){
  const url = sheetUrl;
  const it = itemOf(url);
  if (!it){ els.soundDlg.close(); return; }
  const t = themeOf(url);
  const ts = themeStyle(t.name);
  const fx = isFx(url);
  const spot = engine.spots.get(url);
  els.soundDlg.style.setProperty("--h", ts.hue);
  els.soundDlg.classList.toggle("playing", engine.loops.has(url) || engine.shots.has(url));
  els.soundDlg.innerHTML = `
    <div class="shHero">
      <button class="btn icon shClose" type="button" data-close aria-label="Fechar">✕</button>
      <div class="shIcon">${ts.icon}</div>
      <div class="shTitle">${escapeHtml(displayTitle(it.title))}</div>
      <div class="shMeta">${escapeHtml(themeLabel(t.name))} · ${escapeHtml(groupLabel(t.group))} · ${formatDuration(it.duration)} · ${fx ? "⚡ efeito" : "∞ ambiente"}</div>
      <div class="wave big" aria-hidden="true">${waveBars(url, 40)}</div>
    </div>
    <div class="shBody">
      <div class="shActions">
        <button class="bigAction ${engine.loops.has(url) ? "on" : ""}" type="button" data-act="loop"><span>∞</span>${engine.loops.has(url) ? "Parar loop" : "Loop"}</button>
        <button class="bigAction ${engine.shots.has(url) ? "on" : ""}" type="button" data-act="once"><span>⚡</span>${engine.shots.has(url) ? "De novo" : "Tocar 1×"}</button>
        <button class="bigAction ${spot ? "on" : ""}" type="button" data-act="spot"><span>🎲</span>${spot ? "Parar aleatório" : "Aleatório"}</button>
      </div>
      <div class="segmented" ${spot ? "" : "hidden"}>
        ${FREQ_ORDER.map(f => `<button type="button" data-freq="${f}" class="${spot?.freq === f ? "on" : ""}">${SPOT_FREQS[f].label}<small>${SPOT_FREQS[f].range[0]}–${SPOT_FREQS[f].range[1]} s</small></button>`).join("")}
      </div>
      <p class="muted small shHint">🎲 Aleatório toca este som sozinho de tempos em tempos — ótimo para uma coruja na floresta ou passos na masmorra.</p>
      <label class="field"><span>Volume deste som</span><input class="range" type="range" min="0" max="1" step="0.01" value="${engine.getVol(url)}" data-vol /></label>
      <div class="shRow">
        <button class="btn" type="button" data-fav>${isFav(url) ? "★ Favorito" : "☆ Favoritar"}</button>
        <button class="btn" type="button" data-edit>✏️ Editar</button>
      </div>
      <div class="shCredit muted small"></div>
    </div>`;
  const q = (sel) => els.soundDlg.querySelector(sel);
  q("[data-close]").addEventListener("click", () => els.soundDlg.close());
  q('[data-act="loop"]').addEventListener("click", () => engine.toggleLoop(url));
  q('[data-act="once"]').addEventListener("click", () => engine.playShot(url));
  q('[data-act="spot"]').addEventListener("click", () => engine.toggleSpot(url, "sometimes"));
  for (const b of els.soundDlg.querySelectorAll("[data-freq]")){
    b.addEventListener("click", () => engine.setSpotFreq(url, b.dataset.freq));
  }
  q("[data-vol]").addEventListener("input", (e) => { engine.setVol(url, e.target.value); syncDockVolume(url, e.target); });
  q("[data-fav]").addEventListener("click", () => {
    toast(toggleFav(url) ? "★ Adicionado aos favoritos" : "Removido dos favoritos", 1600);
    renderSoundSheet();
    renderNav();
    if (view === VIEW_FAVS || view === VIEW_HOME) renderMain(); else syncTiles();
  });
  q("[data-edit]").addEventListener("click", () => {
    els.soundDlg.close();
    manage.openEdit({ url, file: it.file, title: it.title, themeKey: t.key });
  });
}
/* atualiza só o estado dos botões (sem recriar o painel, para não atrapalhar o slider) */
function syncSoundSheet(){
  const url = sheetUrl;
  if (!url || !itemOf(url)) return;
  const spot = engine.spots.get(url);
  els.soundDlg.classList.toggle("playing", engine.loops.has(url) || engine.shots.has(url));
  const set = (act, on, label) => {
    const b = els.soundDlg.querySelector(`[data-act="${act}"]`);
    if (!b) return;
    b.classList.toggle("on", on);
    b.lastChild.textContent = label;
  };
  set("loop", engine.loops.has(url), engine.loops.has(url) ? "Parar loop" : "Loop");
  set("once", engine.shots.has(url), engine.shots.has(url) ? "De novo" : "Tocar 1×");
  set("spot", Boolean(spot), spot ? "Parar aleatório" : "Aleatório");
  const seg = els.soundDlg.querySelector(".segmented");
  if (seg){
    seg.hidden = !spot;
    for (const b of seg.querySelectorAll("[data-freq]")) b.classList.toggle("on", spot?.freq === b.dataset.freq);
  }
}
wireDialog(els.soundDlg);
els.soundDlg.addEventListener("close", () => { sheetUrl = null; });

/* ======================= barra "Tocando" ======================= */
function dockCard(url, kind){
  const t = themeOf(url);
  const ts = t ? themeStyle(t.name) : { icon: "🎵", hue: 45 };
  const div = document.createElement("div");
  div.className = `dockCard ${kind}`;
  div.dataset.url = url;
  div.style.setProperty("--h", ts.hue);
  const spot = engine.spots.get(url);
  div.innerHTML = `
    <div class="dcTop">
      <span class="dcIcon" aria-hidden="true">${kind === "spot" ? "🎲" : ts.icon}</span>
      <button class="dcName" type="button">${escapeHtml(titleOf(url))}</button>
      <button class="dcStop" type="button" aria-label="Parar">✕</button>
    </div>
    <div class="dcBottom">
      <input class="range" type="range" min="0" max="1" step="0.01" value="${engine.getVol(url)}" aria-label="Volume" data-vol-url="${escapeHtml(url)}" />
      ${kind === "spot" ? `<button class="freqBtn" type="button" title="Frequência">${SPOT_FREQS[spot.freq].label}</button>` : ""}
    </div>
    ${kind !== "loop" ? `<div class="prog"><span></span></div>` : ""}`;
  div.querySelector(".dcStop").addEventListener("click", () => {
    if (kind === "loop") engine.stopLoop(url);
    else if (kind === "spot") engine.stopSpot(url);
    else engine.stopShot(url);
  });
  div.querySelector(".dcName").addEventListener("click", () => openSoundSheet(url));
  const slider = div.querySelector(".range");
  slider.addEventListener("input", () => { engine.setVol(url, slider.value); syncDockVolume(url, slider); });
  div.querySelector(".freqBtn")?.addEventListener("click", () => {
    const next = FREQ_ORDER[(FREQ_ORDER.indexOf(engine.spots.get(url)?.freq) + 1) % FREQ_ORDER.length];
    engine.setSpotFreq(url, next);
    toast(`🎲 ${titleOf(url)}: ${SPOT_FREQS[next].label.toLowerCase()}`, 1600);
  });
  return div;
}
function syncDockVolume(url, source){
  for (const el of document.querySelectorAll("input[data-vol-url], .soundSheet [data-vol]")){
    if (el === source) continue;
    if (el.dataset.volUrl === url || (el.hasAttribute("data-vol") && sheetUrl === url)) el.value = engine.getVol(url);
  }
  saveSession();
}
function renderDock(){
  const total = engine.activeCount();
  els.playingCount.textContent = String(total);
  const frag = document.createDocumentFragment();
  for (const url of engine.loops.keys()) frag.appendChild(dockCard(url, "loop"));
  for (const url of engine.spots.keys()) frag.appendChild(dockCard(url, "spot"));
  for (const [url, p] of engine.shots){ if (!p.fromSpot) frag.appendChild(dockCard(url, "shot")); }
  if (!total){
    const e = document.createElement("div");
    e.className = "dockEmpty";
    e.textContent = "Silêncio… toque num som ou escolha uma cena.";
    frag.appendChild(e);
  }
  els.dockList.replaceChildren(frag);
  syncDockOverflow();
  for (const [url, p] of engine.shots){
    if (p.fromSpot) for (const card of els.dockList.querySelectorAll(`.dockCard.spot[data-url="${CSS.escape(url)}"]`)) card.classList.add("ringing");
  }
}

/* sombra na borda direita quando há mais sons do que cabem na barra */
function syncDockOverflow(){
  els.dockList.classList.toggle("overflow", els.dockList.scrollWidth > els.dockList.clientWidth + 4);
}
window.addEventListener("resize", syncDockOverflow);

/* ======================= visualizador ======================= */
const viz = { raf: 0, ctx: els.viz.getContext("2d"), w: 0, h: 0 };
function sizeViz(){
  const r = els.viz.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  viz.w = Math.max(1, Math.round(r.width * dpr));
  viz.h = Math.max(1, Math.round(r.height * dpr));
  els.viz.width = viz.w;
  els.viz.height = viz.h;
}
function drawViz(){
  const c = viz.ctx;
  const levels = engine.readLevels();
  c.clearRect(0, 0, viz.w, viz.h);
  const bars = 32;
  const gap = Math.max(1, viz.w / bars * 0.28);
  const bw = viz.w / bars - gap;
  const grad = c.createLinearGradient(0, 0, viz.w, 0);
  grad.addColorStop(0, "#f2b544");
  grad.addColorStop(0.55, "#e37bd0");
  grad.addColorStop(1, "#4fd1c5");
  c.fillStyle = grad;
  let energy = 0;
  for (let i = 0; i < bars; i++){
    const v = levels ? levels[Math.min(levels.length - 1, Math.floor(i * levels.length / bars * 0.8))] / 255 : 0;
    energy += v;
    const h = Math.max(viz.h * 0.08, v * viz.h);
    const x = i * (bw + gap);
    c.globalAlpha = 0.35 + v * 0.65;
    c.beginPath();
    c.roundRect ? c.roundRect(x, viz.h - h, bw, h, bw / 2) : c.rect(x, viz.h - h, bw, h);
    c.fill();
  }
  c.globalAlpha = 1;
  const active = engine.loops.size + engine.shots.size > 0;
  if (active || energy > 0.5) viz.raf = requestAnimationFrame(drawViz);
  else viz.raf = 0;
}
function kickViz(){
  if (!viz.raf && engine.audioReady()) viz.raf = requestAnimationFrame(drawViz);
}
window.addEventListener("resize", sizeViz);

/* ======================= ciclo de mudanças ======================= */
let wakeLock = null;
async function syncWakeLock(){
  const want = engine.activeCount() > 0;
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
function syncMediaSession(){
  if (!("mediaSession" in navigator)) return;
  const names = [...engine.loops.keys(), ...engine.spots.keys()].map(titleOf);
  try{
    navigator.mediaSession.metadata = names.length ? new MediaMetadata({
      title: names.slice(0, 3).join(" · ") + (names.length > 3 ? ` +${names.length - 3}` : ""),
      artist: "Jogatina Soundboard",
      artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    }) : null;
  }catch{}
}

let recentCount = recent.filter(hasSound).length;
engine.onChange(() => {
  syncTiles();
  renderDock();
  const rc = recent.filter(hasSound).length;
  if (rc !== recentCount){ recentCount = rc; renderNav(); }   // contador de "Recentes"
  else syncNav();
  syncScenes();
  const live = playingThemeKeys();
  for (const card of els.main.querySelectorAll(".themeCard[data-key]")) card.classList.toggle("live", live.has(card.dataset.key));
  const liveEl = els.main.querySelector(".thLive");
  if (liveEl){
    const t = lib.themes.find(x => x.key === view);
    const n = t ? t.items.filter(it => engine.isPlaying(it.url)).length : 0;
    liveEl.hidden = !n;
    liveEl.firstElementChild.textContent = `● ${n} tocando`;
  }
  if (els.soundDlg.open) syncSoundSheet();
  kickViz();
  saveSession();
  syncWakeLock();
  syncMediaSession();
});
onScenesChange(() => { if (view === VIEW_HOME && !query) renderMain(); });

/* ======================= biblioteca: carregar / mudanças pelo app ======================= */
/* mantém na lista os sons enviados que o site ainda não publicou */
function withPending(list){
  if (!pending.size) return list;
  const have = new Set(list.flatMap(t => (t.items || []).map(i => i.url)));
  const missing = [...pending].filter(u => !have.has(u) && lib.byUrl.has(u));
  if (!missing.length) return list;
  const out = list.map(t => ({ ...t, items: [...(t.items || [])] }));
  for (const u of missing){
    const { item, theme } = lib.byUrl.get(u);
    let t = out.find(x => x.name === theme.name && (x.group ?? "") === theme.group);
    if (!t){ t = { name: theme.name, group: theme.group, items: [] }; out.push(t); }
    t.items.push({ ...item });
  }
  return out;
}
function applyLibrary(list){
  setLibrary(withPending(list));
  if (![VIEW_HOME, VIEW_FAVS, VIEW_RECENT].includes(view) && !lib.themes.some(t => t.key === view)) view = VIEW_HOME;
  renderNav();
  renderMain();
  renderDock();
  els.libStats.textContent = `${plural(totalSounds(), "som", "sons")} em ${plural(lib.themes.length, "tema", "temas")}`;
}
async function loadLibrary(){
  try{
    const list = await fetchPlaylist();
    writeJson(LS.cache, { themes: list, ts: Date.now() });
    applyLibrary(list);
    return true;
  }catch{
    const cache = readJson(LS.cache, null);
    if (Array.isArray(cache?.themes)){
      applyLibrary(cache.themes);
      toast("Sem conexão: usando a lista salva neste aparelho.");
    }else{
      els.main.replaceChildren(emptyState("📡", "Não foi possível carregar os sons. Verifique a internet e tente ↻ em ⚙️ Ajustes."));
    }
    return false;
  }
}

/* após enviar/renomear, espera o GitHub Pages publicar os arquivos novos */
function waitForPublish(urls){
  for (const u of urls) pending.add(u);
  syncTiles();
  let tries = 0;
  const check = async () => {
    tries++;
    try{
      const list = await fetchPlaylist();
      const published = new Set(list.flatMap(t => (t.items || []).map(i => i.url)));
      if (urls.every(u => published.has(u))){
        for (const u of urls) pending.delete(u);
        writeJson(LS.cache, { themes: list, ts: Date.now() });
        applyLibrary(list);
        toast("Biblioteca atualizada ✓");
        return;
      }
    }catch{}
    if (tries < 40) setTimeout(check, 15000);   // até ~10 min
    else{ for (const u of urls) pending.delete(u); syncTiles(); }
  };
  setTimeout(check, 20000);
}

function onLibraryChanged(playlist, { pending: newUrls = [], renamed = {}, removed = [], shared = null, openKey = null } = {}){
  const fix = (u) => removed.includes(u) ? null : (renamed[u] ?? u);
  for (const u of [...Object.keys(renamed), ...removed]) stopEverything(u);
  if (Object.keys(renamed).length || removed.length){
    const vols = {};
    for (const [u, v] of Object.entries(engine.trackVol)){ const n = fix(u); if (n) vols[n] = v; }
    engine.replaceVols(vols);
    replaceUrlLists((u) => fix(u) ?? u);
    for (const u of removed) dropUrl(u);
    fixLocalUrls(fix);
  }
  if (shared) setSharedData(shared);
  writeJson(LS.cache, { themes: playlist.themes, ts: Date.now() });
  if (openKey) view = openKey;
  applyLibrary(playlist.themes);
  if (newUrls.length) waitForPublish(newUrls);
}

/* as pastas foram reorganizadas: atualiza volumes, cenas e recentes salvos no aparelho */
async function migrateSavedPaths(){
  if (localStorage.getItem(LS.migrated)) return;
  const hasData = [LS.trackVol, LS.sets, LS.last, LS.recent].some(k => localStorage.getItem(k));
  if (hasData){
    try{
      const res = await fetch("renomeados.json", { cache: "no-store" });
      if (!res.ok) return;
      const map = await res.json();
      const fix = (u) => map[String(u).normalize("NFC")] ?? map[u] ?? u;
      engine.replaceVols(Object.fromEntries(Object.entries(engine.trackVol).map(([u, v]) => [fix(u), v])));
      fixLocalUrls(fix);
      const last = readJson(LS.last, null);
      if (last?.scene){
        last.scene.ambients = (last.scene.ambients || []).map(fix);
        writeJson(LS.last, { ...last, lastThemeName: null });
      }
      replaceUrlLists(fix);
    }catch{ return; }
  }
  try{ localStorage.setItem(LS.migrated, "1"); }catch{}
}

/* ======================= ajustes e créditos ======================= */
function openSettings(){
  els.oneMusic.checked = readJson(LS.prefs, {}).oneMusic !== false;
  els.settingsDlg.showModal();
}
els.oneMusic.addEventListener("change", () => {
  writeJson(LS.prefs, { ...readJson(LS.prefs, {}), oneMusic: els.oneMusic.checked });
});
els.refreshBtn.addEventListener("click", async () => {
  const ok = await loadLibrary();
  await loadShared();
  loadCredits(true);
  if (ok) toast("Biblioteca atualizada ✓");
});
els.creditsBtn.addEventListener("click", async () => {
  els.creditsDlg.showModal();
  if (els.creditsList.dataset.loaded) return;
  els.creditsList.innerHTML = `<div class="muted">Carregando…</div>`;
  const credits = [...(await loadCredits()).values()];
  credits.sort((a, b) => titleOf(a.file).localeCompare(titleOf(b.file), "pt-BR"));
  els.creditsList.innerHTML = credits.map(c => `
    <div class="credit">
      <div><b>${escapeHtml(titleOf(c.file))}</b>${c.title ? ` <span class="muted">· ${escapeHtml(fixMojibake(c.title))}</span>` : ""}</div>
      <div class="muted small">${c.author ? `por ${escapeHtml(c.author)} · ` : ""}${c.license ? `<a href="${escapeHtml(c.license)}" target="_blank" rel="noopener">${licenseLabel(c.license)}</a> · ` : ""}<a href="${escapeHtml(c.source)}" target="_blank" rel="noopener">fonte</a></div>
    </div>`).join("") || `<div class="muted">Nenhum crédito registrado.</div>`;
  els.creditsList.dataset.loaded = "1";
});

/* ======================= início ======================= */
function start(resume){
  engine.ensureAudio();
  engine.setMasters(els.ambVol.value, els.fxVol.value);
  els.startScreen.classList.add("leaving");
  setTimeout(() => { els.startScreen.hidden = true; }, 350);
  sizeViz();
  if (resume){
    const last = readJson(LS.last, null);
    if (last?.scene) engine.applyMix({ ambients: last.scene.ambients || [], spots: last.scene.spots || [] });
  }
}

async function init(){
  engine.configure({
    isMusic,
    titleOf,
    onError: (url) => toast(`Não foi possível tocar “${titleOf(url)}”.`),
    onRemember: (url) => remember(url),
  });

  for (const id of ["settingsDlg", "creditsDlg"]) wireDialog($(id));
  initAuthUi();
  renderConnect($("settingsConnect"));
  document.addEventListener("jogatina:open-settings", openSettings);
  scenesUi = initScenes({ setMasters });
  manage = initManage({
    getThemes: () => lib.themes.map(t => ({ group: t.group, name: t.name, key: t.key })),
    getGroups: () => sortedGroups().filter(Boolean),
    getCurrentTheme: () => view,
    getPlaylist: () => ({ themes: lib.themes.map(t => ({ name: t.name, group: t.group, count: t.items.length, items: t.items.map(i => ({ ...i })) })) }),
    openSettings,
    onLibraryChanged,
  });

  els.startBtn.addEventListener("click", () => start(false));
  els.resumeBtn.addEventListener("click", () => start(true));
  els.homeBtn.addEventListener("click", () => go(VIEW_HOME));
  els.scenesBtn.addEventListener("click", () => scenesUi.open());
  els.uploadBtn.addEventListener("click", () => manage.openUpload());
  els.settingsBtn.addEventListener("click", openSettings);
  els.stopAllBtn.addEventListener("click", () => engine.stopAll());
  for (const slider of [els.ambVol, els.fxVol]){
    slider.addEventListener("input", () => { engine.setMasters(els.ambVol.value, els.fxVol.value); saveSession(); });
  }
  els.search.addEventListener("input", () => {
    query = els.search.value.trim();
    syncNav();
    renderMain();
    els.main.scrollTo({ top: 0 });
  });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === "/" && !typing && !document.querySelector("dialog[open]")){ e.preventDefault(); els.search.focus(); }
    if (e.key === "Escape" && document.activeElement === els.search){ els.search.value = ""; els.search.dispatchEvent(new Event("input")); els.search.blur(); }
  });
  // iOS pode suspender o áudio ao trocar de app; qualquer toque reativa
  document.addEventListener("pointerdown", () => engine.resumeIfSuspended(), { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncWakeLock(); });

  renderDock();
  els.main.replaceChildren(skeleton());

  await migrateSavedPaths();
  const last = readJson(LS.last, null);
  if (last?.scene){
    els.ambVol.value = clamp01(last.scene.ambientVol ?? 0.7);
    els.fxVol.value = clamp01(last.scene.fxVol ?? 0.9);
  }
  if (typeof last?.lastThemeName === "string" && last.lastThemeName) view = last.lastThemeName;
  const lastCount = (last?.scene?.ambients?.length || 0) + (last?.scene?.spots?.length || 0);
  if (lastCount > 0){
    els.resumeBtn.hidden = false;
    els.resumeBtn.textContent = `▶ Continuar cena anterior (${plural(lastCount, "som", "sons")})`;
    els.startBtn.textContent = "Começar em silêncio";
    els.startBtn.classList.remove("primary");
  }

  await Promise.all([loadLibrary(), loadShared()]);
  els.startSub.textContent = `${plural(totalSounds(), "som", "sons")} · ${plural(lib.themes.length, "tema", "temas")} · ${plural(allScenes().length, "cena", "cenas")}`;
}

init();
