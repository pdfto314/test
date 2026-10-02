/* Integração com o GitHub: token (salvo só neste aparelho), API e commits atômicos.
   Usado para enviar/editar/remover sons e para as cenas compartilhadas. */
import { LS, escapeHtml, toast } from "./util.js";

const API = "https://api.github.com";
export const BRANCH = "main";

/* dono/repositório: deduz do endereço do GitHub Pages (usuario.github.io/repo) */
function repoInfo(){
  const host = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const first = location.pathname.split("/").filter(Boolean)[0];
  if (host && first && !first.includes(".")) return { owner: host[1], repo: first };
  return { owner: "pdfto314", repo: "test" };
}
export const { owner, repo } = repoInfo();
export const repoPath = `/repos/${owner}/${repo}`;

let token = localStorage.getItem(LS.token) || "";
const listeners = new Set();
export const onAuthChange = (fn) => listeners.add(fn);
export const isConnected = () => Boolean(token);
function setToken(value){
  token = value;
  try{ value ? localStorage.setItem(LS.token, value) : localStorage.removeItem(LS.token); }catch{}
  for (const fn of listeners) fn();
}
export function disconnect(){ setToken(""); }

export async function gh(path, { method = "GET", body } = {}){
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
    if (res.status === 401) setToken("");
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export function explainError(err){
  return err.status === 401 ? "o token expirou ou é inválido — conecte de novo" :
    err.status === 403 || err.status === 404 ? "o token não tem permissão Contents: Read and write neste repositório" :
    err.status === 413 ? "arquivo grande demais" :
    err.status === 422 ? "o repositório mudou no meio do caminho; tente de novo" :
    (err.detail || err.message || "falha de rede");
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

function base64ToText(b64){
  const bin = atob(String(b64).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))).replace(/^﻿/, "");
}

/* lê um JSON do repositório numa versão (ref); devolve fallback se não existir */
export async function readRepoJson(path, ref, fallback){
  try{
    const file = await gh(`${repoPath}/contents/${encPath(path)}?ref=${ref}`);
    return JSON.parse(base64ToText(file.content));
  }catch(err){
    if (err.status === 404) return fallback;
    throw err;
  }
}

/* sha dos arquivos de uma pasta (para mover/renomear sem reenviar o áudio) */
export async function listDir(dir, ref){
  try{
    const list = await gh(`${repoPath}/contents/${encPath(dir)}?ref=${ref}`);
    return new Map((Array.isArray(list) ? list : []).map(f => [f.path, f.sha]));
  }catch(err){
    if (err.status === 404) return new Map();
    throw err;
  }
}

export async function createBlob(base64){
  const blob = await gh(`${repoPath}/git/blobs`, { method: "POST", body: { content: base64, encoding: "base64" } });
  return blob.sha;
}

/* commit atômico: build(head) devolve { tree, message, result }.
   tree: [{ path, content }] para texto, [{ path, sha }] para blob, [{ path, sha: null }] para apagar.
   Se a branch mudar no meio (422), refaz a partir da versão nova. */
export async function commit(build){
  for (let attempt = 0; ; attempt++){
    try{
      const ref = await gh(`${repoPath}/git/ref/heads/${BRANCH}`);
      const head = ref.object.sha;
      const base = await gh(`${repoPath}/git/commits/${head}`);
      const { tree, message, result } = await build(head);
      const entries = tree.map(t => ({ path: t.path, mode: "100644", type: "blob", ...("content" in t ? { content: t.content } : { sha: t.sha }) }));
      const newTree = await gh(`${repoPath}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: entries } });
      const newCommit = await gh(`${repoPath}/git/commits`, { method: "POST", body: { message, tree: newTree.sha, parents: [head] } });
      await gh(`${repoPath}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: { sha: newCommit.sha } });
      return result;
    }catch(err){
      if (err.status === 422 && attempt < 2) continue;
      throw err;
    }
  }
}

export const jsonText = (data) => JSON.stringify(data, null, 2) + "\n";

/* ---------- formulário "Conectar ao GitHub" (reutilizado em Ajustes e em ＋ Sons) ---------- */
export function renderConnect(container, { compact = false } = {}){
  const render = () => {
    if (token){
      container.innerHTML = `
        <div class="connected">
          <span class="okDot"></span>
          <span class="connLabel">Conectado a <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b></span>
          <button class="btn small" type="button" data-disconnect>Desconectar</button>
        </div>`;
      const label = container.querySelector(".connLabel");
      gh("/user").then(me => { label.innerHTML = `Conectado como <b>${escapeHtml(me.login)}</b> · ${escapeHtml(owner)}/${escapeHtml(repo)}`; }).catch(() => {});
      container.querySelector("[data-disconnect]").addEventListener("click", () => {
        if (confirm("Desconectar do GitHub neste aparelho?")) disconnect();
      });
      return;
    }
    container.innerHTML = `
      ${compact ? "" : `<p class="muted">Conecte uma vez para enviar sons, editar a biblioteca e compartilhar cenas entre aparelhos.</p>`}
      <ol class="steps">
        <li>Abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">criar token no GitHub</a>.</li>
        <li><b>Repository access</b> → <b>Only select repositories</b> → <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b>.</li>
        <li><b>Permissions → Contents</b> → <b>Read and write</b>.</li>
        <li>Gere o token, copie e cole aqui:</li>
      </ol>
      <form class="row" data-connect>
        <input class="input" type="password" placeholder="github_pat_…" autocomplete="off" />
        <button class="btn primary" type="submit">Conectar</button>
      </form>
      <p class="muted small">O token fica salvo só neste aparelho.</p>`;
    container.querySelector("[data-connect]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const value = input.value.trim();
      if (!value) return;
      token = value;
      try{
        await gh(repoPath);
        input.value = "";
        setToken(value);
        toast("Conectado ao GitHub ✓");
      }catch(err){
        token = "";
        toast(err.status === 401 ? "Token inválido." : `Não consegui acessar ${owner}/${repo} com esse token.`, 4000);
      }
    });
  };
  render();
  onAuthChange(render);
}
