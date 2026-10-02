"""Testes do sincronizar.py contra um GitHub e um Freesound falsos (sem internet).

Rodar:  python -m unittest discover -s ferramentas/testes -v
"""
from __future__ import annotations

import contextlib
import importlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import mock_servidores as mock  # noqa: E402

REPO = "dono/repo"


class SincronizarTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.folder = self.tmp / "Sons"
        self.repo = mock.FakeRepo(REPO, {
            "index.html": b"<html>",
            "credits.json": json.dumps([{"file": "audio/Ambientes/Chuva/Chuva.mp3", "author": "x"}]).encode(),
            "audio/Ambientes/Chuva/Chuva.mp3": b"chuva" * 100,
            "audio/Criaturas/Lobo/Uivo.mp3": b"uivo" * 100,
        })
        self.server = mock.start(self.repo)
        port = self.server.server_address[1]
        os.environ.update({
            "JOGATINA_API": f"http://127.0.0.1:{port}",
            "JOGATINA_RAW": f"http://127.0.0.1:{port}/raw",
            "FREESOUND_API": f"http://127.0.0.1:{port}/fs",
            "JOGATINA_TOKEN": mock.TOKEN,
            "FREESOUND_API_KEY": mock.FS_KEY,
            "JOGATINA_REPO": REPO,
        })
        os.environ.pop("GITHUB_TOKEN", None)
        import sincronizar
        self.s = importlib.reload(sincronizar)
        self.s._keyring = lambda: None          # testes nunca usam o cofre real do sistema

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- ajudantes
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.s.main(list(argv))
        return code, out.getvalue() + err.getvalue()

    def put(self, rel: str, data: bytes):
        p = self.folder / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return p

    def mirror_remote(self):
        self.put("Ambientes/Chuva/Chuva.mp3", b"chuva" * 100)
        self.put("Criaturas/Lobo/Uivo.mp3", b"uivo" * 100)

    # --- enviar
    def test_enviar_novos_num_unico_commit(self):
        self.mirror_remote()
        self.put("Ambientes/Taverna/Lareira.mp3", b"fogo" * 300)
        self.put("Ambientes/Taverna/Canecas.mp3", b"caneca" * 200)
        self.put("Ambientes/Taverna/notas.txt", b"ignorar")
        code, out = self.run_cli("enviar", str(self.folder))
        self.assertEqual(code, 0, out)
        self.assertEqual(self.repo.commit_count, 1)
        self.assertEqual(self.repo.read("audio/Ambientes/Taverna/Lareira.mp3"), b"fogo" * 300)
        self.assertEqual(self.repo.read("audio/Ambientes/Taverna/Canecas.mp3"), b"caneca" * 200)
        self.assertNotIn("audio/Ambientes/Taverna/notas.txt", self.repo.files())
        self.assertIn("index.html", self.repo.files(), "não pode mexer no resto do site")
        self.assertEqual(self.repo.messages()[0], "Sincroniza sons: +2")

    def test_segunda_vez_nao_faz_nada(self):
        self.mirror_remote()
        self.put("Ambientes/Taverna/Lareira.mp3", b"fogo" * 300)
        self.run_cli("enviar", str(self.folder))
        posts = self.repo.blob_posts
        code, out = self.run_cli("enviar", str(self.folder))
        self.assertEqual(code, 0)
        self.assertIn("já tem tudo", out)
        self.assertEqual(self.repo.commit_count, 1)
        self.assertEqual(self.repo.blob_posts, posts)

    def test_alterado_e_movido_reaproveita_conteudo(self):
        self.put("Ambientes/Chuva/Chuva.mp3", b"chuva NOVA" * 100)          # alterado
        self.put("Criaturas/Lobo/Uivo.mp3", b"uivo" * 100)
        self.put("Criaturas/Lobo/Uivo copia.mp3", b"uivo" * 100)             # mesmo conteúdo, outro nome
        code, out = self.run_cli("enviar", str(self.folder))
        self.assertEqual(code, 0, out)
        self.assertEqual(self.repo.read("audio/Ambientes/Chuva/Chuva.mp3"), b"chuva NOVA" * 100)
        self.assertEqual(self.repo.read("audio/Criaturas/Lobo/Uivo copia.mp3"), b"uivo" * 100)
        self.assertEqual(self.repo.blob_posts, 1, "só o arquivo alterado precisa subir")

    def test_apagar_espelha_e_limpa_creditos(self):
        self.put("Criaturas/Lobo/Uivo.mp3", b"uivo" * 100)                  # Chuva.mp3 sumiu da pasta
        code, out = self.run_cli("enviar", str(self.folder), "--apagar", "--sim")
        self.assertEqual(code, 0, out)
        self.assertNotIn("audio/Ambientes/Chuva/Chuva.mp3", self.repo.files())
        self.assertEqual(json.loads(self.repo.read("credits.json")), [])

    def test_sem_apagar_nao_remove_nada(self):
        self.put("Criaturas/Lobo/Uivo.mp3", b"uivo" * 100)
        self.put("Criaturas/Lobo/Novo.mp3", b"novo")
        self.run_cli("enviar", str(self.folder))
        self.assertIn("audio/Ambientes/Chuva/Chuva.mp3", self.repo.files())

    def test_simular_nao_muda_nada(self):
        self.put("Ambientes/Taverna/Lareira.mp3", b"fogo")
        code, out = self.run_cli("enviar", str(self.folder), "--simular")
        self.assertEqual(code, 0)
        self.assertIn("simulação", out)
        self.assertEqual(self.repo.commit_count, 0)
        self.assertEqual(self.repo.blob_posts, 0)

    def test_corrida_refaz_sem_perder_commit_alheio(self):
        self.mirror_remote()
        self.put("Ambientes/Taverna/Lareira.mp3", b"fogo")
        self.repo.conflicts = 1
        code, out = self.run_cli("enviar", str(self.folder))
        self.assertEqual(code, 0, out)
        files = self.repo.files()
        self.assertIn("audio/Ambientes/Taverna/Lareira.mp3", files)
        self.assertIn("audio/Outros/Externo/feito-por-outro.mp3", files, "o commit da outra pessoa tem que continuar lá")
        self.assertIn("refazendo", out)

    def test_token_invalido(self):
        os.environ["JOGATINA_TOKEN"] = "errado"
        self.put("Ambientes/Taverna/Lareira.mp3", b"fogo")
        code, out = self.run_cli("enviar", str(self.folder))
        self.assertEqual(code, 3)
        self.assertIn("Token inválido", out)
        self.assertEqual(self.repo.commit_count, 0)

    def test_pasta_vazia(self):
        code, out = self.run_cli("enviar", str(self.folder))
        self.assertEqual(code, 2)
        self.assertIn("Nenhum áudio", out)

    def test_nomes_com_acento_sao_normalizados(self):
        import unicodedata
        nfd = unicodedata.normalize("NFD", "Ambientes/Tensão/Ação.mp3")     # como o macOS grava
        self.mirror_remote()
        self.put(nfd, b"acao")
        self.run_cli("enviar", str(self.folder))
        self.assertIn("audio/Ambientes/Tensão/Ação.mp3", self.repo.files())

    # --- status / baixar
    def test_status(self):
        self.put("Ambientes/Chuva/Chuva.mp3", b"chuva" * 100)
        self.put("Ambientes/Taverna/Lareira.mp3", b"fogo")
        code, out = self.run_cli("status", str(self.folder))
        self.assertEqual(code, 0)
        self.assertIn("novos na pasta: 1", out)
        self.assertIn("só no repositório: 1", out)

    def test_baixar_sem_token_usa_raw(self):
        os.environ.pop("JOGATINA_TOKEN")
        code, out = self.run_cli("baixar", str(self.folder))
        self.assertEqual(code, 0, out)
        self.assertEqual((self.folder / "Ambientes/Chuva/Chuva.mp3").read_bytes(), b"chuva" * 100)
        self.assertEqual((self.folder / "Criaturas/Lobo/Uivo.mp3").read_bytes(), b"uivo" * 100)
        code, out = self.run_cli("baixar", str(self.folder))
        self.assertIn("já está igual", out)

    def test_baixar_com_token_e_apagar_local(self):
        self.put("Lixo/Velho/antigo.mp3", b"velho")
        self.put("Ambientes/Chuva/Chuva.mp3", b"versao local diferente")
        code, out = self.run_cli("baixar", str(self.folder), "--apagar", "--sim")
        self.assertEqual(code, 0, out)
        self.assertFalse((self.folder / "Lixo/Velho/antigo.mp3").exists())
        self.assertEqual((self.folder / "Ambientes/Chuva/Chuva.mp3").read_bytes(), b"chuva" * 100)
        self.assertFalse(list(self.folder.rglob("*.baixando")))

    # --- Freesound
    def test_freesound_importa_com_creditos(self):
        code, out = self.run_cli("freesound", "owl hoot", "--tema", "Criaturas/Coruja", "--quantos", "2")
        self.assertEqual(code, 0, out)
        files = self.repo.files()
        self.assertIn("audio/Criaturas/Coruja/Owl Hoot 1.mp3", files)
        self.assertIn("audio/Criaturas/Coruja/Owl Hoot 2.mp3", files)
        self.assertNotIn("audio/Criaturas/Coruja/Owl Hoot 3.mp3", files)
        credits = json.loads(self.repo.read("credits.json"))
        self.assertEqual(len(credits), 3)
        self.assertEqual(credits[1]["file"], "audio/Criaturas/Coruja/Owl Hoot 1.mp3")
        self.assertEqual(credits[1]["author"], "autor1")
        self.assertEqual(self.repo.commit_count, 1)

    def test_freesound_nao_repete(self):
        self.run_cli("freesound", "owl hoot", "--tema", "Criaturas/Coruja", "--quantos", "2")
        code, out = self.run_cli("freesound", "owl hoot", "--tema", "Criaturas/Coruja", "--quantos", "2")
        self.assertEqual(code, 0, out)
        self.assertIn("já existe", out)
        self.assertNotIn("audio/Criaturas/Coruja/Owl Hoot 1 (2).mp3", self.repo.files())

    def test_freesound_lote(self):
        lote = self.tmp / "lote.json"
        lote.write_text(json.dumps({"max_per_category": 1, "categories": [
            {"folder": "Criaturas/Goblin", "queries": ["goblin laugh"]},
            {"folder": "Ambientes/Chuva", "queries": ["rain"]}]}), encoding="utf-8")
        code, out = self.run_cli("freesound", "--lote", str(lote))
        self.assertEqual(code, 0, out)
        files = self.repo.files()
        self.assertIn("audio/Criaturas/Goblin/Goblin Laugh 1.mp3", files)
        self.assertIn("audio/Ambientes/Chuva/Rain 1.mp3", files)

    def test_freesound_chave_errada(self):
        os.environ["FREESOUND_API_KEY"] = "errada"
        code, out = self.run_cli("freesound", "owl", "--tema", "Criaturas/Coruja")
        self.assertEqual(code, 2)
        self.assertIn("Freesound inválida", out)

    def test_freesound_tema_invalido(self):
        code, out = self.run_cli("freesound", "owl", "--tema", "../..")
        self.assertEqual(code, 2)

    def test_lote_do_projeto_e_valido(self):
        cfg = json.loads((HERE.parent / "heroes_queries.json").read_text(encoding="utf-8"))
        for cat in cfg["categories"]:
            self.assertTrue(self.s.parse_theme(cat["folder"]).startswith("audio/"))
            self.assertEqual(len(cat["folder"].split("/")), 2, cat["folder"])


if __name__ == "__main__":
    unittest.main()
