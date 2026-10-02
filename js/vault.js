/* Cofre do token: o token do GitHub nunca fica salvo em texto puro.
   É cifrado com AES-GCM 256 usando uma chave derivada da senha (PBKDF2-SHA256, 310 mil iterações,
   sal aleatório). Só existe decifrado na memória, depois de desbloquear. Testado em tests/vault.test.mjs. */

export const ITERATIONS = 310000;
export const MIN_PASSWORD = 6;

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKey(password, salt, iterations){
  const base = await crypto.subtle.importKey("raw", enc.encode(String(password).normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(secret, password, iterations = ITERATIONS){
  if (String(password).length < MIN_PASSWORD) throw new Error(`a senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secret)));
  return { v: 1, kdf: "PBKDF2-SHA256", iter: iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

/* lança erro se a senha estiver errada (o AES-GCM detecta adulteração/senha incorreta) */
export async function open(record, password){
  if (!record || record.v !== 1) throw new Error("cofre inválido");
  const key = await deriveKey(password, fromB64(record.salt), record.iter);
  try{
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(record.iv) }, key, fromB64(record.ct));
    return dec.decode(pt);
  }catch{
    throw Object.assign(new Error("senha incorreta"), { wrongPassword: true });
  }
}
