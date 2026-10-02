// Regras puras (js/rules.js): nomes, destino das pastas, hash do git, consistência de cenas/créditos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanFileName, uniqueName, destinationFor, gitBlobSha, bytesToBase64, fixCredits, fixScenes,
  playlistFromPaths, normalizePlaylist, ensureTheme, makeItem, isAudioName, themeDir,
} from "../../js/rules.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("nomes de arquivo seguros para URL", () => {
  assert.equal(cleanFileName("  Lareira #1 (100%).MP3 "), "Lareira _1 (100_).mp3");
  assert.equal(cleanFileName("a/b\\c:d.wav"), "a_b_c_d.wav");
  assert.equal(cleanFileName(".mp3"), ".mp3");
  assert.equal(cleanFileName("Ação.mp3".normalize("NFD")), "Ação.mp3".normalize("NFC"));
  assert.ok(isAudioName("x.M4A"));
  assert.ok(!isAudioName("x.txt"));
});

test("nomes repetidos ganham (2), (3)…", () => {
  const taken = new Set(["uivo.mp3"]);
  assert.equal(uniqueName("Uivo.mp3", taken), "Uivo (2).mp3");
  assert.equal(uniqueName("Uivo.mp3", taken), "Uivo (3).mp3");
  assert.equal(uniqueName("Outro.mp3", taken), "Outro.mp3");
});

test("pastas viram grupo/tema", () => {
  const fb = { group: "Ambientes", name: "Chuva" };
  assert.deepEqual(destinationFor("x.mp3", fb), fb);
  assert.deepEqual(destinationFor("Taverna/x.mp3", fb), { group: "Ambientes", name: "Taverna" });
  assert.deepEqual(destinationFor("Criaturas/Goblin/x.mp3", fb), { group: "Criaturas", name: "Goblin" });
  assert.deepEqual(destinationFor("audio/Criaturas/Goblin/x.mp3", fb), { group: "Criaturas", name: "Goblin" });
  assert.deepEqual(destinationFor("Criaturas/Goblin/Chefes/x.mp3", fb), { group: "Criaturas", name: "Goblin / Chefes" });
  assert.equal(themeDir("Criaturas", "Goblin / Chefes"), "audio/Criaturas/Goblin/Chefes");
});

test("hash do git igual ao `git hash-object`", async () => {
  const file = join(ROOT, "audio/Criaturas/Aranha/Aranha recebe ataque.mp3");
  const expected = execFileSync("git", ["hash-object", file], { cwd: ROOT }).toString().trim();
  assert.equal(await gitBlobSha(readFileSync(file)), expected);
  assert.equal(await gitBlobSha(new Uint8Array()), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("base64 de arquivos grandes (em blocos)", () => {
  const big = new Uint8Array(200000).map((_, i) => i % 256);
  assert.equal(bytesToBase64(big), Buffer.from(big).toString("base64"));
});

test("mover/remover som atualiza créditos e cenas", () => {
  const credits = [{ file: "audio/a.mp3", author: "x" }, { file: "audio/b.mp3" }];
  assert.ok(fixCredits(credits, "audio/a.mp3", "audio/z.mp3"));
  assert.equal(credits[0].file, "audio/z.mp3");
  assert.ok(fixCredits(credits, "audio/b.mp3", null));
  assert.equal(credits.length, 1);
  assert.ok(!fixCredits(credits, "audio/nada.mp3", null));

  const data = { scenes: [{ ambients: ["audio/a.mp3", "audio/c.mp3"], spots: [{ url: "audio/a.mp3", freq: "rare" }], trackVol: { "audio/a.mp3": 0.4 } }] };
  assert.ok(fixScenes(data, "audio/a.mp3", "audio/z.mp3"));
  assert.deepEqual(data.scenes[0], { ambients: ["audio/z.mp3", "audio/c.mp3"], spots: [{ url: "audio/z.mp3", freq: "rare" }], trackVol: { "audio/z.mp3": 0.4 } });
  assert.ok(fixScenes(data, "audio/z.mp3", null));
  assert.deepEqual(data.scenes[0], { ambients: ["audio/c.mp3"], spots: [], trackVol: {} });
});

test("biblioteca a partir da árvore do git", () => {
  const p = playlistFromPaths(["index.html", "audio/Ambientes/Chuva/b.mp3", "audio/Ambientes/Chuva/a.mp3", "audio/Solto/x.wav", "audio/leia.txt"]);
  assert.deepEqual(p.themes.map(t => [t.group, t.name, t.count]), [["", "Solto", 1], ["Ambientes", "Chuva", 2]]);
  assert.deepEqual(p.themes[1].items.map(i => i.file), ["a.mp3", "b.mp3"]);
});

test("playlist montada no app = playlist do gerar_playlist.py", { skip: !hasPython() }, () => {
  const dir = mkdtempSync(join(tmpdir(), "jogatina-"));
  try{
    const names = ["Ambientes/Chuva/zeta.mp3", "Ambientes/Chuva/Água_fria-1.mp3", "Ambientes/Chuva/agua.mp3",
      "Trilhas/Tensão e Mistério/Drone 2.mp3", "Trilhas/Tensão e Mistério/drone 10.mp3", "Criaturas/Coruja/Coruja na noite.mp3",
      "Criaturas/Coruja/Coruja.mp3", "Criaturas/Minotauro/À espreita.mp3", "Criaturas/Minotauro/Bufando.mp3", "Solto/x.mp3"];
    mkdirSync(join(dir, "ferramentas"));
    copyFileSync(join(ROOT, "ferramentas/gerar_playlist.py"), join(dir, "ferramentas/gerar_playlist.py"));
    for (const n of names){
      mkdirSync(join(dir, "audio", dirname(n)), { recursive: true });
      writeFileSync(join(dir, "audio", n), "x");
    }
    execFileSync("python3", [join(dir, "ferramentas/gerar_playlist.py")], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    const py = JSON.parse(readFileSync(join(dir, "playlist.json"), "utf8"));
    // o app adiciona item por item (ordem aleatória) e normaliza
    const js = { themes: [] };
    for (const n of [...names].reverse()){
      const dirs = n.split("/").slice(0, -1);
      const [group, name] = dirs.length >= 2 ? [dirs[0], dirs.slice(1).join(" / ")] : ["", dirs[0]];
      ensureTheme(js, group, name).items.push(makeItem(`audio/${n}`));
    }
    normalizePlaylist(js);
    const strip = (pl) => pl.themes.map(t => ({ name: t.name, group: t.group, count: t.count, items: t.items.map(({ duration, ...i }) => i) }));
    assert.deepEqual(strip(js), strip(py));
  }finally{
    rmSync(dir, { recursive: true, force: true });
  }
});

function hasPython(){
  try{ execFileSync("python3", ["--version"]); return true; }catch{ return false; }
}
