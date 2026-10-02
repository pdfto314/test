/* Motor de áudio
   - Cada som passa por um GainNode (no iPad o volume do <audio> é somente leitura)
   - Dois canais: ambiente (loops) e efeitos (1× e aleatórios), somados num analisador (visualizador)
   - Loops com fade; "aleatórios" tocam um efeito de tempos em tempos */
import { LS, readJson, writeJson, clamp01 } from "./util.js";

const FADE_IN = 1.2;
const FADE_OUT = 0.9;
const MUSIC_XFADE = 2.5;

export const SPOT_FREQS = {
  often:     { label: "Frequente", range: [8, 25] },
  sometimes: { label: "Às vezes",  range: [25, 75] },
  rare:      { label: "Raro",      range: [75, 200] },
};

export const loops = new Map();   // url -> player
export const shots = new Map();   // url -> player (toca 1×)
export const spots = new Map();   // url -> { freq, timer, next }
export let trackVol = readJson(LS.trackVol, {});

let hooks = { isMusic: () => false, titleOf: (u) => u, onError: () => {}, onRemember: () => {} };
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let emitQueued = false;
function emit(){
  // agrupa várias mudanças no mesmo instante num único redesenho
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; for (const fn of listeners) fn(); });
}
export function configure(h){ hooks = { ...hooks, ...h }; }

/* ---------- contexto ---------- */
let ctx = null, ambBus = null, fxBus = null, analyser = null;
let masterAmb = 0.7, masterFx = 0.9;

export function ensureAudio(){
  if (!ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.82;
    analyser.connect(ctx.destination);
    ambBus = ctx.createGain();
    fxBus = ctx.createGain();
    ambBus.gain.value = masterAmb;
    fxBus.gain.value = masterFx;
    ambBus.connect(analyser);
    fxBus.connect(analyser);
  }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
}
export const audioReady = () => Boolean(ctx);
export function resumeIfSuspended(){
  if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
}

/* níveis de frequência (0..255) para o visualizador */
let freqData = null;
export function readLevels(){
  if (!analyser) return null;
  freqData ??= new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);
  return freqData;
}

function ramp(param, value, secs){
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(value, t + secs);
}

/* ---------- volumes ---------- */
export function getVol(url){
  const v = trackVol[url];
  return typeof v === "number" ? clamp01(v) : 1;
}
export function setVol(url, v){
  trackVol[url] = clamp01(v);
  writeJson(LS.trackVol, trackVol);
  for (const p of [loops.get(url), shots.get(url)]){
    if (p) ramp(p.gain.gain, trackVol[url], 0.05);
  }
}
export function mergeVols(vols){
  if (!vols || typeof vols !== "object") return;
  trackVol = { ...trackVol, ...vols };
  writeJson(LS.trackVol, trackVol);
}
export function replaceVols(vols){
  trackVol = vols;
  writeJson(LS.trackVol, trackVol);
}
export function setMasters(amb, fx){
  masterAmb = clamp01(amb);
  masterFx = clamp01(fx);
  if (!ctx) return;
  ramp(ambBus.gain, masterAmb, 0.05);
  ramp(fxBus.gain, masterFx, 0.05);
}

/* ---------- players ---------- */
function createPlayer(url, loop){
  ensureAudio();
  const el = new Audio();
  el.preload = "auto";
  el.loop = loop;
  el.src = url;
  const source = ctx.createMediaElementSource(el);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(loop ? ambBus : fxBus);
  return { url, el, source, gain, progress: 0 };
}
function disposePlayer(p){
  p.el.pause();
  try{ p.source.disconnect(); p.gain.disconnect(); }catch{}
  // libera a memória do arquivo (importante no iPad com muitos sons)
  p.el.removeAttribute("src");
  p.el.load();
}
function failed(map, p){
  if (map.get(p.url) !== p) return;   // já foi parado/substituído
  map.delete(p.url);
  disposePlayer(p);
  hooks.onError(p.url);
  emit();
}

/* ---------- loops (ambiente) ---------- */
export function startLoop(url, { exclusiveMusic = true } = {}){
  if (loops.has(url)) return;
  if (exclusiveMusic && hooks.isMusic(url) && readJson(LS.prefs, {}).oneMusic !== false){
    // uma trilha por vez: a anterior sai devagar enquanto a nova entra
    for (const other of [...loops.keys()]){
      if (other !== url && hooks.isMusic(other)) stopLoop(other, MUSIC_XFADE);
    }
  }
  const p = createPlayer(url, true);
  loops.set(url, p);
  hooks.onRemember(url);
  p.el.addEventListener("error", () => failed(loops, p));
  p.el.play()
    .then(() => { if (loops.get(url) === p) ramp(p.gain.gain, getVol(url), FADE_IN); })
    .catch(() => failed(loops, p));
  emit();
}
export function stopLoop(url, fade = FADE_OUT){
  const p = loops.get(url);
  if (!p) return;
  loops.delete(url);
  ramp(p.gain.gain, 0, fade);
  setTimeout(() => disposePlayer(p), fade * 1000 + 100);
  emit();
}
export function toggleLoop(url){
  if (loops.has(url)) stopLoop(url);
  else startLoop(url);
}

