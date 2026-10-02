#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Jogatina — sincroniza sons entre uma pasta do computador e o repositório, direto pela
API do GitHub. Não precisa de git, clone nem "git pull".

A pasta segue a mesma estrutura do site:   <PASTA>/<Grupo>/<Tema>/<Som>.mp3
  ex.:  Sons Jogatina/Ambientes/Taverna/Lareira.mp3

Comandos
  python sincronizar.py status   [PASTA]            mostra o que é diferente entre a pasta e o repositório
  python sincronizar.py enviar   [PASTA] [--apagar] envia sons novos/alterados (e com --apagar, remove
                                                    do repositório o que não está mais na pasta)
  python sincronizar.py baixar   [PASTA] [--apagar] baixa para a pasta o que falta (cópia local sem git)
  python sincronizar.py freesound "BUSCA" --tema "Grupo/Tema" [--quantos 3] [--licenca cc0|by|todas]
  python sincronizar.py freesound --lote ferramentas/heroes_queries.json
  python sincronizar.py token    [--freesound]      guarda o token no cofre do sistema (keyring)
Opções gerais: --simular (não muda nada) · --sim (não pergunta) · --repo dono/repo

Segurança
  - O token do GitHub vem de JOGATINA_TOKEN / GITHUB_TOKEN ou do cofre do sistema
    (Windows Credential Manager / Chaves do macOS / Secret Service), via "pip install keyring".
    Ele nunca é gravado em arquivo. Use um token fine-grained só deste repositório,
    com "Contents: Read and write".
  - A chave do Freesound vem de FREESOUND_API_KEY ou do cofre do sistema.
  - Cada envio é um único commit; se o repositório mudar no meio, refaz a partir da versão nova.
  - Sons iguais são reconhecidos pelo hash do git e não são enviados de novo.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

EXT_OK = {".mp3", ".wav", ".ogg", ".m4a", ".mpeg"}
MAX_BYTES = 95 * 1024 * 1024
DEFAULT_REPO = os.environ.get("JOGATINA_REPO", "pdfto314/test")
API = os.environ.get("JOGATINA_API", "https://api.github.com").rstrip("/")
FREESOUND_API = os.environ.get("FREESOUND_API", "https://freesound.org/apiv2").rstrip("/")
RAW = os.environ.get("JOGATINA_RAW", "https://raw.githubusercontent.com").rstrip("/")
BRANCH = os.environ.get("JOGATINA_BRANCH", "main")
AUDIO_DIR = "audio"
KEYRING_SERVICE = "jogatina"
DEFAULT_FOLDER = "Sons Jogatina"


class Falha(Exception):
    """Erro com mensagem para o usuário (sem traceback)."""

    def __init__(self, msg: str, code: int = 1):
        super().__init__(msg)
        self.code = code


# ---------------------------------------------------------------- utilidades

def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def clean_name(name: str) -> str:
    name = nfc(name)
    name = re.sub(r'[\\/:*?"<>|#%\x00-\x1f]+', "_", name)
    return re.sub(r"\s+", " ", name).strip()


def clean_file_name(name: str) -> str:
    name = clean_name(name)
    stem, ext = os.path.splitext(name)
    return (stem.strip() or "som")[:100] + ext.lower()


def unique_name(name: str, taken: set) -> str:
    stem, ext = os.path.splitext(name)
    candidate, n = name, 2
    while candidate.lower() in taken:
        candidate = f"{stem} ({n}){ext}"
        n += 1
    taken.add(candidate.lower())
    return candidate


