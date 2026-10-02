// Testes de ponta a ponta no navegador (Chromium/Playwright) com um GitHub falso que guarda
// blobs/árvores/commits de verdade. Rodar: npm run test:e2e  (precisa do playlist.json gerado:
// python ferramentas/gerar_playlist.py)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, extname, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OWNER_REPO = "pdfto314/test";
const TOKEN = "github_pat_TESTE_123";
const PASSWORD = "senha-forte";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".mp3": "audio/mpeg", ".webmanifest": "application/manifest+json" };

const gitSha = (buf) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");

/* ---------- servidor do site ---------- */
let server, base, browser, tmp;
let hidePlaylist = false;
before(async () => {
  if (!existsSync(join(ROOT, "playlist.json"))){
    execFileSync("python3", [join(ROOT, "ferramentas/gerar_playlist.py")]);
  }
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (hidePlaylist && path === "/playlist.json"){ res.writeHead(404); return res.end(); }
    let file = join(ROOT, path === "/" ? "index.html" : path);
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  tmp = mkdtempSync(join(tmpdir(), "jogatina-e2e-"));
});
after(async () => {
  await browser?.close();
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

/* ---------- GitHub falso (estado real de git) ---------- */
function fakeGitHub(){
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const put = (buf) => { const s = gitSha(buf); blobs.set(s, buf); return s; };
  const putTree = (flat) => { const s = createHash("sha1").update(JSON.stringify([...flat].sort())).digest("hex"); trees.set(s, new Map(flat)); return s; };
  const putCommit = (tree, parents, message) => { const s = createHash("sha1").update(tree + parents + message + commits.size).digest("hex"); commits.set(s, { tree, parents, message }); return s; };
  const initial = new Map();
  const walk = (dir) => {
    for (const name of execFileSync("ls", ["-A", dir]).toString().split("\n").filter(Boolean)){
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else initial.set(relative(ROOT, full).split(sep).join("/"), put(readFileSync(full)));
    }
  };
  walk(join(ROOT, "audio"));
  for (const f of ["index.html", "credits.json", "cenas.json"]) initial.set(f, put(readFileSync(join(ROOT, f))));
  const state = { ref: putCommit(putTree(initial), [], "inicial"), blobPosts: 0, messages: [] };
  const files = () => trees.get(commits.get(state.ref).tree);
  const read = (p) => blobs.get(files().get(p));

  async function handle(route){
    const req = route.request();
    const url = new URL(req.url());
    const path = decodeURIComponent(url.pathname);
    const method = req.method();
    const json = (obj, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(obj), headers: { "access-control-allow-origin": "*" } });
    const auth = req.headers()["authorization"];
    if (auth && auth !== `Bearer ${TOKEN}`) return json({ message: "Bad credentials" }, 401);
    if (method !== "GET" && !auth) return json({ message: "Requires authentication" }, 401);
    const b = `/repos/${OWNER_REPO}`;
    if (path === "/user") return json({ login: "mestre" });
    if (path === b) return json({ full_name: OWNER_REPO });
    if (path === `${b}/git/ref/heads/main`) return json({ object: { sha: state.ref } });
    if (path.startsWith(`${b}/git/commits/`) && method === "GET") return json({ tree: { sha: commits.get(path.split("/").pop()).tree } });
    if (path.startsWith(`${b}/git/trees/`) && method === "GET"){
      const id = path.split("/").pop();
      const flat = id === "main" ? files() : trees.get(id);
      return json({ tree: [...flat].map(([p, s]) => ({ path: p, type: "blob", sha: s })), truncated: false });
    }
    if (path.startsWith(`${b}/contents/`)){
      const p = path.slice(`${b}/contents/`.length);
      return files().has(p) ? json({ content: read(p).toString("base64"), sha: files().get(p) }) : json({ message: "Not Found" }, 404);
    }
    const body = method === "GET" ? null : JSON.parse(req.postData() || "{}");
    if (path === `${b}/git/blobs` && method === "POST"){
      state.blobPosts++;
      return json({ sha: put(body.encoding === "base64" ? Buffer.from(body.content, "base64") : Buffer.from(body.content)) }, 201);
    }
    if (path === `${b}/git/trees` && method === "POST"){
      const flat = new Map(trees.get(body.base_tree));
      for (const e of body.tree){
        if ("content" in e) flat.set(e.path, put(Buffer.from(e.content)));
        else if (e.sha === null) flat.delete(e.path);
        else if (blobs.has(e.sha)) flat.set(e.path, e.sha);
        else return json({ message: "sha inexistente" }, 422);
      }
      return json({ sha: putTree(flat) }, 201);
    }
    if (path === `${b}/git/commits` && method === "POST") return json({ sha: putCommit(body.tree, body.parents, body.message) }, 201);
    if (path === `${b}/git/refs/heads/main` && method === "PATCH"){
      const c = commits.get(body.sha);
      if (c.parents[0] !== state.ref) return json({ message: "not a fast forward" }, 422);
      state.ref = body.sha;
      state.messages.push(c.message);
      return json({ object: { sha: body.sha } });
    }
    return json({ message: `não simulado: ${method} ${path}` }, 500);
  }
  return { handle, files, read, state };
}

/* ---------- página ---------- */
async function openApp(gh){
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`erro JS: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_FAILED/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route("https://api.github.com/**", (r) => gh.handle(r));
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.click("#startBtn");
  await page.waitForSelector(".themeCard");
  return { page, context, problems };
}
async function connect(page){
  await page.click("#settingsBtn");
  await page.fill('#settingsConnect input[name="token"]', TOKEN);
  await page.fill('#settingsConnect input[name="pass"]', PASSWORD);
  await page.fill('#settingsConnect input[name="pass2"]', PASSWORD);
  await page.click("#settingsConnect button[type=submit]");
  await page.waitForSelector("#settingsConnect .connected");
  await page.locator("#settingsDlg [data-close]").click();
}

/* ---------- testes ---------- */
test("toca cena, abre tema, segura um som e liga o aleatório", async () => {
  const gh = fakeGitHub();
  const { page, context, problems } = await openApp(gh);
  await page.locator(".sceneCard", { hasText: "Floresta à noite" }).click();
  await page.waitForSelector(".sceneCard.active");
  assert.equal(await page.locator(".dockCard.loop").count(), 2);
  assert.equal(await page.locator(".dockCard.spot").count(), 2);
  await page.locator(".themeCard", { hasText: "Minotauro" }).click();
  await page.locator(".tile.fx").first().click();
  await page.waitForSelector(".tile.shot");
  await page.locator(".tile.loop").first().click({ button: "right" });
  await page.waitForSelector("#soundDlg[open]");
  await page.click('#soundDlg [data-act="spot"]');
  await page.waitForSelector("#soundDlg .segmented:not([hidden])");
  await page.locator("#soundDlg [data-close]").click();
  assert.ok(await page.locator(".tile.spot").count() >= 1);
  await page.click("#stopAllBtn");
  await page.waitForFunction(() => document.getElementById("playingCount").textContent === "0");
  assert.deepEqual(problems, []);
  await context.close();
});

test("token fica cifrado com senha, bloqueia e desbloqueia", async () => {
  const gh = fakeGitHub();
  const { page, context, problems } = await openApp(gh);
  await connect(page);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.ok(!storage.includes(TOKEN), "o token não pode aparecer em texto puro no localStorage");
  assert.ok(storage.includes("jogatina_gh_vault_v1"));

  // recarregar: o token some da memória → precisa da senha
  await page.reload();
  await page.click("#startBtn");
  await page.click("#uploadBtn");
  await page.waitForSelector("#unlockDlg[open]");
  await page.fill("#unlockPassword", "senha errada");
  await page.click("#unlockForm button");
  await page.waitForFunction(() => /incorreta/.test(document.getElementById("unlockStatus").textContent));
  await page.fill("#unlockPassword", PASSWORD);
  await page.click("#unlockForm button");
  await page.waitForSelector("#uploadDlg[open] #uploadForm:not([hidden])");
  assert.deepEqual(problems, []);
  await context.close();
});

test("envia arquivos e pastas: repetido é pulado, pastas viram temas, um único commit", async () => {
  const gh = fakeGitHub();
  const { page, context, problems } = await openApp(gh);
  await connect(page);
  await page.locator(".navBtn", { hasText: "Mar e Porto" }).click();

  // arquivos: um repetido (já está no repositório) e um novo
  const novo = join(tmp, "Lareira.mp3");
  writeFileSync(novo, Buffer.from("conteudo novo da lareira " + Date.now()));
  await page.click("#uploadBtn");
  await page.setInputFiles("#fileInput", [join(ROOT, "audio/Criaturas/Lobo/Uivo adulto.mp3"), novo]);
  // pasta "Taverna" com dois sons → vira o tema Ambientes/Taverna
  const pasta = join(tmp, "Taverna");
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, "Canecas.mp3"), "canecas");
  writeFileSync(join(pasta, "Porta rangendo.mp3"), "porta");
  await page.setInputFiles("#folderInput", pasta);
  const groups = await page.locator(".fileGroup").allTextContents();
  assert.ok(groups.some(g => g.includes("Ambientes / Mar e Porto")), groups.join(" | "));
  assert.ok(groups.some(g => g.includes("Ambientes / Taverna") && g.includes("novo")), groups.join(" | "));

  const postsBefore = gh.state.blobPosts;
  await page.click("#sendBtn");
  await page.waitForFunction(() => /Enviado|Não foi/.test(document.getElementById("uploadStatus").textContent));
  const status = await page.textContent("#uploadStatus");
  assert.match(status, /Enviado ✓ 3 sons novos · 1 repetido pulado/);
  assert.equal(gh.state.blobPosts - postsBefore, 3, "o repetido não pode ser enviado");
  assert.equal(gh.state.messages.length, 1, "um único commit");
  const files = gh.files();
  assert.ok(files.has("audio/Ambientes/Mar e Porto/Lareira.mp3"));
  assert.ok(files.has("audio/Ambientes/Taverna/Canecas.mp3"));
  assert.ok(files.has("audio/Ambientes/Taverna/Porta rangendo.mp3"));
  assert.ok(!files.has("audio/Ambientes/Mar e Porto/Uivo adulto.mp3"));
  assert.ok(!files.has("playlist.json"), "o app não grava playlist.json (é gerado no deploy)");
  assert.equal(gh.read("audio/Ambientes/Taverna/Canecas.mp3").toString(), "canecas");

  // a interface mostra os sons novos como "publicando…"
  await page.locator("#uploadDlg [data-close]").click();
  assert.ok(await page.locator(".tile.pending").count() >= 1);
  assert.deepEqual(problems, []);
  await context.close();
});

test("renomear/mover e remover pelo app mantém cenas e créditos consistentes", async () => {
  const gh = fakeGitHub();
  const { page, context, problems } = await openApp(gh);
  await connect(page);
  await page.locator(".navBtn", { hasText: "Coruja" }).click();
  await page.locator(".tile", { hasText: "Coruja na noite" }).click({ button: "right" });
  await page.click("#soundDlg [data-edit]");
  await page.waitForSelector("#editDlg[open]");
  await page.fill("#editName", "Pio da coruja");
  await page.selectOption("#editTheme", "Ambientes/Floresta e Campos");
  await page.click("#editSave");
  await page.waitForFunction(() => !document.getElementById("editDlg").open);
  const files = gh.files();
  assert.ok(!files.has("audio/Criaturas/Coruja/Coruja na noite.mp3"));
  assert.ok(files.has("audio/Ambientes/Floresta e Campos/Pio da coruja.mp3"));
  const cenas = JSON.parse(gh.read("cenas.json"));
  const spots = cenas.scenes.find(s => s.id === "floresta-noite").spots.map(s => s.url);
  assert.ok(spots.includes("audio/Ambientes/Floresta e Campos/Pio da coruja.mp3"));

  await page.locator(".navBtn", { hasText: "Chuva" }).click();
  await page.locator(".tile", { hasText: "Chuva constante" }).click({ button: "right" });
  await page.click("#soundDlg [data-edit]");
  await page.waitForSelector("#editDlg[open]");
  await page.click("#editDelete");
  await page.waitForFunction(() => !document.getElementById("editDlg").open);
  assert.ok(!gh.files().has("audio/Ambientes/Chuva e Tempestade/Chuva constante.mp3"));
  const credits = JSON.parse(gh.read("credits.json"));
  assert.ok(!credits.some(c => c.file.includes("Chuva constante")));
  assert.equal(gh.state.messages.length, 2);
  assert.deepEqual(problems, []);
  await context.close();
});

test("cena compartilhada vai para cenas.json", async () => {
  const gh = fakeGitHub();
  const { page, context, problems } = await openApp(gh);
  await connect(page);
  await page.locator(".navBtn", { hasText: "Mar e Porto" }).click();
  await page.locator(".tile.loop").first().click();
  await page.click("#scenesBtn");
  await page.fill("#sceneName", "Praia de teste");
  await page.click("#saveSceneForm button[type=submit]");
  await page.waitForFunction(() => [...document.querySelectorAll(".sceneText b")].some(b => b.textContent === "Praia de teste"));
  const cenas = JSON.parse(gh.read("cenas.json"));
  assert.ok(cenas.scenes.some(s => s.name === "Praia de teste" && s.ambients.length === 1));
  assert.deepEqual(problems, []);
  await context.close();
});

test("sem playlist.json (antes do primeiro deploy) a biblioteca vem da árvore do repositório", async () => {
  const gh = fakeGitHub();
  hidePlaylist = true;
  try{
    const { page, context, problems } = await openApp(gh);
    const count = await page.locator(".themeCard").count();
    assert.ok(count >= 15, `temas: ${count}`);
    await page.locator(".themeCard", { hasText: "Minotauro" }).click();
    assert.equal(await page.locator(".tile").count(), 8);
    assert.deepEqual(problems.filter(p => !/404/.test(p)), []);
    await context.close();
  }finally{
    hidePlaylist = false;
  }
});

test("sem conexão: enviar pede para conectar em Ajustes", async () => {
  const gh = fakeGitHub();
  const { page, context, problems } = await openApp(gh);
  await page.click("#uploadBtn");
  await page.waitForSelector("#uploadDlg[open] #uploadNeedAuth:not([hidden])");
  await page.click("#uploadOpenSettings");
  await page.waitForSelector("#settingsDlg[open] [data-connect]");
  assert.deepEqual(problems, []);
  await context.close();
});