/* ---------- efeitos (1×) ---------- */
export function playShot(url, { fromSpot = false } = {}){
  const existing = shots.get(url);
  if (existing){
    if (fromSpot) return;          // aleatório não reinicia um efeito que já está tocando
    existing.el.currentTime = 0;
    existing.el.play().catch(() => {});
    hooks.onRemember(url);
    return;
  }
  const p = createPlayer(url, false);
  p.fromSpot = fromSpot;
  p.gain.gain.value = getVol(url);
  shots.set(url, p);
  if (!fromSpot) hooks.onRemember(url);
  p.el.addEventListener("ended", () => {
    if (shots.get(url) !== p) return;
    shots.delete(url);
    disposePlayer(p);
    emit();
  });
  p.el.addEventListener("timeupdate", () => {
    const d = p.el.duration;
    if (d && isFinite(d)) p.progress = Math.min(1, p.el.currentTime / d);
    for (const fn of progressListeners) fn(url, p.progress);
  });
  p.el.addEventListener("error", () => failed(shots, p));
  p.el.play().catch(() => failed(shots, p));
  emit();
}
export function stopShot(url){
  const p = shots.get(url);
  if (!p) return;
  shots.delete(url);
  disposePlayer(p);
  emit();
}
const progressListeners = new Set();
export const onProgress = (fn) => progressListeners.add(fn);

/* ---------- aleatórios: tocam sozinhos de tempos em tempos ---------- */
function scheduleSpot(url, first = false){
  const s = spots.get(url);
  if (!s) return;
  const [min, max] = SPOT_FREQS[s.freq]?.range ?? SPOT_FREQS.sometimes.range;
  const secs = first ? 2 + Math.random() * Math.min(10, min) : min + Math.random() * (max - min);
  s.next = Date.now() + secs * 1000;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    if (!spots.has(url)) return;
    playShot(url, { fromSpot: true });
    scheduleSpot(url);
  }, secs * 1000);
}
export function startSpot(url, freq = "sometimes"){
  ensureAudio();
  const existing = spots.get(url);
  if (existing){ setSpotFreq(url, freq); return; }
  spots.set(url, { freq: SPOT_FREQS[freq] ? freq : "sometimes", timer: 0, next: 0 });
  hooks.onRemember(url);
  scheduleSpot(url, true);
  emit();
}
export function stopSpot(url){
  const s = spots.get(url);
  if (!s) return;
  clearTimeout(s.timer);
  spots.delete(url);
  const p = shots.get(url);
  if (p?.fromSpot) stopShot(url);
  emit();
}
export function setSpotFreq(url, freq){
  const s = spots.get(url);
  if (!s || !SPOT_FREQS[freq]) return;
  s.freq = freq;
  scheduleSpot(url);
  emit();
}
export const toggleSpot = (url, freq) => spots.has(url) ? stopSpot(url) : startSpot(url, freq);

/* ---------- geral ---------- */
export function stopAll(fade = 1.5){
  for (const url of [...spots.keys()]) stopSpot(url);
  for (const url of [...loops.keys()]) stopLoop(url, fade);
  for (const url of [...shots.keys()]) stopShot(url);
  emit();
}
export const isPlaying = (url) => loops.has(url) || shots.has(url) || spots.has(url);
export const activeCount = () => loops.size + spots.size + [...shots.values()].filter(p => !p.fromSpot).length;

/* aplica uma cena: o que sai some devagar, o que fica ajusta o volume, o que entra aparece */
export function applyMix({ ambients = [], spots: spotList = [], fx = [] }, fade = 1.5){
  ensureAudio();
  const wantLoops = new Set(ambients);
  for (const url of [...loops.keys()]){
    if (!wantLoops.has(url)) stopLoop(url, fade);
  }
  for (const url of wantLoops){
    const p = loops.get(url);
    if (p) ramp(p.gain.gain, getVol(url), 0.3);
    else startLoop(url, { exclusiveMusic: false });
  }
  const wantSpots = new Map(spotList.map(s => [s.url, s.freq]));
  for (const url of [...spots.keys()]){
    if (!wantSpots.has(url)) stopSpot(url);
  }
  for (const [url, freq] of wantSpots) startSpot(url, freq);
  for (const url of fx) playShot(url);   // sets antigos guardavam efeitos
  emit();
}

export function currentMix(){
  return {
    ambients: [...loops.keys()],
    spots: [...spots.entries()].map(([url, s]) => ({ url, freq: s.freq })),
  };
}
