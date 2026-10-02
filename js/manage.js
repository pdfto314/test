/* Gerenciar a biblioteca direto do aparelho, pela API do GitHub (sem git, sem pull):
   - enviar arquivos ou pastas inteiras (pastas viram grupo/tema)
   - sons repetidos são detectados pelo hash do git e não são reenviados
   - renomear, mover e remover sons (credits.json e cenas.json acompanham)
   Cada ação é um único commit. O playlist.json é gerado no deploy (GitHub Action);
   aqui a interface só se atualiza localmente até o site publicar. */
import { $, escapeHtml, toast, wireDialog, displayTitle, plural } from "./util.js";
import {
  AUDIO_DIR, MAX_BYTES, themeDir, ensureTheme, locate, normalizePlaylist, makeItem, cleanName, extOf, cleanFileName,
  uniqueName, validName, isAudioName, destinationFor, gitBlobSha, bytesToBase64, roundDuration, stem, fixCredits, fixScenes,
} from "./rules.js";
import { commit, createBlob, readRepoJson, listTree, jsonText, explainError, authState, requireAuth, gh, repoPath, BRANCH } from "./github.js";

const dirOf = (p) => p.slice(0, p.lastIndexOf("/"));
const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
const formatSize = (bytes) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const destKey = (d) => `${d.group}/${d.name}`;

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

