// Cofre do token (js/vault.js): cifra com senha, não abre com senha errada, nunca guarda o token em claro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seal, open, MIN_PASSWORD } from "../../js/vault.js";

const TOKEN = "github_pat_11ABCDEF_segredo";
const FAST = 1000;   // iterações reduzidas só para o teste ser rápido (o app usa 310 mil)

test("cifra e decifra com a senha certa", async () => {
  const rec = await seal(TOKEN, "minha senha", FAST);
  assert.equal(await open(rec, "minha senha"), TOKEN);
});

test("senha errada não abre", async () => {
  const rec = await seal(TOKEN, "minha senha", FAST);
  await assert.rejects(open(rec, "outra senha"), (e) => e.wrongPassword === true);
});

test("o registro salvo não contém o token", async () => {
  const rec = await seal(TOKEN, "minha senha", FAST);
  const saved = JSON.stringify(rec);
  assert.ok(!saved.includes(TOKEN));
  assert.ok(!saved.includes("github_pat"));
  assert.equal(rec.kdf, "PBKDF2-SHA256");
});

test("sal e IV aleatórios: mesma entrada, cifras diferentes", async () => {
  const a = await seal(TOKEN, "minha senha", FAST);
  const b = await seal(TOKEN, "minha senha", FAST);
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
});

test("adulteração é detectada", async () => {
  const rec = await seal(TOKEN, "minha senha", FAST);
  const ct = Buffer.from(rec.ct, "base64");
  ct[0] ^= 1;
  await assert.rejects(open({ ...rec, ct: ct.toString("base64") }, "minha senha"));
});

test("senha curta é recusada", async () => {
  await assert.rejects(seal(TOKEN, "12345".slice(0, MIN_PASSWORD - 1), FAST), /pelo menos/);
});

test("padrão de produção: 310 mil iterações", async () => {
  const rec = await seal(TOKEN, "minha senha");
  assert.equal(rec.iter, 310000);
  assert.equal(await open(rec, "minha senha"), TOKEN);
});