def human(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB" if n > 1024 * 1024 else f"{max(1, round(n / 1024))} KB"


def plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def confirm(question: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        raise Falha("Confirmação necessária: rode de novo com --sim para confirmar.", 2)
    return input(f"{question} [s/N] ").strip().lower() in {"s", "sim", "y", "yes"}


# ---------------------------------------------------------------- segredos

def _keyring():
    try:
        import keyring  # type: ignore
        return keyring
    except Exception:
        return None


def get_secret(env_names: Iterable[str], account: str, label: str, required: bool = True) -> Optional[str]:
    for name in env_names:
        if os.environ.get(name):
            return os.environ[name].strip()
    kr = _keyring()
    if kr:
        try:
            value = kr.get_password(KEYRING_SERVICE, account)
            if value:
                return value
        except Exception:
            pass
    if not required:
        return None
    if sys.stdin.isatty():
        value = getpass.getpass(f"{label} (não aparece na tela): ").strip()
        if value and kr and confirm("Guardar no cofre do sistema para a próxima vez?", False):
            kr.set_password(KEYRING_SERVICE, account, value)
        if value:
            return value
    raise Falha(f"{label} não encontrado. Defina {' ou '.join(env_names)} ou rode: python sincronizar.py token", 2)


# ---------------------------------------------------------------- GitHub

class GitHub:
    def __init__(self, repo: str, token: Optional[str]):
        self.repo = repo
        self.token = token
        self.calls = 0

    def request(self, method: str, path: str, body=None, raw: bool = False, retries: int = 3):
        url = path if path.startswith("http") else f"{API}{path}"
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                   "User-Agent": "jogatina-sincronizar"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if data is not None:
            headers["Content-Type"] = "application/json"
        for attempt in range(retries + 1):
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    payload = res.read()
                    if raw:
                        return payload
                    return json.loads(payload) if payload else None
            except urllib.error.HTTPError as e:
                detail = ""
                try:
                    detail = json.loads(e.read() or b"{}").get("message", "")
                except Exception:
                    pass
                remaining = e.headers.get("X-RateLimit-Remaining") if e.headers else None
                if e.code in (403, 429) and remaining == "0" and attempt < retries:
                    reset = int(e.headers.get("X-RateLimit-Reset", "0") or 0)
                    time.sleep(min(60, max(1, reset - int(time.time()))))
                    continue
                if e.code >= 500 and attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
                err = Falha(self._explain(e.code, detail), 3)
                err.status = e.code  # type: ignore[attr-defined]
                raise err
            except urllib.error.URLError as e:
                if attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
                raise Falha(f"Sem conexão com o GitHub ({e.reason}).", 3)

    @staticmethod
    def _explain(code: int, detail: str) -> str:
        if code == 401:
            return "Token inválido ou expirado (GitHub 401)."
        if code in (403, 404):
            return f"Sem acesso ao repositório (GitHub {code}). O token precisa de 'Contents: Read and write' neste repositório. {detail}".strip()
        if code == 422:
            return f"O GitHub recusou a operação (422). {detail}".strip()
        return f"Erro do GitHub {code}. {detail}".strip()

    # --- leitura
    def head(self) -> Tuple[str, str]:
        ref = self.request("GET", f"/repos/{self.repo}/git/ref/heads/{BRANCH}")
        commit = self.request("GET", f"/repos/{self.repo}/git/commits/{ref['object']['sha']}")
        return ref["object"]["sha"], commit["tree"]["sha"]

    def tree(self, tree_sha: str) -> Dict[str, str]:
        data = self.request("GET", f"/repos/{self.repo}/git/trees/{tree_sha}?recursive=1")
        if data.get("truncated"):
            raise Falha("Repositório grande demais para listar de uma vez.", 3)
        return {nfc(e["path"]): e["sha"] for e in data.get("tree", []) if e.get("type") == "blob"}

    def blob(self, sha: str) -> bytes:
        data = self.request("GET", f"/repos/{self.repo}/git/blobs/{sha}")
        return base64.b64decode(data["content"])

    def download(self, path: str, sha: str, ref: str) -> bytes:
        """com token: API (funciona em repositório privado); sem token: raw (sem limite de 60/h)"""
        if self.token:
            return self.blob(sha)
        url = f"{RAW}/{self.repo}/{ref}/" + urllib.parse.quote(path)
        return self.request("GET", url, raw=True)

    def read_json(self, files: Dict[str, str], path: str, default):
        if path not in files:
            return default
        return json.loads(self.blob(files[path]).decode("utf-8-sig"))

    # --- escrita
    def create_blob(self, data: bytes) -> str:
        res = self.request("POST", f"/repos/{self.repo}/git/blobs",
                           {"content": base64.b64encode(data).decode(), "encoding": "base64"})
        return res["sha"]

    def commit(self, build):
        """build(files, head) -> (entries, message, result). Refaz se a branch mudar (422)."""
        for attempt in range(4):
            head, tree_sha = self.head()
            files = self.tree(tree_sha)
            entries, message, result = build(files, head)
            if not entries:
                return result
            tree = []
            for e in entries:
                item = {"path": e["path"], "mode": "100644", "type": "blob"}
                if "content" in e:
                    item["content"] = e["content"]
                else:
                    item["sha"] = e["sha"]
                tree.append(item)
            new_tree = self.request("POST", f"/repos/{self.repo}/git/trees", {"base_tree": tree_sha, "tree": tree})
            new_commit = self.request("POST", f"/repos/{self.repo}/git/commits",
                                      {"message": message, "tree": new_tree["sha"], "parents": [head]})
            try:
                self.request("PATCH", f"/repos/{self.repo}/git/refs/heads/{BRANCH}", {"sha": new_commit["sha"]})
                return result
            except Falha as e:
                if getattr(e, "status", None) == 422 and attempt < 3:
                    print("  o repositório mudou no meio do caminho; refazendo…")
                    continue
                raise
        raise Falha("Não consegui gravar: o repositório mudou várias vezes seguidas.", 3)


def json_text(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


# ---------------------------------------------------------------- pasta local

def scan_local(folder: Path) -> Dict[str, Path]:
    """caminho no repositório (audio/...) -> arquivo local"""
    out: Dict[str, Path] = {}
    if not folder.exists():
        return out
    for f in sorted(folder.rglob("*")):
        if not f.is_file() or f.name.startswith(".") or f.suffix.lower() not in EXT_OK:
            continue
        rel = nfc(f.relative_to(folder).as_posix())
        out[f"{AUDIO_DIR}/{rel}"] = f
    return out


def remote_audio(files: Dict[str, str]) -> Dict[str, str]:
    return {p: s for p, s in files.items() if p.startswith(AUDIO_DIR + "/") and Path(p).suffix.lower() in EXT_OK}


def local_shas(local: Dict[str, Path]) -> Dict[str, Tuple[str, int]]:
    out = {}
    for path, f in local.items():
        data = f.read_bytes()
        out[path] = (git_blob_sha(data), len(data))
    return out


def diff(local: Dict[str, Tuple[str, int]], remote: Dict[str, str]):
    new = sorted(p for p in local if p not in remote)
    changed = sorted(p for p in local if p in remote and local[p][0] != remote[p])
    missing = sorted(p for p in remote if p not in local)
    same = sorted(p for p in local if p in remote and local[p][0] == remote[p])
    return new, changed, missing, same


def warn_structure(paths: Iterable[str]):
    bad = [p for p in paths if len(p.split("/")) != 4]
    if bad:
        print(f"  aviso: {plural(len(bad), 'arquivo fora', 'arquivos fora')} do formato <Grupo>/<Tema>/<som> "
              f"(ex.: {bad[0][len(AUDIO_DIR) + 1:]}). Eles funcionam, mas ficam em temas sem grupo.")


# ---------------------------------------------------------------- comandos

def cmd_status(gh: GitHub, folder: Path, args) -> int:
    _, tree_sha = gh.head()
    remote = remote_audio(gh.tree(tree_sha))
    local = local_shas(scan_local(folder))
    new, changed, missing, same = diff(local, remote)
    print(f"Pasta: {folder}  ·  Repositório: {gh.repo} ({BRANCH})")
    print(f"  iguais: {len(same)}   novos na pasta: {len(new)}   alterados: {len(changed)}   só no repositório: {len(missing)}")
    for label, items in (("+ novo", new), ("~ alterado", changed), ("- só no repositório", missing)):
        for p in items[:50]:
            print(f"  {label}: {p[len(AUDIO_DIR) + 1:]}")
        if len(items) > 50:
            print(f"  … e mais {len(items) - 50}")
    return 0


def cmd_enviar(gh: GitHub, folder: Path, args) -> int:
    local_files = scan_local(folder)
    if not local_files:
        raise Falha(f"Nenhum áudio encontrado em {folder} (estrutura esperada: <Grupo>/<Tema>/<som>.mp3).", 2)
    warn_structure(local_files)
    too_big = [p for p, f in local_files.items() if f.stat().st_size > MAX_BYTES]
    if too_big:
        raise Falha(f"Arquivo maior que 95 MB (limite do GitHub): {too_big[0]}", 2)
    local = local_shas(local_files)
    _, tree_sha = gh.head()
    files = gh.tree(tree_sha)
    remote = remote_audio(files)
    new, changed, missing, _ = diff(local, remote)
    to_delete = missing if args.apagar else []
    if not (new or changed or to_delete):
        print("Tudo certo: o repositório já tem tudo o que está na pasta.")
        return 0
    print(f"Enviar: {len(new)} novos, {len(changed)} alterados" + (f", remover {len(to_delete)}" if to_delete else ""))
    for p in (new + changed)[:30]:
        print(f"  ↑ {p[len(AUDIO_DIR) + 1:]}")
    for p in to_delete[:30]:
        print(f"  ✕ {p[len(AUDIO_DIR) + 1:]}")
    if args.simular:
        print("(simulação: nada foi enviado)")
        return 0
    if to_delete and not confirm(f"Remover {plural(len(to_delete), 'som', 'sons')} do repositório?", args.sim):
        print("Cancelado.")
        return 1

    # sobe só o conteúdo que o repositório ainda não tem (arquivo movido = reaproveita)
    known = set(files.values())
    uploaded = 0
    for p in new + changed:
        sha, size = local[p]
        if sha in known:
            continue
        print(f"  enviando {p[len(AUDIO_DIR) + 1:]} ({human(size)})…")
        created = gh.create_blob(local_files[p].read_bytes())
        if created != sha:
            raise Falha(f"O GitHub devolveu um hash diferente para {p}; envio abortado.", 3)
        known.add(sha)
        uploaded += 1

    def build(current: Dict[str, str], head: str):
        entries = [{"path": p, "sha": local[p][0]} for p in new + changed if current.get(p) != local[p][0]]
        entries += [{"path": p, "sha": None} for p in to_delete if p in current]
        if to_delete:
            credits = gh.read_json(current, "credits.json", None)
            if isinstance(credits, list):
                kept = [c for c in credits if c.get("file") not in set(to_delete)]
                if len(kept) != len(credits):
                    entries.append({"path": "credits.json", "content": json_text(kept)})
        message = "Sincroniza sons: " + ", ".join(x for x in (
            f"+{len(new)}" if new else "", f"~{len(changed)}" if changed else "", f"-{len(to_delete)}" if to_delete else "") if x)
        return entries, message, len(entries)

    count = gh.commit(build)
    print(f"Pronto ✓ {plural(count, 'mudança gravada', 'mudanças gravadas')} num único commit "
          f"({plural(uploaded, 'arquivo enviado', 'arquivos enviados')}). O site publica em 1–3 min.")
    return 0


def cmd_baixar(gh: GitHub, folder: Path, args) -> int:
    head, tree_sha = gh.head()
    remote = remote_audio(gh.tree(tree_sha))
    local_files = scan_local(folder)
    local = local_shas(local_files)
    todo = sorted(p for p in remote if local.get(p, ("",))[0] != remote[p])
    extra = sorted(p for p in local if p not in remote) if args.apagar else []
    if not (todo or extra):
        print("Tudo certo: a pasta já está igual ao repositório.")
        return 0
    print(f"Baixar: {len(todo)} arquivos" + (f", apagar da pasta {len(extra)}" if extra else ""))
    if args.simular:
        for p in todo[:30]:
            print(f"  ↓ {p[len(AUDIO_DIR) + 1:]}")
        print("(simulação: nada foi baixado)")
        return 0
    if extra and not confirm(f"Apagar {plural(len(extra), 'arquivo', 'arquivos')} da pasta que não estão no repositório?", args.sim):
        print("Cancelado.")
        return 1
    for i, p in enumerate(todo, 1):
        dest = folder / p[len(AUDIO_DIR) + 1:]
        print(f"  [{i}/{len(todo)}] {p[len(AUDIO_DIR) + 1:]}")
        data = gh.download(p, remote[p], head)
        if git_blob_sha(data) != remote[p]:
            raise Falha(f"Download corrompido: {p}", 3)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".baixando")
        tmp.write_bytes(data)
        os.replace(tmp, dest)
    for p in extra:
        local_files[p].unlink()
    print(f"Pronto ✓ {plural(len(todo), 'arquivo baixado', 'arquivos baixados')}" + (f", {len(extra)} apagados" if extra else "") + ".")
    return 0


# ---------------------------------------------------------------- Freesound

LICENSES = {
    "cc0": 'license:"Creative Commons 0"',
    "by": 'license:("Creative Commons 0" OR "Attribution")',
    "todas": "",
}


def freesound_search(key: str, query: str, count: int, license_key: str, min_d: float, max_d: float) -> List[dict]:
    filters = [f"duration:[{min_d} TO {max_d}]"]
    if LICENSES.get(license_key):
        filters.append(LICENSES[license_key])
    params = urllib.parse.urlencode({
        "query": query, "filter": " ".join(filters), "sort": "rating_desc", "page_size": max(1, min(count * 3, 50)),
        "fields": "id,name,previews,license,duration,username,url",
    })
    req = urllib.request.Request(f"{FREESOUND_API}/search/text/?{params}",
                                 headers={"Authorization": f"Token {key}", "User-Agent": "jogatina-sincronizar"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read()).get("results", [])
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise Falha("Chave do Freesound inválida (401).", 2)
        raise Falha(f"Erro do Freesound {e.code}.", 3)
    except urllib.error.URLError as e:
        raise Falha(f"Sem conexão com o Freesound ({e.reason}).", 3)


def freesound_download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "jogatina-sincronizar"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def parse_theme(value: str) -> str:
    parts = [clean_name(p) for p in value.replace("\\", "/").split("/") if clean_name(p)]
    if not parts or any(p in {".", ".."} for p in parts):
        raise Falha('Use --tema "Grupo/Tema" (ex.: --tema "Criaturas/Coruja").', 2)
    return f"{AUDIO_DIR}/" + "/".join(parts)


def cmd_freesound(gh: GitHub, args) -> int:
    key = get_secret(["FREESOUND_API_KEY"], "freesound", "Chave da API do Freesound")
    jobs: List[Tuple[str, str, int]] = []      # (busca, pasta no repo, quantos)
    min_d, max_d, lic = args.min, args.max, args.licenca
    if args.lote:
        cfg = json.loads(Path(args.lote).read_text(encoding="utf-8-sig"))
        per = int(cfg.get("max_per_category", 3))
        min_d = float(cfg.get("min_duration", min_d))
        max_d = float(cfg.get("max_duration", max_d))
        for cat in cfg.get("categories", []):
            folder = parse_theme(cat["folder"])
            for q in cat.get("queries", []):
                jobs.append((q, folder, per))
    else:
        if not args.busca or not args.tema:
            raise Falha('Uso: python sincronizar.py freesound "busca" --tema "Grupo/Tema"', 2)
        jobs.append((args.busca, parse_theme(args.tema), args.quantos))

    _, tree_sha = gh.head()
    files = gh.tree(tree_sha)
    known = set(files.values())
    chosen: List[dict] = []        # {dir, name, sha, data, credit}
    per_folder: Dict[str, int] = {}
    for query, folder, quantity in jobs:
        print(f"Freesound: “{query}” → {folder[len(AUDIO_DIR) + 1:]}")
        for r in freesound_search(key, query, quantity, lic, min_d, max_d):
            if per_folder.get(folder, 0) >= quantity:
                break
            preview = (r.get("previews") or {}).get("preview-hq-mp3") or (r.get("previews") or {}).get("preview-lq-mp3")
            if not preview:
                continue
            if args.simular:
                print(f"  • {r['name']} — {r.get('username', '?')} ({r.get('duration', 0):.0f} s)")
                per_folder[folder] = per_folder.get(folder, 0) + 1
                continue
            data = freesound_download(preview)
            sha = git_blob_sha(data)
            if sha in known:
                print(f"  ⏭  já existe: {r['name']}")
                continue
            known.add(sha)
            chosen.append({"dir": folder, "name": clean_file_name(os.path.splitext(r["name"])[0] + ".mp3"), "sha": sha,
                           "data": data, "credit": {"title": r["name"], "author": r.get("username", ""),
                                                    "license": r.get("license", ""), "source": r.get("url", "")}})
            per_folder[folder] = per_folder.get(folder, 0) + 1
            print(f"  ✓ {r['name']} — {r.get('username', '?')}")
    if args.simular:
        print("(simulação: nada foi baixado nem enviado)")
        return 0
    if not chosen:
        print("Nada novo para importar.")
        return 0
    for c in chosen:
        if gh.create_blob(c["data"]) != c["sha"]:
            raise Falha("O GitHub devolveu um hash diferente; importação abortada.", 3)

    def build(current: Dict[str, str], head: str):
        taken: Dict[str, set] = {}
        entries, credits_new = [], []
        for c in chosen:
            names = taken.setdefault(c["dir"], {p.rsplit("/", 1)[1].lower() for p in current if p.rsplit("/", 1)[0] == c["dir"]})
            path = f"{c['dir']}/{unique_name(c['name'], names)}"
            entries.append({"path": path, "sha": c["sha"]})
            credits_new.append({"file": path, **c["credit"]})
        credits = gh.read_json(current, "credits.json", [])
        credits = (credits if isinstance(credits, list) else []) + credits_new
        entries.append({"path": "credits.json", "content": json_text(credits)})
        return entries, f"Importa {plural(len(chosen), 'som', 'sons')} do Freesound", len(chosen)

    count = gh.commit(build)
    print(f"Pronto ✓ {plural(count, 'som importado', 'sons importados')} com créditos. O site publica em 1–3 min.")
    return 0


def cmd_token(args) -> int:
    kr = _keyring()
    if not kr:
        raise Falha("Instale o keyring para guardar no cofre do sistema:  pip install keyring\n"
                    "Ou defina a variável de ambiente JOGATINA_TOKEN / FREESOUND_API_KEY.", 2)
    account, label = ("freesound", "Chave da API do Freesound") if args.freesound else ("github", "Token do GitHub (fine-grained)")
    value = getpass.getpass(f"{label} (não aparece na tela): ").strip()
    if not value:
        raise Falha("Nada digitado.", 2)
    kr.set_password(KEYRING_SERVICE, account, value)
    print("Guardado no cofre do sistema ✓")
    return 0


# ---------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="sincronizar.py", description="Sincroniza sons do Jogatina com o repositório (sem git).")
    sub = p.add_subparsers(dest="cmd", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--repo", default=DEFAULT_REPO, help="dono/repositório (padrão: %(default)s)")
    common.add_argument("--simular", action="store_true", help="mostra o que faria, sem mudar nada")
    common.add_argument("--sim", action="store_true", help="não pede confirmação")
    for name, help_text in (("status", "compara a pasta com o repositório"),
                            ("enviar", "envia sons novos/alterados"),
                            ("baixar", "baixa sons do repositório para a pasta")):
        sp = sub.add_parser(name, parents=[common], help=help_text)
        sp.add_argument("pasta", nargs="?", default=DEFAULT_FOLDER)
        if name != "status":
            sp.add_argument("--apagar", action="store_true", help="espelha: remove o que sobrar do outro lado")
    fs = sub.add_parser("freesound", parents=[common], help="busca e importa sons do Freesound (com créditos)")
    fs.add_argument("busca", nargs="?")
    fs.add_argument("--tema", help='destino "Grupo/Tema"')
    fs.add_argument("--quantos", type=int, default=3)
    fs.add_argument("--licenca", choices=sorted(LICENSES), default="by", help="cc0 · by (CC0 + Atribuição, padrão) · todas")
    fs.add_argument("--min", type=float, default=1, help="duração mínima (s)")
    fs.add_argument("--max", type=float, default=900, help="duração máxima (s)")
    fs.add_argument("--lote", help="arquivo JSON com várias buscas (ex.: ferramentas/heroes_queries.json)")
    tk = sub.add_parser("token", help="guarda o token no cofre do sistema")
    tk.add_argument("--freesound", action="store_true", help="guardar a chave do Freesound")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "token":
            return cmd_token(args)
        gh = GitHub(args.repo, None)
        needs_token = args.cmd in {"enviar", "freesound"} and not args.simular
        gh.token = get_secret(["JOGATINA_TOKEN", "GITHUB_TOKEN"], "github", "Token do GitHub", required=needs_token)
        if args.cmd == "freesound":
            return cmd_freesound(gh, args)
        folder = Path(args.pasta).expanduser().resolve()
        return {"status": cmd_status, "enviar": cmd_enviar, "baixar": cmd_baixar}[args.cmd](gh, folder, args)
    except Falha as e:
        print(f"Erro: {e}", file=sys.stderr)
        return e.code
    except KeyboardInterrupt:
        print("\nInterrompido.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
