/* Gerenciar a biblioteca pelo app: enviar, renomear, mover e remover sons.
   Cada ação vira um único commit com os áudios + playlist.json (e credits.json / cenas.json
   quando o som aparece neles). O playlist.json segue as mesmas regras do
   ferramentas/gerar_playlist.py, então o GitHub Action não precisa reescrevê-lo. */
import { $, escapeHtml, toast, wireDialog, displayTitle, plural } from "./util.js";
import { commit, createBlob, readRepoJson, listDir, jsonText, explainError, isConnected, renderConnect, onAuthChange } from "./github.js";

const AUDIO_DIR = "audio";
const EXT_OK = [".mp3", ".wav", ".ogg", ".m4a", ".mpeg"];
const MAX_BYTES = 95 * 1024 * 1024;   // limite do GitHub é 100 MB por arquivo

/* ---------- regras do playlist.json (iguais às do gerar_playlist.py) ---------- */
const niceTitle = (fileName) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
const sortKey = (text) => String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const stem = (name) => name.replace(/\.[^.]+$/, "");
function compare(a, b){
  for (let i = 0; i < a.length; i++){
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}
const roundDuration = (seconds) => Math.round(seconds * 10) / 10;

function themeDir(group, name){
  return [AUDIO_DIR, group, ...name.split(" / ")].filter(Boolean).join("/");
}
function findTheme(playlist, group, name){
  return playlist.themes.find(t => (t.group ?? "") === group && t.name === name);
}
function ensureTheme(playlist, group, name){
  let entry = findTheme(playlist, group, name);
  if (!entry){
    entry = { name, group, count: 0, items: [] };
    playlist.themes.push(entry);
  }
  return entry;
}
function normalizePlaylist(playlist){
  playlist.themes = playlist.themes.filter(t => t.items.length > 0);
  for (const t of playlist.themes){
    t.items.sort((a, b) => compare([sortKey(stem(a.file)), sortKey(a.file)], [sortKey(stem(b.file)), sortKey(b.file)]));
    t.count = t.items.length;
  }
  playlist.themes.sort((a, b) => compare([sortKey(a.group ?? ""), sortKey(a.name)], [sortKey(b.group ?? ""), sortKey(b.name)]));
  playlist.generated = new Date().toISOString().slice(0, 19);
  return playlist;
}
function locate(playlist, url){
  for (const t of playlist.themes){
    const i = t.items.findIndex(it => it.url === url);
    if (i >= 0) return { theme: t, index: i, item: t.items[i] };
  }
  return null;
}

/* ---------- nomes de arquivo ---------- */
function cleanName(name){
  return String(name).normalize("NFC")
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, "_")   // # e % quebram URLs relativas
    .replace(/\s+/g, " ")
    .trim();
}
function extOf(name){
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}
function cleanFileName(name){
  const clean = cleanName(name);
  const ext = extOf(clean);
  const base = clean.slice(0, clean.length - ext.length).trim() || "som";
  return base.slice(0, 100) + ext;
}
function uniqueName(name, taken){
  const ext = extOf(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name, n = 2;
  while (taken.has(candidate.toLowerCase())) candidate = `${base} (${n++})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
const validName = (s) => s && !/^\.+$/.test(s);
const formatSize = (bytes) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
function readDuration(file){
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(v); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? roundDuration(a.duration) : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    a.src = url;
  });
}

/* referências a um som em credits.json / cenas.json (para manter tudo consistente) */
function fixCredits(credits, oldUrl, newUrl){
  if (!Array.isArray(credits)) return false;
  let changed = false;
  for (let i = credits.length - 1; i >= 0; i--){
    if (credits[i].file !== oldUrl) continue;
    changed = true;
    if (newUrl) credits[i].file = newUrl; else credits.splice(i, 1);
  }
  return changed;
}
function fixScenes(data, oldUrl, newUrl){
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

/* ---------- opções de tema (selects com grupos) ---------- */
function themeOptions(themes, selectedKey, withNew){
  const groups = [...new Set(themes.map(t => t.group))];
  return groups.map(g => `
    <optgroup label="${escapeHtml(g || "Outros")}">
      ${themes.filter(t => t.group === g).map(t => `<option value="${escapeHtml(t.key)}" ${t.key === selectedKey ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
    </optgroup>`).join("") + (withNew ? `<option value="__new">➕ Novo tema…</option>` : "");
}

export function initManage({ getThemes, getGroups, getCurrentTheme, onLibraryChanged }){
  /* ======================= ENVIAR SONS ======================= */
  const dlg = $("uploadDlg");
  const connectBox = $("uploadConnect");
  const form = $("uploadForm");
  const themeSelect = $("themeSelect");
  const newThemeBox = $("newThemeBox");
  const groupSelect = $("groupSelect");
  const newGroupField = $("newGroupField");
  const newGroupInput = $("newGroupInput");
  const newThemeInput = $("newThemeInput");
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const fileList = $("fileList");
  const sendBtn = $("sendBtn");
  const statusEl = $("uploadStatus");
  wireDialog(dlg);
  renderConnect(connectBox, { compact: false });

  let files = [];
  let busy = false;

  const setStatus = (msg, kind = "") => { statusEl.textContent = msg; statusEl.className = `uploadStatus ${kind}`; };

  function showView(){
    connectBox.hidden = isConnected();
    form.hidden = !isConnected();
    if (!isConnected()) return;
    const themes = getThemes();
    const current = getCurrentTheme();
    themeSelect.innerHTML = themeOptions(themes, themes.some(t => t.key === current) ? current : themes[0]?.key, true);
    if (!themes.length) themeSelect.value = "__new";
    groupSelect.innerHTML = getGroups().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("") +
      `<option value="__new">➕ Novo grupo…</option>`;
    syncNewFields();
  }
  onAuthChange(() => { if (dlg.open) showView(); });

  function syncNewFields(){
    newThemeBox.hidden = themeSelect.value !== "__new";
    newGroupField.hidden = newThemeBox.hidden || groupSelect.value !== "__new";
  }

  function chosenTarget(){
    if (themeSelect.value !== "__new"){
      const t = getThemes().find(x => x.key === themeSelect.value);
      return t ? { group: t.group, name: t.name } : null;
    }
    const group = groupSelect.value === "__new" ? cleanName(newGroupInput.value).slice(0, 40) : groupSelect.value;
    const name = cleanName(newThemeInput.value).slice(0, 60);
    if (!validName(name) || (groupSelect.value === "__new" && !validName(group))) return null;
    return { group, name };
  }

  function renderFiles(){
    fileList.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(f.name)}</span><span>${formatSize(f.size)}</span><button type="button" class="linkBtn" aria-label="Tirar da lista">✕</button>`;
      li.querySelector("button").addEventListener("click", () => { files.splice(i, 1); renderFiles(); });
      fileList.appendChild(li);
    });
    sendBtn.disabled = busy || files.length === 0;
    sendBtn.textContent = files.length > 1 ? `Enviar ${files.length} sons` : "Enviar";
  }

  function addFiles(list){
    const rejected = [];
    for (const f of list){
      if (!EXT_OK.includes(extOf(f.name))) rejected.push(`${f.name} (formato)`);
      else if (f.size > MAX_BYTES) rejected.push(`${f.name} (muito grande)`);
      else files.push(f);
    }
    if (rejected.length) toast(`Ignorado: ${rejected.join(", ")}`, 4000);
    setStatus("");
    renderFiles();
  }

  async function send(e){
    e.preventDefault();
    if (busy || files.length === 0) return;
    const target = chosenTarget();
    if (!target){
      (newThemeInput.value.trim() ? newGroupInput : newThemeInput).focus();
      toast("Dê um nome para o tema (e para o grupo, se for novo).");
      return;
    }

    busy = true;
    renderFiles();
    try{
      // 1) sobe cada arquivo (independe do estado da branch)
      const blobs = [];
      for (const [i, f] of files.entries()){
        setStatus(`Enviando ${i + 1}/${files.length}: ${f.name}…`);
        const [content, duration] = await Promise.all([fileToBase64(f), readDuration(f)]);
        blobs.push({ name: cleanFileName(f.name), sha: await createBlob(content), duration });
      }

      // 2) um commit com os arquivos + playlist.json
      setStatus("Salvando no repositório…");
      const result = await commit(async (head) => {
        const playlist = await readRepoJson("playlist.json", head, { themes: [] });
        const entry = ensureTheme(playlist, target.group, target.name);
        const taken = new Set(entry.items.map(i => String(i.file).toLowerCase()));
        const dir = themeDir(target.group, target.name);
        const tree = [], urls = [];
        for (const b of blobs){
          const name = uniqueName(b.name, taken);
          const path = `${dir}/${name}`;
          tree.push({ path, sha: b.sha });
          const item = { title: niceTitle(name), file: name, url: path };
          if (b.duration != null) item.duration = b.duration;
          entry.items.push(item);
          urls.push(path);
        }
        normalizePlaylist(playlist);
        tree.push({ path: "playlist.json", content: jsonText(playlist) });
        const where = target.group ? `${target.group}/${target.name}` : target.name;
        const message = blobs.length === 1 ? `Adiciona som em ${where}: ${blobs[0].name}` : `Adiciona ${blobs.length} sons em ${where}`;
        return { tree, message, result: { playlist, urls } };
      });

      files = [];
      fileInput.value = "";
      newThemeInput.value = "";
      newGroupInput.value = "";
      setStatus("Enviado ✓ Os sons aparecem em ~1 minuto.", "ok");
      onLibraryChanged(result.playlist, { pending: result.urls, openKey: `${target.group}/${target.name}` });
      toast(`Enviado ✓ publicando ${plural(result.urls.length, "som", "sons")}…`, 4000);
    }catch(err){
      setStatus(`Não foi possível enviar: ${explainError(err)}.`, "err");
    }finally{
      busy = false;
      renderFiles();
    }
  }

  form.addEventListener("submit", send);
  themeSelect.addEventListener("change", () => { syncNewFields(); if (!newThemeBox.hidden) newThemeInput.focus(); });
  groupSelect.addEventListener("change", () => { syncNewFields(); if (!newGroupField.hidden) newGroupInput.focus(); });
  fileInput.addEventListener("change", () => { addFiles([...fileInput.files]); fileInput.value = ""; });
  for (const ev of ["dragenter", "dragover"]){
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
  }
  for (const ev of ["dragleave", "drop"]) dropZone.addEventListener(ev, () => dropZone.classList.remove("drag"));
  dropZone.addEventListener("drop", (e) => { e.preventDefault(); addFiles([...(e.dataTransfer?.files || [])]); });

  /* ======================= EDITAR / REMOVER ======================= */
  const editDlg = $("editDlg");
  const editForm = $("editForm");
  const editName = $("editName");
  const editTheme = $("editTheme");
  const editStatus = $("editStatus");
  const editSave = $("editSave");
  const editDelete = $("editDelete");
  wireDialog(editDlg);
  let editing = null;   // { url, file, theme }

  const setEditStatus = (msg, kind = "") => { editStatus.textContent = msg; editStatus.className = `uploadStatus ${kind}`; };
  const setEditBusy = (b) => { editSave.disabled = b; editDelete.disabled = b; };

  async function saveEdit(e){
    e.preventDefault();
    if (!editing) return;
    const newStem = cleanName(editName.value).slice(0, 100);
    if (!validName(newStem)){ editName.focus(); return; }
    const target = getThemes().find(t => t.key === editTheme.value);
    if (!target) return;
    const ext = extOf(editing.file);
    const sameTheme = target.key === editing.themeKey;
    if (sameTheme && newStem === stem(editing.file)){ editDlg.close(); return; }

    setEditBusy(true);
    setEditStatus("Salvando no repositório…");
    const oldUrl = editing.url;
    try{
      const result = await commit(async (head) => {
        const playlist = await readRepoJson("playlist.json", head, { themes: [] });
        const found = locate(playlist, oldUrl);
        if (!found) throw Object.assign(new Error("som não encontrado na playlist do repositório"), { detail: "som não encontrado na playlist do repositório" });
        const shas = await listDir(oldUrl.slice(0, oldUrl.lastIndexOf("/")), head);
        const sha = shas.get(oldUrl);
        if (!sha) throw Object.assign(new Error("arquivo não encontrado"), { detail: "arquivo não encontrado no repositório" });

        found.theme.items.splice(found.index, 1);
        const dest = ensureTheme(playlist, target.group, target.name);
        const taken = new Set(dest.items.map(i => String(i.file).toLowerCase()));
        const name = uniqueName(cleanFileName(newStem + ext), taken);
        const newUrl = `${themeDir(target.group, target.name)}/${name}`;
        const item = { title: niceTitle(name), file: name, url: newUrl };
        if (found.item.duration != null) item.duration = found.item.duration;
        dest.items.push(item);
        normalizePlaylist(playlist);

        const tree = [{ path: oldUrl, sha: null }, { path: newUrl, sha }, { path: "playlist.json", content: jsonText(playlist) }];
        const credits = await readRepoJson("credits.json", head, null);
        if (fixCredits(credits, oldUrl, newUrl)) tree.push({ path: "credits.json", content: jsonText(credits) });
        const shared = await readRepoJson("cenas.json", head, null);
        if (fixScenes(shared, oldUrl, newUrl)) tree.push({ path: "cenas.json", content: jsonText(shared) });

        const message = sameTheme ? `Renomeia som: ${editing.file} → ${name}` : `Move som para ${target.group}/${target.name}: ${name}`;
        return { tree, message, result: { playlist, newUrl, shared } };
      });
      editDlg.close();
      onLibraryChanged(result.playlist, { pending: [result.newUrl], renamed: { [oldUrl]: result.newUrl }, shared: result.shared, openKey: target.key });
      toast("Salvo ✓ publicando em ~1 minuto…", 3500);
    }catch(err){
      setEditStatus(`Não foi possível salvar: ${explainError(err)}.`, "err");
    }finally{
      setEditBusy(false);
    }
  }

  async function deleteSound(){
    if (!editing) return;
    if (!confirm(`Remover “${displayTitle(editing.title)}” do repositório? Isso apaga o arquivo para todos os aparelhos.`)) return;
    setEditBusy(true);
    setEditStatus("Removendo…");
    const url = editing.url;
    try{
      const result = await commit(async (head) => {
        const playlist = await readRepoJson("playlist.json", head, { themes: [] });
        const found = locate(playlist, url);
        if (found) found.theme.items.splice(found.index, 1);
        normalizePlaylist(playlist);
        const tree = [{ path: url, sha: null }, { path: "playlist.json", content: jsonText(playlist) }];
        const credits = await readRepoJson("credits.json", head, null);
        if (fixCredits(credits, url, null)) tree.push({ path: "credits.json", content: jsonText(credits) });
        const shared = await readRepoJson("cenas.json", head, null);
        if (fixScenes(shared, url, null)) tree.push({ path: "cenas.json", content: jsonText(shared) });
        return { tree, message: `Remove som: ${url}`, result: { playlist, shared } };
      });
      editDlg.close();
      onLibraryChanged(result.playlist, { removed: [url], shared: result.shared });
      toast("Som removido ✓");
    }catch(err){
      setEditStatus(`Não foi possível remover: ${explainError(err)}.`, "err");
    }finally{
      setEditBusy(false);
    }
  }

  editForm.addEventListener("submit", saveEdit);
  editDelete.addEventListener("click", deleteSound);

  return {
    openUpload(){
      setStatus("");
      renderFiles();
      showView();
      dlg.showModal();
    },
    openEdit({ url, file, title, themeKey }){
      editing = { url, file, title, themeKey };
      editName.value = stem(file);
      editTheme.innerHTML = themeOptions(getThemes(), themeKey, false);
      setEditStatus("");
      setEditBusy(false);
      editDlg.showModal();
    },
  };
}
