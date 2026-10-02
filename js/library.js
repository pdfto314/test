/* Biblioteca de sons (playlist.json), favoritos, recentes e créditos */
import { LS, readJson, writeJson, displayTitle, titleFromUrl, groupStyle } from "./util.js";
import { playlistFromPaths } from "./rules.js";
import { owner, repo, BRANCH } from "./github.js";

export const FX_MAX_SECONDS = 20;   // até isso, o som é tratado como efeito (toca 1×)
const RECENT_MAX = 18;

export const lib = {
  themes: [],          // [{ key, name, group, items:[{title,file,url,duration}] }]
  byUrl: new Map(),    // url -> { item, theme }
};

export const themeKey = (group, name) => `${group}/${name}`;

export function setLibrary(list){
  lib.themes = (Array.isArray(list) ? list : [])
    .map(t => ({ name: String(t.name), group: String(t.group ?? ""), items: Array.isArray(t.items) ? t.items : [] }))
    .filter(t => t.items.length > 0)
    .map(t => ({ ...t, key: themeKey(t.group, t.name) }));
  lib.byUrl.clear();
  for (const t of lib.themes){
    for (const it of t.items) lib.byUrl.set(it.url, { item: it, theme: t });
  }
}

export const themeOf = (url) => lib.byUrl.get(url)?.theme ?? null;
export const itemOf = (url) => lib.byUrl.get(url)?.item ?? null;
export const titleOf = (url) => displayTitle(itemOf(url)?.title ?? titleFromUrl(url));
export const hasSound = (url) => lib.byUrl.has(url);

export function isFx(url){
  const d = itemOf(url)?.duration;
  return typeof d === "number" && d <= FX_MAX_SECONDS;
}
export const isMusic = (url) => themeOf(url)?.group === "Trilhas";

export function sortedGroups(){
  const groups = [...new Set(lib.themes.map(t => t.group))];
  return groups.sort((a, b) => groupStyle(a).order - groupStyle(b).order || a.localeCompare(b, "pt-BR"));
}
export const themesOfGroup = (group) => lib.themes.filter(t => t.group === group);
export const totalSounds = () => lib.byUrl.size;

/* playlist.json é gerado no deploy (GitHub Action). Se ainda não existir no site,
   monta a lista direto da árvore do repositório (sem durações). */
export async function fetchPlaylist(){
  const res = await fetch(`playlist.json?t=${Date.now()}`, { cache: "no-store" });
  if (res.ok){
    const data = await res.json();
    if (!Array.isArray(data?.themes)) throw new Error("playlist.json inválido");
    return data.themes;
  }
  if (res.status !== 404) throw new Error(`playlist.json ${res.status}`);
  const tree = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${BRANCH}?recursive=1`, { cache: "no-store" });
  if (!tree.ok) throw new Error(`árvore do repositório ${tree.status}`);
  const data = await tree.json();
  return playlistFromPaths((data.tree || []).filter(e => e.type === "blob").map(e => e.path)).themes;
}

/* ---------- favoritos e recentes ---------- */
export let favs = readJson(LS.favs, []);
export let recent = readJson(LS.recent, []);

export const isFav = (url) => favs.includes(url);
export function toggleFav(url){
  favs = isFav(url) ? favs.filter(u => u !== url) : [url, ...favs];
  writeJson(LS.favs, favs);
  return isFav(url);
}
export function remember(url){
  recent = [url, ...recent.filter(u => u !== url)].slice(0, RECENT_MAX);
  writeJson(LS.recent, recent);
}
export function replaceUrlLists(fix){
  favs = [...new Set(favs.map(fix))];
  recent = [...new Set(recent.map(fix))];
  writeJson(LS.favs, favs);
  writeJson(LS.recent, recent);
}
export function dropUrl(url){
  favs = favs.filter(u => u !== url);
  recent = recent.filter(u => u !== url);
  writeJson(LS.favs, favs);
  writeJson(LS.recent, recent);
}

/* ---------- créditos (Freesound) ---------- */
let creditsPromise = null;
export function loadCredits(force = false){
  if (!creditsPromise || force){
    creditsPromise = fetch(`credits.json?t=${Date.now()}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : [])
      .then(list => new Map((Array.isArray(list) ? list : []).map(c => [c.file, c])))
      .catch(() => new Map());
  }
  return creditsPromise;
}
export function licenseLabel(url){
  if (!url) return "";
  if (/publicdomain\/zero/.test(url)) return "CC0";
  const m = url.match(/licenses\/([a-z-]+)\/([\d.]+)/);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : "licença";
}
