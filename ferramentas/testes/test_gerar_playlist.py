"""Testes do gerar_playlist.py (o mesmo que roda no deploy)."""
from __future__ import annotations

import importlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE.parent))

# dois mp3 reais e pequenos do acervo (para testar a leitura de duração)
CURTO = ROOT / "audio/Criaturas/Aranha/Aranha recebe ataque.mp3"   # ~0,7 s
LONGO = ROOT / "audio/Criaturas/Cavalo/Trote.mp3"                   # ~13 s


class GerarPlaylistTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        import gerar_playlist
        self.g = importlib.reload(gerar_playlist)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def put(self, rel, src=CURTO):
        p = self.tmp / "audio" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, p)

    def build(self, old=None):
        return self.g.build_playlist(self.tmp, old or {})

    def test_grupos_temas_e_ordem_sem_acento(self):
        self.put("Trilhas/Tensão e Mistério/b.mp3")
        self.put("Ambientes/Chuva/zeta.mp3")
        self.put("Ambientes/Chuva/Água_fria-1.mp3")
        self.put("Ambientes/Chuva/agua.mp3")
        self.put("Solto/x.mp3")
        self.put("raiz.mp3")
        data = self.build()
        keys = [(t["group"], t["name"]) for t in data["themes"]]
        self.assertEqual(keys, [("", "Outros"), ("", "Solto"), ("Ambientes", "Chuva"), ("Trilhas", "Tensão e Mistério")])
        chuva = data["themes"][2]
        self.assertEqual([i["file"] for i in chuva["items"]], ["agua.mp3", "Água_fria-1.mp3", "zeta.mp3"])
        self.assertEqual(chuva["items"][1]["title"], "Água fria 1")
        self.assertEqual(chuva["items"][1]["url"], "audio/Ambientes/Chuva/Água_fria-1.mp3")
        self.assertEqual(chuva["count"], 3)

    def test_ignora_o_que_nao_e_audio(self):
        self.put("Ambientes/Chuva/a.mp3")
        (self.tmp / "audio/Ambientes/Chuva/leia.txt").write_text("x")
        self.assertEqual(self.build()["themes"][0]["count"], 1)

    @unittest.skipIf(getattr(importlib.import_module("gerar_playlist"), "mutagen", None) is None, "mutagen não instalado")
    def test_duracao_real(self):
        self.put("Criaturas/Aranha/curto.mp3", CURTO)
        self.put("Criaturas/Cavalo/longo.mp3", LONGO)
        items = {i["file"]: i for t in self.build()["themes"] for i in t["items"]}
        self.assertAlmostEqual(items["curto.mp3"]["duration"], 0.7, delta=0.2)
        self.assertAlmostEqual(items["longo.mp3"]["duration"], 13, delta=1)

    def test_reaproveita_duracao_antiga_sem_mutagen(self):
        self.put("Ambientes/Chuva/a.mp3")
        self.g.mutagen = None
        old = {"themes": [{"items": [{"url": "audio/Ambientes/Chuva/a.mp3", "duration": 42}]}]}
        self.assertEqual(self.build(old)["themes"][0]["items"][0]["duration"], 42)

    def test_main_grava_arquivo(self):
        self.put("Ambientes/Chuva/a.mp3")
        tools = self.tmp / "ferramentas"
        tools.mkdir()
        shutil.copy(HERE.parent / "gerar_playlist.py", tools / "gerar_playlist.py")
        import runpy
        runpy.run_path(str(tools / "gerar_playlist.py"), run_name="__main__")
        data = json.loads((self.tmp / "playlist.json").read_text(encoding="utf-8"))
        self.assertEqual(data["themes"][0]["items"][0]["url"], "audio/Ambientes/Chuva/a.mp3")


if __name__ == "__main__":
    unittest.main()
