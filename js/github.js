/* Integração com o GitHub (API REST), com o token protegido por senha.
   - O token fica cifrado no aparelho (js/vault.js); decifrado só na memória após desbloquear
   - Bloqueia sozinho após 30 min sem uso; 10 senhas erradas apagam o cofre
   - O token só é enviado para api.github.com (reforçado pela CSP do index.html)
   - Commits atômicos via Git Data API (blobs → árvore → commit → ref), refazendo se a branch mudar */
import { $, LS, escapeHtml, toast, wireDialog, readJson, writeJson } from "./util.js";
import { seal, open, MIN_PASSWORD } from "./vault.js";

const API = "https://api.github.com";
export const BRANCH = "main";
const AUTO_LOCK_MS = 30 * 60 * 1000;
const MAX_FAILS = 10;

/* dono/repositório: deduz do endereço do GitHub Pages (usuario.github.io/repo) */
function repoInfo(){
  const host = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const first = location.pathname.split("/").filter(Boolean)[0];
  if (host && first && !first.includes(".")) return { owner: host[1], repo: first };
  return { owner: "pdfto314", repo: "test" };
}
export const { owner, repo } = repoInfo();
export const repoPath = `/repos/${owner}/${repo}`;

/* ---------- estado da conexão ---------- */
let token = "";                 // só em memória
let lockTimer = 0;
try{ localStorage.removeItem(LS.token); }catch{}   // versões antigas guardavam o token em texto puro

const listeners = new Set();
export const onAuthChange = (fn) => listeners.add(fn);
const emit = () => { for (const fn of listeners) fn(); };

export const hasVault = () => Boolean(readJson(LS.vault, null));
export const isConnected = () => Boolean(token);
export const authState = () => token ? "unlocked" : hasVault() ? "locked" : "none";

function touch(){
  clearTimeout(lockTimer);
  if (token) lockTimer = setTimeout(() => { lock(); toast("🔒 GitHub bloqueado por inatividade."); }, AUTO_LOCK_MS);
}
export function lock(){
  token = "";
  clearTimeout(lockTimer);
  emit();
}
export function forget(){
  token = "";
  try{ localStorage.removeItem(LS.vault); localStorage.removeItem(LS.vaultFails); }catch{}
  emit();
}

/* ---------- API ---------- */
async function request(path, { method = "GET", body, auth = token } = {}){
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok){
    const err = new Error(`GitHub ${res.status}`);
    err.status = res.status;
    try{ err.detail = (await res.json()).message; }catch{}
    throw err;
  }
  return { data: res.status === 204 ? null : await res.json(), headers: res.headers };
}

export async function gh(path, opts = {}){
  if (!token) throw Object.assign(new Error("GitHub bloqueado"), { status: 401, locked: true });
  touch();
  try{
    return (await request(path, opts)).data;
  }catch(err){
    if (err.status === 401){ lock(); }
    throw err;
  }
}

export function explainError(err){
  if (err.locked) return "desbloqueie a conexão com o GitHub";
  return err.status === 401 ? "o token expirou ou é inválido — conecte de novo em ⚙️ Ajustes" :
    err.status === 403 || err.status === 404 ? "o token não tem permissão Contents: Read and write neste repositório" :
    err.status === 409 ? "o repositório está vazio ou em conflito" :
    err.status === 413 ? "arquivo grande demais" :
    err.status === 422 ? "o repositório mudou no meio do caminho; tente de novo" :
    (err.detail || err.message || "falha de rede");
}

/* ---------- conectar / desbloquear ---------- */
async function validateToken(value){
  // 1) consegue ver o repositório?
  const { headers } = await request(repoPath, { auth: value });
  // 2) consegue escrever? (cria um blob solto, que o GitHub descarta se não for usado)
  await request(`${repoPath}/git/blobs`, { method: "POST", auth: value, body: { content: "jogatina", encoding: "utf-8" } });
  // 3) token clássico com acesso amplo?
  const scopes = (headers.get("x-oauth-scopes") || "").split(",").map(s => s.trim()).filter(Boolean);
  return { classic: value.startsWith("ghp_") || scopes.length > 0, scopes };
}

