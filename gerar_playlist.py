#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera playlist.json para Jogatina Soundboard (mesmo formato do generate_playlist.bat)

Suporta:
- audio/<Tema>/*.mp3
- audio/temas/<Tema>/*.mp3  (prioridade se existir)

Varre recursivamente dentro de cada tema (subpastas incluídas).
Gera URLs com "/" (compatível com GitHub Pages).

Uso: python gerar_playlist.py
"""

from __future__ import annotations
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

EXT_OK = {".mp3", ".wav", ".ogg", ".m4a", ".mpeg"}


def find_audio_root(project_dir: Path) -> Path:
    for cand in (project_dir / "audio" / "temas", project_dir / "audio"):
        if cand.is_dir():
            return cand
    raise FileNotFoundError("Não achei 'audio/' nem 'audio/temas/'.")


def nice_title(file_name: str) -> str:
    return re.sub(r"[_-]+", " ", Path(file_name).stem).strip()


def build_playlist(project_dir: Path) -> Dict[str, Any]:
    audio_root = find_audio_root(project_dir)

    themes: List[Dict[str, Any]] = []
    for theme_dir in sorted((p for p in audio_root.iterdir() if p.is_dir()), key=lambda p: p.name.lower()):
        files = sorted(
            (f for f in theme_dir.rglob("*") if f.is_file() and f.suffix.lower() in EXT_OK),
            key=lambda f: f.relative_to(theme_dir).as_posix().lower(),
        )
        if not files:
            continue

        items = [{
            "title": nice_title(f.name),
            "file": f.relative_to(theme_dir).as_posix(),
            # URL relativa à pasta do site (onde fica index.html)
            "url": f.relative_to(project_dir).as_posix(),
        } for f in files]

        themes.append({"name": theme_dir.name, "count": len(items), "items": items})

    return {"themes": themes, "generated": datetime.now().isoformat(timespec="seconds")}


def main() -> None:
    project_dir = Path(__file__).resolve().parent
    data = build_playlist(project_dir)
    out_path = project_dir / "playlist.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(t["count"] for t in data["themes"])
    print(f"OK: gerado {out_path} com {len(data['themes'])} tema(s) e {total} arquivo(s).")


if __name__ == "__main__":
    main()
