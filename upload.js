/* Adicionar sons direto do iPad (ou do PC).
   Envia os arquivos para o repositório num único commit, junto com o
   playlist.json já atualizado. O GitHub Pages publica em ~1 minuto.
   Precisa de um token do GitHub (fine-grained, Contents: Read and write),
   que fica salvo só neste aparelho. */

const LS_TOKEN = "jogatina_gh_token_v1";
const API = "https://api.github.com";
const BRANCH = "main";
const AUDIO_DIR = "audio";
const EXT_OK = [".mp3", ".wav", ".ogg", ".m4a", ".mpeg"];
const MAX_BYTES = 95 * 1024 * 1024;   // limite do GitHub é 100 MB por arquivo

/* dono/repositório: deduz do endereço do GitHub Pages (usuario.github.io/repo) */
function repoInfo(){
  const host = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const first = location.pathname.split("/").filter(Boolean)[0];
  if (host && first && !first.includes(".")) return { owner: host[1], repo: first };
  return { owner: "pdfto314", repo: "test" };
}
const { owner, repo } = repoInfo();
const repoPath = `/repos/${owner}/${repo}`;

/* mesmas regras do gerar_playlist.py, para o Action não reescrever o arquivo */
function niceTitle(fileName){
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}
const byLower = (key) => (a, b) => {
  const x = key(a).toLowerCase(), y = key(b).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

function cleanName(name){
  return name.normalize("NFC")
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
function formatSize(bytes){
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
function base64ToText(b64){
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes).replace(/^﻿/, "");
}

export function initUpload({ button, getThemes, getCurrentTheme, toast, onUploaded }){
  const $ = (id) => document.getElementById(id);
  const dlg = $("uploadDlg");
  const connectBox = $("connectBox");
  const connectForm = $("connectForm");
  const tokenInput = $("tokenInput");
  const uploadForm = $("uploadForm");
  const themeSelect = $("themeSelect");
  const newThemeField = $("newThemeField");
  const newThemeInput = $("newThemeInput");
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const fileList = $("fileList");
  const sendBtn = $("sendBtn");
  const statusEl = $("uploadStatus");
  const accountLabel = $("accountLabel");
  const disconnectBtn = $("disconnectBtn");

  $("repoName").textContent = `${owner}/${repo}`;

  let token = localStorage.getItem(LS_TOKEN) || "";
  let files = [];
  let busy = false;

  async function gh(path, { method = "GET", body } = {}){
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok){
      const err = new Error(`GitHub ${res.status}`);
      err.status = res.status;
      try{ err.detail = (await res.json()).message; }catch{}
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  function setStatus(msg, kind = ""){
    statusEl.textContent = msg;
    statusEl.className = `uploadStatus ${kind}`;
  }

  function showView(){
    const connected = Boolean(token);
    connectBox.hidden = connected;
    uploadForm.hidden = !connected;
    if (connected) fillThemes();
  }

  function fillThemes(){
    const themes = getThemes();
    const current = getCurrentTheme();
    themeSelect.innerHTML =
      themes.map(t => `<option value="${t.replaceAll('"', "&quot;")}">${t.replaceAll("<", "&lt;")}</option>`).join("") +
      `<option value="__new">➕ Novo tema…</option>`;
    themeSelect.value = themes.includes(current) ? current : (themes[0] ?? "__new");
    newThemeField.hidden = themeSelect.value !== "__new";
  }

  function renderFiles(){
    fileList.innerHTML = "";
    for (const f of files){
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = f.name;
      const size = document.createElement("span");
      size.textContent = formatSize(f.size);
      li.append(name, size);
      fileList.appendChild(li);
    }
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

  /* ----- conectar ----- */
  async function connect(e){
    e.preventDefault();
    const value = tokenInput.value.trim();
    if (!value) return;
    token = value;
    setStatus("");
    try{
      await gh(repoPath);
      localStorage.setItem(LS_TOKEN, token);
      tokenInput.value = "";
      await showAccount();
      showView();
      toast("Conectado ao GitHub ✓");
    }catch(err){
      token = "";
      toast(err.status === 401 ? "Token inválido." : `Não consegui acessar ${owner}/${repo} com esse token.`, 4000);
    }
  }

  async function showAccount(){
    accountLabel.textContent = `Repositório ${owner}/${repo}`;
    try{
      const me = await gh("/user");
      accountLabel.textContent = `Conectado como ${me.login} · ${owner}/${repo}`;
    }catch{}
  }

  /* ----- enviar ----- */
  async function readPlaylist(ref){
    try{
      const file = await gh(`${repoPath}/contents/playlist.json?ref=${ref}`);
      const data = JSON.parse(base64ToText(file.content));
      return Array.isArray(data?.themes) ? data : { themes: [] };
    }catch(err){
      if (err.status === 404) return { themes: [] };
      throw err;
    }
  }

  async function commitOnce(theme, blobs){
    const ref = await gh(`${repoPath}/git/ref/heads/${BRANCH}`);
    const head = ref.object.sha;
    const commit = await gh(`${repoPath}/git/commits/${head}`);
    const playlist = await readPlaylist(head);

    let entry = playlist.themes.find(t => t.name === theme);
    if (!entry){
      entry = { name: theme, count: 0, items: [] };
      playlist.themes.push(entry);
    }
    const taken = new Set(entry.items.map(i => String(i.file).toLowerCase()));

    const tree = [];
    const urls = [];
    for (const b of blobs){
      const name = uniqueName(b.name, taken);
      const path = `${AUDIO_DIR}/${theme}/${name}`;
      tree.push({ path, mode: "100644", type: "blob", sha: b.sha });
      entry.items.push({ title: niceTitle(name), file: name, url: path });
      urls.push(path);
    }
    entry.items.sort(byLower(i => i.file));
    entry.count = entry.items.length;
    playlist.themes.sort(byLower(t => t.name));
    playlist.generated = new Date().toISOString().slice(0, 19);

    tree.push({ path: "playlist.json", mode: "100644", type: "blob", content: JSON.stringify(playlist, null, 2) + "\n" });

    const newTree = await gh(`${repoPath}/git/trees`, { method: "POST", body: { base_tree: commit.tree.sha, tree } });
    const message = blobs.length === 1 ? `Adiciona som em ${theme}: ${blobs[0].name}` : `Adiciona ${blobs.length} sons em ${theme}`;
    const newCommit = await gh(`${repoPath}/git/commits`, { method: "POST", body: { message, tree: newTree.sha, parents: [head] } });
    await gh(`${repoPath}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: { sha: newCommit.sha } });
    return { playlist, urls };
  }

  async function send(e){
    e.preventDefault();
    if (busy || files.length === 0) return;

    const theme = cleanName(themeSelect.value === "__new" ? newThemeInput.value : themeSelect.value).slice(0, 60);
    if (!theme || theme === "." || theme === ".."){
      newThemeInput.focus();
      toast("Dê um nome para o tema.");
      return;
    }

    busy = true;
    renderFiles();
    try{
      // 1) sobe cada arquivo (independe do estado da branch)
      const blobs = [];
      for (const [i, f] of files.entries()){
        setStatus(`Enviando ${i + 1}/${files.length}: ${f.name}…`);
        const blob = await gh(`${repoPath}/git/blobs`, { method: "POST", body: { content: await fileToBase64(f), encoding: "base64" } });
        blobs.push({ name: cleanFileName(f.name), sha: blob.sha });
      }

      // 2) cria o commit; se a branch mudou no meio do caminho, tenta de novo
      setStatus("Salvando no repositório…");
      let result;
      for (let attempt = 0; ; attempt++){
        try{ result = await commitOnce(theme, blobs); break; }
        catch(err){ if (err.status === 422 && attempt < 2) continue; throw err; }
      }

      files = [];
      fileInput.value = "";
      newThemeInput.value = "";
      setStatus("Enviado ✓ Os sons aparecem em ~1 minuto.", "ok");
      onUploaded(result.playlist.themes, result.urls, theme);
      toast(`Enviado ✓ publicando ${result.urls.length} ${result.urls.length === 1 ? "som" : "sons"}…`, 4000);
    }catch(err){
      const why =
        err.status === 401 ? "token expirou ou é inválido — conecte de novo" :
        err.status === 403 || err.status === 404 ? "o token não tem permissão Contents: Read and write neste repositório" :
        err.status === 413 || err.status === 422 ? "arquivo grande demais ou conflito; tente de novo" :
        (err.detail || err.message || "falha de rede");
      setStatus(`Não foi possível enviar: ${why}.`, "err");
      if (err.status === 401){ token = ""; localStorage.removeItem(LS_TOKEN); showView(); }
    }finally{
      busy = false;
      renderFiles();
    }
  }

  /* ----- eventos ----- */
  button.addEventListener("click", () => {
    setStatus("");
    renderFiles();
    showView();
    if (token) showAccount();
    dlg.showModal();
  });
  connectForm.addEventListener("submit", connect);
  uploadForm.addEventListener("submit", send);
  themeSelect.addEventListener("change", () => {
    newThemeField.hidden = themeSelect.value !== "__new";
    if (!newThemeField.hidden) newThemeInput.focus();
  });
  fileInput.addEventListener("change", () => addFiles([...fileInput.files]));
  disconnectBtn.addEventListener("click", () => {
    if (!confirm("Desconectar do GitHub neste aparelho?")) return;
    token = "";
    localStorage.removeItem(LS_TOKEN);
    showView();
  });

  // arrastar e soltar (PC)
  for (const ev of ["dragenter", "dragover"]){
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
  }
  for (const ev of ["dragleave", "drop"]){
    dropZone.addEventListener(ev, () => dropZone.classList.remove("drag"));
  }
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    addFiles([...(e.dataTransfer?.files || [])]);
  });
}
