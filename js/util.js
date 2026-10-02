/* Utilidades compartilhadas: armazenamento, texto, cores/ícones dos temas, toque longo, toast */

export const $ = (id) => document.getElementById(id);

export const LS = {
  trackVol: "jogatina_track_vol_v1",   // { url: 0..1 }
  sets: "jogatina_sets_v2",            // { sets:[{id,name,icon,scene}] }  cenas deste aparelho
  cache: "jogatina_library_cache_v1",  // { themes, ts }
  last: "jogatina_last_scene_v4",      // { scene, lastThemeName }
  recent: "jogatina_recent_v1",        // [url]
  favs: "jogatina_favs_v1",            // [url]
  prefs: "jogatina_prefs_v1",          // { oneMusic }
  sharedCache: "jogatina_shared_scenes_v1",
  migrated: "jogatina_paths_v2",
  token: "jogatina_gh_token_v1",
};

export function readJson(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch{ return fallback; }
}
export function writeJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}

export function clamp01(v){ v = Number(v); return Number.isNaN(v) ? 1 : Math.max(0, Math.min(1, v)); }
export function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
export function norm(s){ return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function fixMojibake(s){
  // nomes salvos com codificação errada: "TÃ¼bingen" -> "Tübingen"
  if (!/[ÃÂ]/.test(s)) return s;
  try{ return decodeURIComponent(escape(s)); }catch{ return s; }
}
export function displayTitle(title){
  const t = fixMojibake(String(title)).replace(/\.(wav|flac|aiff?|mp3|ogg|m4a)$/i, "").replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1) || "Som";
}
export function titleFromUrl(url){
  let file = String(url).split("/").pop() || "";
  try{ file = decodeURIComponent(file); }catch{}
  return displayTitle(file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
}
export function formatDuration(sec){
  if (typeof sec !== "number") return "";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function hashString(s){
  let h = 2166136261;
  for (const ch of String(s)){ h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* números pseudoaleatórios estáveis por som (forma de onda decorativa) */
export function seeded(seed){
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1000) / 1000; };
}

/* ---------- identidade visual dos grupos e temas ---------- */
export const GROUPS = {
  Ambientes: { icon: "🌄", hue: 165, order: 0, hint: "lugares e clima" },
  Trilhas:   { icon: "🎻", hue: 265, order: 1, hint: "música e tensão" },
  Criaturas: { icon: "🐾", hue: 22,  order: 2, hint: "monstros e animais" },
  Efeitos:   { icon: "💥", hue: 205, order: 3, hint: "golpes e impactos" },
};
export function groupStyle(group){
  return GROUPS[group] ?? { icon: "📁", hue: hashString(group) % 360, order: group ? 50 : 99, hint: "" };
}
export const groupLabel = (group) => group || "Outros";

const THEME_STYLES = [
  [/aranha|spider/, "🕷️", 285], [/borderlands|cidade/, "🏰", 42], [/combate|espada/, "⚔️", 355],
  [/batalha|battle/, "🥁", 8], [/cavalo|horse/, "🐎", 28], [/chuva|tempestade|rain/, "🌧️", 212],
  [/coruja|owl/, "🦉", 38], [/cult|seita/, "🕯️", 330], [/drag/, "🐉", 12],
  [/caverna|masmorra|dungeon/, "🗝️", 32], [/floresta|campo|forest/, "🌲", 128], [/goblin|orc/, "👺", 95],
  [/lobo|wolf/, "🐺", 222], [/warg/, "🐕", 200], [/mar\b|porto|ocean|navio/, "🌊", 190],
  [/minotauro/, "🐂", 16], [/morto|zumbi|zombie|undead|esqueleto/, "🧟", 150], [/rato|rat/, "🐀", 30],
  [/ritua|magia|magic|infern/, "🔮", 292], [/tensao|misterio|suspense|horror|medo/, "🌫️", 248],
  [/taverna|tavern/, "🍺", 36], [/fogo|fire|fogueira/, "🔥", 18], [/vento|wind/, "💨", 195],
  [/musica|music|trilha/, "🎶", 265],
];
export function themeStyle(name){
  const n = norm(name);
  const hit = THEME_STYLES.find(([re]) => re.test(n));
  return hit ? { icon: hit[1], hue: hit[2] } : { icon: "🎵", hue: hashString(name) % 360 };
}
export const themeLabel = (name) => String(name).replaceAll("_", " ");

/* ---------- toast ---------- */
let toastTimer = 0;
export function toast(msg, ms = 2600){
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/* ---------- toque normal x toque longo (iPad) / clique direito (PC) ---------- */
export function attachPress(el, { tap, long }){
  let timer = 0, fired = false, x = 0, y = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    fired = false; x = e.clientX; y = e.clientY;
    cancel();
    timer = setTimeout(() => { fired = true; long(); }, 480);
  });
  el.addEventListener("pointermove", (e) => {
    if (Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > 12) cancel();
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(ev, cancel);
  el.addEventListener("click", (e) => {
    if (fired){ e.preventDefault(); fired = false; return; }
    tap(e);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    cancel();
    if (!fired){ fired = true; long(); setTimeout(() => { fired = false; }, 400); }
  });
}

/* fecha <dialog> ao tocar no fundo escuro e no botão [data-close] */
export function wireDialog(dlg){
  dlg.querySelector("[data-close]")?.addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });
}
