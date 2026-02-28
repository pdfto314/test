#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera playlist.json para Jogatina Soundboard

Suporta:
- audio/<Tema>/*.mp3
- audio/temas/<Tema>/*.mp3  (prioridade se existir)

Varre recursivamente dentro de cada tema (subpastas incluídas).
Gera URLs com "/" (compatível com GitHub Pages).
"""

from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Dict, List, Any

def find_audio_root(project_dir: Path) -> Path:
    cand1 = project_dir / "audio" / "temas"
    cand2 = project_dir / "audio"
    if cand1.exists() and cand1.is_dir():
        return cand1
    if cand2.exists() and cand2.is_dir():
        return cand2
    raise FileNotFoundError("Não achei 'audio/' nem 'audio/temas/'.")

def rel_url(base_dir: Path, file_path: Path) -> str:
    rel = file_path.relative_to(base_dir)
    return rel.as_posix()

def build_playlist(project_dir: Path) -> Dict[str, Any]:
    audio_root = find_audio_root(project_dir)

    # base_dir é a pasta do site (onde fica index.html), ou seja, project_dir
    base_dir = project_dir

    categories: List[Dict[str, Any]] = []
    for theme_dir in sorted([p for p in audio_root.iterdir() if p.is_dir()], key=lambda p: p.name.lower()):
        mp3_files = sorted(theme_dir.rglob("*.mp3"), key=lambda p: p.name.lower())
        if not mp3_files:
            continue

        items: List[Dict[str, Any]] = []
        for f in mp3_files:
            title = f.stem
            url = rel_url(base_dir, f)

            items.append({
                "title": title,
                # Mantém "ambience" por padrão; você pode mudar depois na UI p/ efeito
                "type": "ambience",
                "url": url,
                "loop": True,
                "volume": 0.8,
                "tags": [theme_dir.name],
            })

        categories.append({
            "name": theme_dir.name,
            "items": items,
        })

    return {"categories": categories}

def main() -> None:
    project_dir = Path(__file__).resolve().parent
    data = build_playlist(project_dir)
    out_path = project_dir / "playlist.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: gerado {out_path} com {len(data['categories'])} tema(s).")

if __name__ == "__main__":
    main()
