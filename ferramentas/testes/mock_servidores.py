"""Servidores falsos (GitHub + Freesound) para testar o sincronizar.py sem internet.

O GitHub falso guarda blobs, árvores e commits de verdade (hash do git real), então os
testes verificam o conteúdo final do repositório, não só as chamadas.
"""
from __future__ import annotations

import base64
import hashlib
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "github_pat_bom"
FS_KEY = "chave-freesound"


def git_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


class FakeRepo:
    def __init__(self, repo: str, files: dict):
        self.repo = repo
        self.blobs = {}
        self.trees = {}
        self.commits = {}
        self.blob_posts = 0
        self.commit_count = 0
        self.conflicts = 0          # quantos PATCH de ref vão falhar com 422 (simula corrida)
        self.lock = threading.Lock()
        tree = {p: self.put_blob(d) for p, d in files.items()}
        self.ref = self.put_commit(self.put_tree(tree), [], "inicial")

    def put_blob(self, data: bytes) -> str:
        sha = git_sha(data)
        self.blobs[sha] = data
        return sha

    def put_tree(self, flat: dict) -> str:
        sha = hashlib.sha1(json.dumps(sorted(flat.items())).encode()).hexdigest()
        self.trees[sha] = dict(flat)
        return sha

    def put_commit(self, tree: str, parents: list, message: str) -> str:
        sha = hashlib.sha1(f"{tree}{parents}{message}{len(self.commits)}".encode()).hexdigest()
        self.commits[sha] = {"tree": tree, "parents": parents, "message": message}
        return sha

    # visão do estado atual
    def files(self) -> dict:
        return self.trees[self.commits[self.ref]["tree"]]

    def read(self, path: str) -> bytes:
        return self.blobs[self.files()[path]]

    def messages(self) -> list:
        out, sha = [], self.ref
        while sha:
            c = self.commits[sha]
            out.append(c["message"])
            sha = c["parents"][0] if c["parents"] else None
        return out

    def external_commit(self, path: str, data: bytes):
        """alguém mais mexeu no repositório ao mesmo tempo"""
        flat = dict(self.files())
        flat[path] = self.put_blob(data)
        self.ref = self.put_commit(self.put_tree(flat), [self.ref], "commit de outra pessoa")


class Handler(BaseHTTPRequestHandler):
    repo: FakeRepo = None  # type: ignore
    previews: dict = {}

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200, headers=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, data: bytes, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _auth_ok(self, required: bool) -> bool:
        auth = self.headers.get("Authorization")
        if auth is None:
            if required:
                self._json({"message": "Requires authentication"}, 401)
                return False
            return True
        if auth != f"Bearer {TOKEN}":
            self._json({"message": "Bad credentials"}, 401)
            return False
        return True

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)
        r = self.repo
        if path.startswith("/fs/"):
            return self._freesound(path, urllib.parse.parse_qs(url.query))
        if path.startswith("/raw/"):
            _, _, owner, name, ref, rel = path.split("/", 5)
            files = r.trees[r.commits[ref]["tree"]]
            if rel not in files:
                return self._bytes(b"404", 404)
            return self._bytes(r.blobs[files[rel]])
        if not self._auth_ok(required=False):
            return
        base = f"/repos/{r.repo}"
        with r.lock:
            if path == base:
                return self._json({"full_name": r.repo})
            if path == f"{base}/git/ref/heads/main":
                return self._json({"object": {"sha": r.ref}})
            if path.startswith(f"{base}/git/commits/"):
                return self._json({"tree": {"sha": r.commits[path.rsplit('/', 1)[1]]["tree"]}})
            if path.startswith(f"{base}/git/trees/"):
                flat = r.trees[path.rsplit("/", 1)[1]]
                return self._json({"tree": [{"path": p, "type": "blob", "sha": s} for p, s in sorted(flat.items())], "truncated": False})
            if path.startswith(f"{base}/git/blobs/"):
                data = r.blobs[path.rsplit("/", 1)[1]]
                return self._json({"content": base64.b64encode(data).decode(), "encoding": "base64"})
        return self._json({"message": "Not Found"}, 404)

    def do_POST(self):
        if not self._auth_ok(required=True):
            return
        r = self.repo
        base = f"/repos/{r.repo}"
        body = self._body()
        path = urllib.parse.urlparse(self.path).path
        with r.lock:
            if path == f"{base}/git/blobs":
                data = base64.b64decode(body["content"]) if body.get("encoding") == "base64" else body["content"].encode()
                r.blob_posts += 1
                return self._json({"sha": r.put_blob(data)}, 201)
            if path == f"{base}/git/trees":
                flat = dict(r.trees[body["base_tree"]])
                for e in body["tree"]:
                    if "content" in e:
                        flat[e["path"]] = r.put_blob(e["content"].encode())
                    elif e.get("sha") is None:
                        flat.pop(e["path"], None)
                    else:
                        if e["sha"] not in r.blobs:
                            return self._json({"message": "sha not found"}, 422)
                        flat[e["path"]] = e["sha"]
                return self._json({"sha": r.put_tree(flat)}, 201)
            if path == f"{base}/git/commits":
                return self._json({"sha": r.put_commit(body["tree"], body["parents"], body["message"])}, 201)
        return self._json({"message": "Not Found"}, 404)

    def do_PATCH(self):
        if not self._auth_ok(required=True):
            return
        r = self.repo
        body = self._body()
        with r.lock:
            if r.conflicts > 0:
                r.conflicts -= 1
                r.external_commit("audio/Outros/Externo/feito-por-outro.mp3", b"externo")
                return self._json({"message": "Update is not a fast forward"}, 422)
            new = body["sha"]
            if r.commits[new]["parents"] != [r.ref]:
                return self._json({"message": "Update is not a fast forward"}, 422)
            r.ref = new
            r.commit_count += 1
        return self._json({"object": {"sha": new}})

    def _freesound(self, path, qs):
        if path.startswith("/fs/preview/"):
            return self._bytes(self.previews[path.rsplit("/", 1)[1]])
        if self.headers.get("Authorization") != f"Token {FS_KEY}":
            return self._json({"detail": "Invalid token"}, 401)
        query = qs.get("query", [""])[0]
        port = self.server.server_address[1]
        results = []
        for i in range(1, 6):
            pid = f"{abs(hash(query)) % 1000}{i}.mp3"
            self.previews.setdefault(pid, f"{query}-{i}".encode() * 50)
            results.append({"id": i, "name": f"{query.title()} {i}.wav", "username": f"autor{i}", "duration": 5.0 + i,
                            "license": "http://creativecommons.org/publicdomain/zero/1.0/",
                            "url": f"https://freesound.org/s/{i}/",
                            "previews": {"preview-hq-mp3": f"http://127.0.0.1:{port}/fs/preview/{pid}"}})
        return self._json({"results": results})


def start(repo: FakeRepo):
    Handler.repo = repo
    Handler.previews = {}
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