export async function connect(value, password){
  value = value.trim();
  if (String(password).length < MIN_PASSWORD) throw new Error(`a senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
  const info = await validateToken(value);
  if (info.classic && !confirm(
    "Este é um token CLÁSSICO" + (info.scopes.length ? ` (escopos: ${info.scopes.join(", ")})` : "") +
    ", que pode dar acesso a todos os seus repositórios.\n\nRecomendado: um token fine-grained só deste repositório.\n\nUsar mesmo assim?")) {
    throw Object.assign(new Error("cancelado"), { cancelled: true });
  }
  writeJson(LS.vault, await seal(value, password));
  try{ localStorage.removeItem(LS.vaultFails); }catch{}
  token = value;
  touch();
  emit();
}

export async function unlock(password){
  const record = readJson(LS.vault, null);
  if (!record) throw new Error("nenhum token salvo");
  try{
    token = await open(record, password);
  }catch(err){
    const fails = (Number(localStorage.getItem(LS.vaultFails)) || 0) + 1;
    try{ localStorage.setItem(LS.vaultFails, String(fails)); }catch{}
    if (fails >= MAX_FAILS){
      forget();
      throw new Error("senha errada muitas vezes — o token foi apagado deste aparelho por segurança");
    }
    throw new Error(`senha incorreta (${MAX_FAILS - fails} tentativas restantes)`);
  }
  try{ localStorage.removeItem(LS.vaultFails); }catch{}
  touch();
  emit();
}

/* pede para desbloquear (ou conectar) antes de uma ação que escreve no repositório */
let unlockResolve = null;
export function requireAuth(){
  if (token) return Promise.resolve(true);
  if (!hasVault()){
    toast("Conecte ao GitHub em ⚙️ Ajustes para enviar ou editar sons.", 3500);
    document.dispatchEvent(new CustomEvent("jogatina:open-settings"));
    return Promise.resolve(false);
  }
  const dlg = $("unlockDlg");
  $("unlockStatus").textContent = "";
  dlg.showModal();
  setTimeout(() => $("unlockPassword").focus(), 50);
  return new Promise((resolve) => { unlockResolve = resolve; });
}

export function initAuthUi(){
  const dlg = $("unlockDlg");
  wireDialog(dlg);
  dlg.addEventListener("close", () => { unlockResolve?.(Boolean(token)); unlockResolve = null; });
  $("unlockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("unlockPassword");
    const status = $("unlockStatus");
    status.textContent = "Verificando…";
    try{
      await unlock(input.value);
      input.value = "";
      dlg.close();
      toast("🔓 GitHub desbloqueado");
    }catch(err){
      status.textContent = err.message;
      status.className = "uploadStatus err";
      if (!hasVault()) dlg.close();
    }
  });
}

/* ---------- leitura do repositório ---------- */
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
function base64ToText(b64){
  const bin = atob(String(b64).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))).replace(/^﻿/, "");
}
export async function readRepoJson(path, ref, fallback){
  try{
    const file = await gh(`${repoPath}/contents/${encPath(path)}?ref=${ref}`);
    return JSON.parse(base64ToText(file.content));
  }catch(err){
    if (err.status === 404) return fallback;
    throw err;
  }
}
/* todos os arquivos de uma árvore (para achar repetidos e nomes livres) */
export async function listTree(treeSha){
  const data = await gh(`${repoPath}/git/trees/${treeSha}?recursive=1`);
  if (data.truncated) throw new Error("repositório grande demais para listar de uma vez");
  return (data.tree || []).filter(e => e.type === "blob").map(e => ({ path: e.path, sha: e.sha }));
}
export async function createBlob(base64){
  return (await gh(`${repoPath}/git/blobs`, { method: "POST", body: { content: base64, encoding: "base64" } })).sha;
}

/* commit atômico: build({ head, treeSha }) devolve { tree, message, result }.
   tree: [{ path, content }] texto · [{ path, sha }] blob · [{ path, sha: null }] apagar */
export async function commit(build){
  for (let attempt = 0; ; attempt++){
    try{
      const ref = await gh(`${repoPath}/git/ref/heads/${BRANCH}`);
      const head = ref.object.sha;
      const base = await gh(`${repoPath}/git/commits/${head}`);
      const { tree, message, result } = await build({ head, treeSha: base.tree.sha });
      if (!tree.length) return result;
      const entries = tree.map(t => ({ path: t.path, mode: "100644", type: "blob", ...("content" in t ? { content: t.content } : { sha: t.sha }) }));
      const newTree = await gh(`${repoPath}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: entries } });
      const newCommit = await gh(`${repoPath}/git/commits`, { method: "POST", body: { message, tree: newTree.sha, parents: [head] } });
      await gh(`${repoPath}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: { sha: newCommit.sha } });
      return result;
    }catch(err){
      if (err.status === 422 && attempt < 3) continue;
      throw err;
    }
  }
}
export const jsonText = (data) => JSON.stringify(data, null, 2) + "\n";

/* ---------- painel "GitHub" (Ajustes) ---------- */
export function renderConnect(container){
  const render = () => {
    const state = authState();
    if (state === "unlocked"){
      container.innerHTML = `
        <div class="connected">
          <span class="okDot"></span>
          <span class="connLabel">Conectado a <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b></span>
        </div>
        <p class="muted small">🔐 Token cifrado neste aparelho. Bloqueia sozinho após 30 min sem uso.</p>
        <div class="row">
          <button class="btn" type="button" data-lock>🔒 Bloquear agora</button>
          <button class="btn danger ghost" type="button" data-forget>Apagar token</button>
        </div>`;
      const label = container.querySelector(".connLabel");
      gh("/user").then(me => { label.innerHTML = `Conectado como <b>${escapeHtml(me.login)}</b> · ${escapeHtml(owner)}/${escapeHtml(repo)}`; }).catch(() => {});
      container.querySelector("[data-lock]").addEventListener("click", () => { lock(); toast("🔒 Bloqueado"); });
      container.querySelector("[data-forget]").addEventListener("click", () => {
        if (confirm("Apagar o token deste aparelho? Você vai precisar colar de novo para enviar sons.")) forget();
      });
      return;
    }
    if (state === "locked"){
      container.innerHTML = `
        <p class="muted">🔒 Token salvo e cifrado. Digite sua senha para usar.</p>
        <form class="row" data-unlock>
          <input class="input" type="password" placeholder="Senha" autocomplete="current-password" />
          <button class="btn primary" type="submit">Desbloquear</button>
        </form>
        <div class="uploadStatus" data-status></div>
        <button class="linkBtn" type="button" data-forget>Esqueci a senha (apagar token)</button>`;
      container.querySelector("[data-unlock]").addEventListener("submit", async (e) => {
        e.preventDefault();
        const status = container.querySelector("[data-status]");
        status.textContent = "Verificando…";
        try{ await unlock(e.target.querySelector("input").value); toast("🔓 GitHub desbloqueado"); }
        catch(err){ status.textContent = err.message; status.className = "uploadStatus err"; }
      });
      container.querySelector("[data-forget]").addEventListener("click", () => {
        if (confirm("Apagar o token salvo? Depois é só colar o token de novo e criar outra senha.")) forget();
      });
      return;
    }
    container.innerHTML = `
      <p class="muted">Conecte uma vez para enviar sons do aparelho direto para o repositório, editar a biblioteca e compartilhar cenas.</p>
      <ol class="steps">
        <li>Abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">criar token fine-grained</a>.</li>
        <li><b>Repository access</b> → <b>Only select repositories</b> → <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b>.</li>
        <li><b>Permissions → Contents</b> → <b>Read and write</b> (só isso).</li>
        <li>Gere, copie e cole aqui. Crie uma senha para proteger o token neste aparelho.</li>
      </ol>
      <form class="connectForm" data-connect>
        <input class="input" name="token" type="password" placeholder="github_pat_…" autocomplete="off" required />
        <div class="row">
          <input class="input" name="pass" type="password" placeholder="Senha (mín. ${MIN_PASSWORD})" autocomplete="new-password" minlength="${MIN_PASSWORD}" required />
          <input class="input" name="pass2" type="password" placeholder="Repita a senha" autocomplete="new-password" required />
        </div>
        <button class="btn primary big" type="submit">🔐 Conectar com segurança</button>
        <div class="uploadStatus" data-status></div>
      </form>
      <p class="muted small">O token é cifrado (AES-256) com a sua senha e nunca fica salvo em texto puro. Ele só é enviado para api.github.com.</p>`;
    container.querySelector("[data-connect]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const status = container.querySelector("[data-status]");
      if (f.pass.value !== f.pass2.value){ status.textContent = "As senhas não conferem."; status.className = "uploadStatus err"; return; }
      status.textContent = "Verificando o token…";
      status.className = "uploadStatus";
      try{
        await connect(f.token.value, f.pass.value);
        toast("🔐 Conectado ao GitHub com segurança");
      }catch(err){
        if (err.cancelled){ status.textContent = ""; return; }
        status.textContent = err.status === 401 ? "Token inválido." :
          err.status ? `Não deu: ${explainError(err)}.` : err.message;
        status.className = "uploadStatus err";
      }
    });
  };
  render();
  onAuthChange(render);
}
