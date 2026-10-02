#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera playlist.json para o Jogatina Soundboard.

Estrutura:  audio/<Grupo>/<Tema>/<Som>.mp3
  ex.:      audio/Ambientes/Chuva e Tempestade/Chuva constante.mp3

- O nome do arquivo vira o título do som ("_" e "-" viram espaço).
- A duração (segundos) é lida com a biblioteca mutagen, se instalada
  (pip install mutagen); sem ela, reaproveita a do playlist.json atual.
  O app usa a duração para decidir: som curto = efeito (toca 1×), longo = loop.

O GitHub Action roda este script sozinho a cada push em audio/.
Uso manual: python ferramentas/gerar_playlist.py
"""

from __future__ import annotations
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

EXT_OK = {".mp3", ".wav", ".ogg", ".m4a", ".mpeg"}

try:
    import mutagen  # type: ignore
except ImportError:
    mutagen = None


def sort_key(text: str) -> str:
    """Ordem alfabética ignorando acentos e maiúsculas (igual ao upload.js)."""
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).lower()


def nice_title(file_name: str) -> str:
    return re.sub(r"[_-]+", " ", Path(file_name).stem).strip()


def read_duration(path: Path) -> Optional[float]:
    if mutagen is None:
        return None
    try:
        audio = mutagen.File(path)   # sem tags ele "parece vazio": comparar com None
        return float(audio.info.length) if audio is not None and audio.info else None
    except Exception:
        return None


def round_duration(seconds: float):
    d = round(seconds, 1)
    return int(d) if d == int(d) else d


def build_playlist(project_dir: Path, old: Dict[str, Any]) -> Dict[str, Any]:
    audio_root = project_dir / "audio"
    if not audio_root.is_dir():
        raise FileNotFoundError("Não achei a pasta 'audio/'.")

    old_durations = {
        it["url"]: it["duration"]
        for t in old.get("themes", []) for it in t.get("items", [])
        if isinstance(it, dict) and "duration" in it
    }

    themes: Dict[tuple, List[Path]] = {}
    for f in audio_root.rglob("*"):
        if not (f.is_file() and f.suffix.lower() in EXT_OK):
            continue
        parts = f.parent.relative_to(audio_root).parts
        if not parts:
            key = ("", "Outros")                       # arquivo solto em audio/
        elif len(parts) == 1:
            key = ("", parts[0])                       # audio/<Tema>/
        else:
            key = (parts[0], " / ".join(parts[1:]))    # audio/<Grupo>/<Tema>/
        themes.setdefault(key, []).append(f)

    out: List[Dict[str, Any]] = []
    for (group, name) in sorted(themes, key=lambda k: (sort_key(k[0]), sort_key(k[1]))):
        items = []
        for f in sorted(themes[(group, name)], key=lambda p: (sort_key(p.stem), sort_key(p.name))):
            url = f.relative_to(project_dir).as_posix()
            item: Dict[str, Any] = {"title": nice_title(f.name), "file": f.name, "url": url}
            seconds = read_duration(f)
            if seconds is not None:
                item["duration"] = round_duration(seconds)
            elif url in old_durations:
                item["duration"] = old_durations[url]
            items.append(item)
        out.append({"name": name, "group": group, "count": len(items), "items": items})

    return {"themes": out, "generated": datetime.now().isoformat(timespec="seconds")}


def main() -> None:
    project_dir = Path(__file__).resolve().parent.parent
    out_path = project_dir / "playlist.json"
    try:
        old = json.loads(out_path.read_text(encoding="utf-8-sig"))
    except Exception:
        old = {}
    data = build_playlist(project_dir, old)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(t["count"] for t in data["themes"])
    print(f"OK: gerado {out_path} com {len(data['themes'])} tema(s) e {total} som(ns).")
    if mutagen is None:
        print("Aviso: mutagen não instalado (pip install mutagen); durações novas ficaram sem valor.")


if __name__ == "__main__":
    main()