/* lê pastas soltas no "arrastar e soltar" (PC), mantendo o caminho relativo */
async function filesFromDrop(dataTransfer){
  const out = [];
  const entries = [...(dataTransfer?.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dataTransfer?.files || [])].map(file => ({ file, rel: file.name }));
  const walk = async (entry) => {
    if (entry.isFile){
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, rel: entry.fullPath.replace(/^\//, "") });
    }else if (entry.isDirectory){
      const reader = entry.createReader();
      for (;;){
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

function themeOptions(themes, selectedKey, withNew){
  const groups = [...new Set(themes.map(t => t.group))];
  return groups.map(g => `
    <optgroup label="${escapeHtml(g || "Outros")}">
      ${themes.filter(t => t.group === g).map(t => `<option value="${escapeHtml(t.key)}" ${t.key === selectedKey ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
    </optgroup>`).join("") + (withNew ? `<option value="__new">➕ Novo tema…</option>` : "");
}

const STATUS = {
  waiting: ["⏳", "na fila"], reading: ["🔎", "verificando…"], uploading: ["⬆️", "enviando…"], ready: ["✔️", "pronto"],
  done: ["✅", "enviado"], dup: ["⏭️", "já existe"], error: ["⚠️", "erro"],
};

export function initManage({ getThemes, getGroups, getCurrentTheme, getPlaylist, onLibraryChanged, openSettings }){
  /* ======================= ENVIAR ======================= */
  const dlg = $("uploadDlg");
  const needAuth = $("uploadNeedAuth");
  const form = $("uploadForm");
  const themeSelect = $("themeSelect");
  const newThemeBox = $("newThemeBox");
  const groupSelect = $("groupSelect");
  const newGroupField = $("newGroupField");
  const newGroupInput = $("newGroupInput");
  const newThemeInput = $("newThemeInput");
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const folderInput = $("folderInput");
  const folderBtn = $("folderBtn");
  const fileList = $("fileList");
  const sendBtn = $("sendBtn");
  const statusEl = $("uploadStatus");
  const bar = $("uploadBar");
  wireDialog(dlg);
  $("uploadOpenSettings").addEventListener("click", () => { dlg.close(); openSettings(); });
  if (!("webkitdirectory" in document.createElement("input"))) folderBtn.hidden = true;   // iPad: sem seleção de pasta

  let entries = [];       // { id, file, rel, status, note }
  let busy = false;
  let nextId = 1;

  const setStatus = (msg, kind = "") => { statusEl.textContent = msg; statusEl.className = `uploadStatus ${kind}`; };
  const setBar = (frac) => { bar.hidden = frac == null; bar.firstElementChild.style.width = `${Math.round((frac || 0) * 100)}%`; };

  function fillSelects(){
    const themes = getThemes();
    const current = getCurrentTheme();
    themeSelect.innerHTML = themeOptions(themes, themes.some(t => t.key === current) ? current : themes[0]?.key, true);
    if (!themes.length) themeSelect.value = "__new";
    groupSelect.innerHTML = getGroups().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("") +
      `<option value="__new">➕ Novo grupo…</option>`;
    syncNewFields();
  }
  function syncNewFields(){
    newThemeBox.hidden = themeSelect.value !== "__new";
    newGroupField.hidden = newThemeBox.hidden || groupSelect.value !== "__new";
    renderFiles();
  }

  /* tema escolhido no formulário (para arquivos soltos); null se faltar nome */
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
  const fallbackTarget = () => chosenTarget() ?? { group: groupSelect.value === "__new" ? cleanName(newGroupInput.value) : (getThemes().find(x => x.key === themeSelect.value)?.group ?? ""), name: "" };

  function renderFiles(){
    const existing = new Set(getThemes().map(t => t.key));
    const groups = new Map();
    for (const e of entries){
      const d = destinationFor(e.rel, fallbackTarget());
      const k = destKey(d);
      if (!groups.has(k)) groups.set(k, { d, items: [] });
      groups.get(k).items.push(e);
    }
    fileList.innerHTML = "";
    for (const { d, items } of groups.values()){
      const head = document.createElement("li");
      head.className = "fileGroup";
      head.innerHTML = `📁 ${escapeHtml(d.group || "Outros")} / ${escapeHtml(d.name || "(escolha o tema)")}${existing.has(destKey(d)) ? "" : ` <span class="newTag">novo</span>`}`;
      fileList.appendChild(head);
      for (const e of items){
        const [icon, label] = STATUS[e.status];
        const li = document.createElement("li");
        li.className = `fileItem ${e.status}`;
        li.innerHTML = `<span class="fiIcon">${icon}</span><span class="fiName">${escapeHtml(baseOf(e.rel))}</span><span class="fiNote">${escapeHtml(e.note || (e.status === "waiting" ? formatSize(e.file.size) : label))}</span>${busy || e.status === "done" ? "" : `<button type="button" class="linkBtn" aria-label="Tirar da lista">✕</button>`}`;
        li.querySelector("button")?.addEventListener("click", () => { entries = entries.filter(x => x !== e); renderFiles(); });
        fileList.appendChild(li);
      }
    }
    const pendingCount = entries.filter(e => e.status !== "done" && e.status !== "dup").length;
    sendBtn.disabled = busy || pendingCount === 0;
    sendBtn.textContent = busy ? "Enviando…" : pendingCount > 1 ? `Enviar ${pendingCount} sons` : "Enviar";
  }

  function addFiles(list){
    const rejected = [];
    for (const { file, rel } of list){
      if (baseOf(rel).startsWith(".")) continue;
      if (!isAudioName(file.name)){ rejected.push(`${file.name} (formato)`); continue; }
      if (file.size > MAX_BYTES){ rejected.push(`${file.name} (maior que 95 MB)`); continue; }
      if (entries.some(e => e.rel === rel && e.file.size === file.size)) continue;
      entries.push({ id: nextId++, file, rel, status: "waiting", note: "" });
    }
    if (rejected.length) toast(`Ignorado: ${rejected.slice(0, 4).join(", ")}${rejected.length > 4 ? "…" : ""}`, 4500);
    setStatus("");
    setBar(null);
    renderFiles();
  }

  async function send(e){
    e.preventDefault();
    const todo = entries.filter(x => x.status !== "done" && x.status !== "dup");
    if (busy || !todo.length) return;
    const fb = fallbackTarget();
    if (todo.some(x => !destinationFor(x.rel, fb).name)){
      newThemeInput.focus();
      toast("Escolha o tema (ou dê nome ao tema novo).");
      return;
    }
    if (!(await requireAuth())) return;

    busy = true;
    renderFiles();
    const totalBytes = todo.reduce((n, x) => n + x.file.size, 0) || 1;
    let doneBytes = 0;
    setBar(0);
    try{
      // 1) o que já existe no repositório (para pular repetidos)
      setStatus("Lendo o repositório…");
      const ref = await gh(`${repoPath}/git/ref/heads/${BRANCH}`);
      const base = await gh(`${repoPath}/git/commits/${ref.object.sha}`);
      const remoteBySha = new Map((await listTree(base.tree.sha)).filter(f => f.path.startsWith(AUDIO_DIR + "/")).map(f => [f.sha, f.path]));
      const batchShas = new Map();

      // 2) cada arquivo: hash → pula se repetido → sobe o blob
      for (const [i, x] of todo.entries()){
        x.status = "reading"; x.note = ""; renderFiles();
        setStatus(`Arquivo ${i + 1} de ${todo.length}: ${x.file.name}`);
        const bytes = new Uint8Array(await x.file.arrayBuffer());
        const sha = await gitBlobSha(bytes);
        const already = remoteBySha.get(sha) || batchShas.get(sha);
        if (already){
          x.status = "dup";
          x.note = `já existe: ${displayTitle(baseOf(already).replace(/\.[^.]+$/, ""))}`;
        }else{
          x.status = "uploading"; renderFiles();
          const [blobSha, duration] = await Promise.all([createBlob(bytesToBase64(bytes)), readDuration(x.file)]);
          x.blobSha = blobSha;
          x.duration = duration;
          x.status = "ready";
          batchShas.set(sha, x.rel);
        }
        doneBytes += x.file.size;
        setBar(doneBytes / totalBytes);
        renderFiles();
      }

      const ready = todo.filter(x => x.status === "ready");
      if (!ready.length){
        setStatus("Nada novo: todos esses sons já estão na biblioteca.", "ok");
        return;
      }

      // 3) um commit com todos os arquivos (nomes livres conferidos na versão mais nova)
      setStatus("Salvando no repositório…");
      const placed = await commit(async ({ treeSha }) => {
        const files = await listTree(treeSha);
        const takenByDir = new Map();
        const taken = (dir) => {
          if (!takenByDir.has(dir)) takenByDir.set(dir, new Set(files.filter(f => dirOf(f.path) === dir).map(f => baseOf(f.path).toLowerCase())));
          return takenByDir.get(dir);
        };
        const tree = [], out = [];
        for (const x of ready){
          const d = destinationFor(x.rel, fb);
          const dir = themeDir(d.group, d.name);
          const name = uniqueName(cleanFileName(baseOf(x.rel)), taken(dir));
          const path = `${dir}/${name}`;
          tree.push({ path, sha: x.blobSha });
          out.push({ x, d, path });
        }
        const dests = [...new Set(out.map(o => o.d.group ? `${o.d.group}/${o.d.name}` : o.d.name))];
        const message = out.length === 1 ? `Adiciona som em ${dests[0]}: ${baseOf(out[0].path)}` : `Adiciona ${out.length} sons em ${dests.join(", ")}`;
        return { tree, message, result: out };
      });

      for (const { x } of placed){ x.status = "done"; x.note = ""; }
      renderFiles();
      setBar(1);

      // 4) a interface já mostra os sons novos ("publicando…" até o site atualizar)
      const playlist = getPlaylist();
      for (const { x, d, path } of placed) ensureTheme(playlist, d.group, d.name).items.push(makeItem(path, x.duration));
      normalizePlaylist(playlist);
      const dupCount = todo.filter(x => x.status === "dup").length;
      setStatus(`Enviado ✓ ${plural(placed.length, "som novo", "sons novos")}${dupCount ? ` · ${plural(dupCount, "repetido pulado", "repetidos pulados")}` : ""}. O site publica em 1–3 min.`, "ok");
      onLibraryChanged(playlist, { pending: placed.map(p => p.path), openKey: destKey(placed[0].d) });
      toast(`⬆️ ${plural(placed.length, "som enviado", "sons enviados")} — publicando…`, 4000);
    }catch(err){
      for (const x of todo) if (x.status === "reading" || x.status === "uploading"){ x.status = "error"; x.note = "falhou"; }
      setStatus(`Não foi possível enviar: ${explainError(err)}.`, "err");
    }finally{
      busy = false;
      renderFiles();
    }
  }

  form.addEventListener("submit", send);
  themeSelect.addEventListener("change", () => { syncNewFields(); if (!newThemeBox.hidden) newThemeInput.focus(); });
  groupSelect.addEventListener("change", () => { syncNewFields(); if (!newGroupField.hidden) newGroupInput.focus(); });
  newThemeInput.addEventListener("input", renderFiles);
  newGroupInput.addEventListener("input", renderFiles);
  fileInput.addEventListener("change", () => { addFiles([...fileInput.files].map(file => ({ file, rel: file.name }))); fileInput.value = ""; });
  folderInput.addEventListener("change", () => { addFiles([...folderInput.files].map(file => ({ file, rel: file.webkitRelativePath || file.name }))); folderInput.value = ""; });
  folderBtn.addEventListener("click", (e) => { e.preventDefault(); folderInput.click(); });
  for (const ev of ["dragenter", "dragover"]){
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
  }
  for (const ev of ["dragleave", "drop"]) dropZone.addEventListener(ev, () => dropZone.classList.remove("drag"));
  dropZone.addEventListener("drop", async (e) => { e.preventDefault(); addFiles(await filesFromDrop(e.dataTransfer)); });

  /* ======================= EDITAR / REMOVER ======================= */
  const editDlg = $("editDlg");
  const editForm = $("editForm");
  const editName = $("editName");
  const editTheme = $("editTheme");
  const editStatus = $("editStatus");
  const editSave = $("editSave");
  const editDelete = $("editDelete");
  wireDialog(editDlg);
  let editing = null;   // { url, file, title, themeKey, duration }

  const setEditStatus = (msg, kind = "") => { editStatus.textContent = msg; editStatus.className = `uploadStatus ${kind}`; };
  const setEditBusy = (b) => { editSave.disabled = b; editDelete.disabled = b; };

  /* mesmas mudanças, aplicadas localmente para a interface responder na hora */
  function localMove(oldUrl, newUrl, dest){
    const playlist = getPlaylist();
    const found = locate(playlist, oldUrl);
    if (found){
      found.theme.items.splice(found.index, 1);
      if (newUrl) ensureTheme(playlist, dest.group, dest.name).items.push(makeItem(newUrl, found.item.duration));
    }
    return normalizePlaylist(playlist);
  }

  async function saveEdit(e){
    e.preventDefault();
    if (!editing) return;
    const newStem = cleanName(editName.value).slice(0, 100);
    if (!validName(newStem)){ editName.focus(); return; }
    const target = getThemes().find(t => t.key === editTheme.value);
    if (!target) return;
    const sameTheme = target.key === editing.themeKey;
    if (sameTheme && newStem === stem(editing.file)){ editDlg.close(); return; }
    if (!(await requireAuth())) return;

    setEditBusy(true);
    setEditStatus("Salvando no repositório…");
    const oldUrl = editing.url;
    const ext = extOf(editing.file);
    try{
      const result = await commit(async ({ head, treeSha }) => {
        const files = await listTree(treeSha);
        const sha = files.find(f => f.path === oldUrl)?.sha;
        if (!sha) throw Object.assign(new Error("arquivo não encontrado"), { detail: "o arquivo não está mais no repositório" });
        const dir = themeDir(target.group, target.name);
        const taken = new Set(files.filter(f => dirOf(f.path) === dir && f.path !== oldUrl).map(f => baseOf(f.path).toLowerCase()));
        const name = uniqueName(cleanFileName(newStem + ext), taken);
        const newUrl = `${dir}/${name}`;
        const tree = [{ path: oldUrl, sha: null }, { path: newUrl, sha }];
        const credits = await readRepoJson("credits.json", head, null);
        if (fixCredits(credits, oldUrl, newUrl)) tree.push({ path: "credits.json", content: jsonText(credits) });
        const shared = await readRepoJson("cenas.json", head, null);
        if (fixScenes(shared, oldUrl, newUrl)) tree.push({ path: "cenas.json", content: jsonText(shared) });
        const message = sameTheme ? `Renomeia som: ${baseOf(oldUrl)} → ${name}` : `Move som para ${target.group}/${target.name}: ${name}`;
        return { tree, message, result: { newUrl, shared } };
      });
      editDlg.close();
      onLibraryChanged(localMove(oldUrl, result.newUrl, target), {
        pending: [result.newUrl], renamed: { [oldUrl]: result.newUrl }, shared: result.shared, openKey: target.key,
      });
      toast("Salvo ✓ o site publica em 1–3 min", 3500);
    }catch(err){
      setEditStatus(`Não foi possível salvar: ${explainError(err)}.`, "err");
    }finally{
      setEditBusy(false);
    }
  }

  async function deleteSound(){
    if (!editing) return;
    if (!confirm(`Remover “${displayTitle(editing.title)}” do repositório? Isso apaga o arquivo para todos os aparelhos.`)) return;
    if (!(await requireAuth())) return;
    setEditBusy(true);
    setEditStatus("Removendo…");
    const url = editing.url;
    try{
      const result = await commit(async ({ head, treeSha }) => {
        const files = await listTree(treeSha);
        const tree = files.some(f => f.path === url) ? [{ path: url, sha: null }] : [];
        const credits = await readRepoJson("credits.json", head, null);
        if (fixCredits(credits, url, null)) tree.push({ path: "credits.json", content: jsonText(credits) });
        const shared = await readRepoJson("cenas.json", head, null);
        if (fixScenes(shared, url, null)) tree.push({ path: "cenas.json", content: jsonText(shared) });
        return { tree, message: `Remove som: ${url}`, result: { shared } };
      });
      editDlg.close();
      onLibraryChanged(localMove(url, null), { removed: [url], shared: result.shared });
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
    async openUpload(){
      const state = authState();
      if (state === "locked" && !(await requireAuth())) return;
      needAuth.hidden = state !== "none";
      form.hidden = state === "none";
      if (state !== "none") fillSelects();
      if (!busy){ setStatus(""); setBar(null); entries = entries.filter(x => x.status !== "done" && x.status !== "dup"); renderFiles(); }
      dlg.showModal();
    },
    async openEdit({ url, file, title, themeKey }){
      if (authState() === "none"){ toast("Conecte ao GitHub em ⚙️ Ajustes para editar a biblioteca.", 3500); openSettings(); return; }
      if (!(await requireAuth())) return;
      editing = { url, file, title, themeKey };
      editName.value = stem(file);
      editTheme.innerHTML = themeOptions(getThemes(), themeKey, false);
      setEditStatus("");
      setEditBusy(false);
      editDlg.showModal();
    },
  };
}
