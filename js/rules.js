/* Regras puras (sem DOM), testadas em tests/*.test.mjs:
   - playlist: mesmas regras do ferramentas/gerar_playlist.py
   - nomes de arquivo e destino (grupo/tema) dos envios
   - hash de blob do git (detecta som repetido sem reenviar)
   - manter credits.json / cenas.json consistentes ao mover/remover sons */

export const AUDIO_DIR = "audio";
export const EXT_OK = [".mp3", ".wav", ".ogg", ".m4a", ".mpeg"];
export const MAX_BYTES = 95 * 1024 * 1024;   // limite do GitHub é 100 MB por arquivo

/* ---------- playlist ---------- */
export const niceTitle = (fileName) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
export const sortKey = (text) => String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const stem = (name) => name.replace(/\.[^.]+$/, "");
export function compare(a, b){
  for (let i = 0; i < a.length; i++){
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}
export const roundDuration = (seconds) => Math.round(seconds * 10) / 10;

export function themeDir(group, name){
  return [AUDIO_DIR, group, ...String(name).split(" / ")].filter(Boolean).join("/");
}
export function findTheme(playlist, group, name){
  return playlist.themes.find(t => (t.group ?? "") === group && t.name === name);
}
export function ensureTheme(playlist, group, name){
  let entry = findTheme(playlist, group, name);
  if (!entry){
    entry = { name, group, count: 0, items: [] };
    playlist.themes.push(entry);
  }
  return entry;
}
export function locate(playlist, url){
  for (const t of playlist.themes){
    const i = t.items.findIndex(it => it.url === url);
    if (i >= 0) return { theme: t, index: i, item: t.items[i] };
  }
  return null;
}
export function normalizePlaylist(playlist){
  playlist.themes = playlist.themes.filter(t => t.items.length > 0);
  for (const t of playlist.themes){
    t.items.sort((a, b) => compare([sortKey(stem(a.file)), sortKey(a.file)], [sortKey(stem(b.file)), sortKey(b.file)]));
    t.count = t.items.length;
  }
  playlist.themes.sort((a, b) => compare([sortKey(a.group ?? ""), sortKey(a.name)], [sortKey(b.group ?? ""), sortKey(b.name)]));
  return playlist;
}
/* item novo na playlist (local, para a interface mostrar na hora) */
export function makeItem(path, duration){
  const file = path.split("/").pop();
  const item = { title: niceTitle(file), file, url: path };
  if (duration != null) item.duration = duration;
  return item;
}

/* ---------- nomes de arquivo ---------- */
export function cleanName(name){
  return String(name).normalize("NFC")
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, "_")   // # e % quebram URLs relativas
    .replace(/\s+/g, " ")
    .trim();
}
export function extOf(name){
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}
export function cleanFileName(name){
  const clean = cleanName(name);
  const ext = extOf(clean);
  const base = clean.slice(0, clean.length - ext.length).trim() || "som";
  return base.slice(0, 100) + ext;
}
export function uniqueName(name, taken){
  const ext = extOf(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name, n = 2;
  while (taken.has(candidate.toLowerCase())) candidate = `${base} (${n++})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
export const validName = (s) => Boolean(s) && !/^\.+$/.test(s);
export const isAudioName = (name) => EXT_OK.includes(extOf(name));

/* destino de um arquivo enviado: pastas viram grupo/tema
   "Taverna/x.mp3"            -> { grupo escolhido, "Taverna" }
   "Ambientes/Taverna/x.mp3"  -> { "Ambientes", "Taverna" }
   "audio/Ambientes/Taverna/x.mp3" -> idem (ignora a pasta audio)
   "x.mp3"                    -> tema escolhido */
export function destinationFor(relPath, fallback){
  const parts = String(relPath).split("/").map(cleanName).filter(Boolean);
  let dirs = parts.slice(0, -1);
  if (dirs[0]?.toLowerCase() === AUDIO_DIR) dirs = dirs.slice(1);
  if (dirs.length >= 2) return { group: dirs[0], name: dirs.slice(1).join(" / ") };
  if (dirs.length === 1) return { group: fallback.group, name: dirs[0] };
  return { group: fallback.group, name: fallback.name };
}

/* ---------- hash de blob do git: sha1("blob <tamanho>\0" + bytes) ---------- */
export async function gitBlobSha(bytes){
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = new TextEncoder().encode(`blob ${data.length}\0`);
  const all = new Uint8Array(header.length + data.length);
  all.set(header, 0);
  all.set(data, header.length);
  const digest = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes){
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) bin += String.fromCharCode(...data.subarray(i, i + CHUNK));
  return btoa(bin);
}

/* ---------- consistência de credits.json / cenas.json ---------- */
export function fixCredits(credits, oldUrl, newUrl){
  if (!Array.isArray(credits)) return false;
  let changed = false;
  for (let i = credits.length - 1; i >= 0; i--){
    if (credits[i].file !== oldUrl) continue;
    changed = true;
    if (newUrl) credits[i].file = newUrl; else credits.splice(i, 1);
  }
  return changed;
}
export function fixScenes(data, oldUrl, newUrl){
  if (!Array.isArray(data?.scenes)) return false;
  let changed = false;
  for (const s of data.scenes){
    const before = JSON.stringify(s);
    s.ambients = (s.ambients || []).flatMap(u => u === oldUrl ? (newUrl ? [newUrl] : []) : [u]);
    s.spots = (s.spots || []).flatMap(x => x.url === oldUrl ? (newUrl ? [{ ...x, url: newUrl }] : []) : [x]);
    if (s.trackVol && oldUrl in s.trackVol){
      if (newUrl) s.trackVol[newUrl] = s.trackVol[oldUrl];
      delete s.trackVol[oldUrl];
    }
    if (JSON.stringify(s) !== before) changed = true;
  }
  return changed;
}

/* biblioteca a partir da árvore do git (quando o playlist.json ainda não foi gerado) */
export function playlistFromPaths(paths){
  const playlist = { themes: [] };
  for (const path of paths){
    if (!path.startsWith(AUDIO_DIR + "/") || !isAudioName(path)) continue;
    const dirs = path.split("/").slice(1, -1);
    const [group, name] = dirs.length === 0 ? ["", "Outros"] : dirs.length === 1 ? ["", dirs[0]] : [dirs[0], dirs.slice(1).join(" / ")];
    ensureTheme(playlist, group, name).items.push(makeItem(path));
  }
  return normalizePlaylist(playlist);
}
