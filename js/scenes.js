/* Cenas: combinações de ambientes + aleatórios + volumes.
   - "Compartilhadas" ficam em cenas.json no repositório (aparecem em todos os aparelhos)
   - "Deste aparelho" ficam no localStorage */
import { $, LS, readJson, writeJson, escapeHtml, toast, wireDialog, themeStyle, plural } from "./util.js";
import { titleOf, themeOf } from "./library.js";
import * as engine from "./engine.js";
import { commit, readRepoJson, jsonText, explainError, hasVault, requireAuth, onAuthChange } from "./github.js";

let shared = readJson(LS.sharedCache, { scenes: [] }).scenes || [];
const listeners = new Set();
export const onScenesChange = (fn) => listeners.add(fn);
const emit = () => { for (const fn of listeners) fn(); };

/* ---------- dados ---------- */
function localSets(){
  const data = readJson(LS.sets, { sets: [] });
  return Array.isArray(data?.sets) ? data.sets : [];
}
function writeLocal(sets){ writeJson(LS.sets, { sets }); }

function fromLocal(s){
  const sc = s.scene || {};
  return {
    id: s.id, name: s.name, icon: s.icon || iconFor(sc.ambients), shared: false,
    ambients: sc.ambients || [], spots: sc.spots || [], fx: sc.fx || [],
    trackVol: sc.trackVol || {}, ambientVol: sc.ambientVol, fxVol: sc.fxVol,
  };
}
function fromShared(s){
  return { ...s, icon: s.icon || iconFor(s.ambients), shared: true, ambients: s.ambients || [], spots: s.spots || [], trackVol: s.trackVol || {} };
}
export function allScenes(){
  return [...shared.map(fromShared), ...localSets().map(fromLocal)];
}

export async function loadShared(){
  try{
    const res = await fetch(`cenas.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    setSharedData(await res.json());
  }catch{}
}
export function setSharedData(data){
  if (!Array.isArray(data?.scenes)) return;
  shared = data.scenes;
  writeJson(LS.sharedCache, { scenes: shared });
  emit();
}

/* atualiza cenas deste aparelho quando sons são renomeados/removidos */
export function fixLocalUrls(fix){
  writeLocal(localSets().map(s => {
    const sc = s.scene || {};
    return { ...s, scene: { ...sc,
      ambients: (sc.ambients || []).map(fix).filter(Boolean),
      fx: (sc.fx || []).map(fix).filter(Boolean),
      spots: (sc.spots || []).map(x => ({ ...x, url: fix(x.url) })).filter(x => x.url),
      trackVol: Object.fromEntries(Object.entries(sc.trackVol || {}).map(([u, v]) => [fix(u), v]).filter(([u]) => u)),
    } };
  }));
  emit();
}

function iconFor(urls){
  const t = (urls || []).map(themeOf).find(Boolean);
  return t ? themeStyle(t.name).icon : "🎬";
}
export function sceneHue(scene){
  const t = [...(scene.ambients || []), ...(scene.spots || []).map(s => s.url)].map(themeOf).find(Boolean);
  return t ? themeStyle(t.name).hue : 45;
}
export function sceneSummary(scene){
  const parts = [];
  if (scene.ambients.length) parts.push(plural(scene.ambients.length, "som", "sons"));
  if (scene.spots.length) parts.push(plural(scene.spots.length, "aleatório", "aleatórios"));
  return parts.join(" · ") || "vazia";
}
export function isActive(scene){
  const loops = new Set(engine.loops.keys());
  const spots = new Set(engine.spots.keys());
  if (!scene.ambients.length && !scene.spots.length) return false;
  return scene.ambients.length === loops.size && scene.ambients.every(u => loops.has(u)) &&
    scene.spots.length === spots.size && scene.spots.every(s => spots.has(s.url));
}

/* ---------- aplicar ---------- */
let hooks = { setMasters: () => {} };
export function applyScene(scene){
  engine.mergeVols(scene.trackVol);
  if (scene.ambientVol != null || scene.fxVol != null) hooks.setMasters(scene.ambientVol, scene.fxVol);
  engine.applyMix(scene);
  toast(`${scene.icon} ${scene.name}`);
}

/* ---------- salvar / compartilhar / excluir ---------- */
function snapshot(name){
  const mix = engine.currentMix();
  const urls = [...mix.ambients, ...mix.spots.map(s => s.url)];
  const trackVol = Object.fromEntries(urls.filter(u => engine.trackVol[u] != null).map(u => [u, engine.trackVol[u]]));
  return { name, icon: iconFor(urls), ambients: mix.ambients, spots: mix.spots, trackVol };
}
const newId = () => Math.random().toString(16).slice(2, 8) + Date.now().toString(36);

async function publishShared(scene, { removeId } = {}){
  if (!(await requireAuth())) throw Object.assign(new Error("cancelado"), { cancelled: true });
  return commit(async ({ head }) => {
    const data = await readRepoJson("cenas.json", head, { scenes: [] });
    data.scenes = (data.scenes || []).filter(s => s.id !== removeId && s.id !== scene?.id);
    if (scene) data.scenes.push(scene);
    const message = scene ? `Cena compartilhada: ${scene.name}` : `Remove cena compartilhada`;
    return { tree: [{ path: "cenas.json", content: jsonText(data) }], message, result: data };
  });
}

export function initScenes({ setMasters }){
  hooks.setMasters = setMasters;
  const dlg = $("scenesDlg");
  const form = $("saveSceneForm");
  const nameInput = $("sceneName");
  const shareBox = $("sceneShareBox");
  const shareCheck = $("sceneShare");
  const list = $("sceneList");
  wireDialog(dlg);

  const syncShare = () => { shareBox.hidden = !hasVault(); };
  onAuthChange(() => { syncShare(); if (dlg.open) render(); });

  function render(){
    const scenes = allScenes();
    list.innerHTML = "";
    if (!scenes.length){
      list.innerHTML = `<div class="empty">Nenhuma cena ainda. Ligue alguns sons e salve aqui.</div>`;
      return;
    }
    for (const [label, items] of [["Compartilhadas", scenes.filter(s => s.shared)], ["Deste aparelho", scenes.filter(s => !s.shared)]]){
      if (!items.length) continue;
      const head = document.createElement("div");
      head.className = "listHead";
      head.textContent = label;
      list.appendChild(head);
      for (const s of items){
        const row = document.createElement("div");
        row.className = "sceneItem" + (isActive(s) ? " active" : "");
        row.style.setProperty("--h", sceneHue(s));
        const names = s.ambients.slice(0, 3).map(titleOf).join(" · ") + (s.ambients.length > 3 ? ` +${s.ambients.length - 3}` : "");
        const canDelete = !s.shared || hasVault();
        row.innerHTML = `
          <button class="sceneApply" type="button">
            <span class="sceneIcon">${s.icon}</span>
            <span class="sceneText"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(names || sceneSummary(s))}</small></span>
          </button>
          ${!s.shared && hasVault() ? `<button class="btn icon" type="button" data-share title="Compartilhar com todos os aparelhos" aria-label="Compartilhar">☁️</button>` : ""}
          ${canDelete ? `<button class="btn icon danger" type="button" data-del aria-label="Excluir cena">🗑</button>` : ""}`;
        row.querySelector(".sceneApply").addEventListener("click", () => { applyScene(s); dlg.close(); });
        row.querySelector("[data-share]")?.addEventListener("click", async () => {
          try{
            const { shared: _s, ...clean } = s;
            const data = await publishShared({ ...clean, id: s.id, fx: undefined });
            writeLocal(localSets().filter(x => x.id !== s.id));
            setSharedData(data);
            render();
            toast("Cena compartilhada ✓");
          }catch(err){ if (!err.cancelled) toast(`Não foi possível compartilhar: ${explainError(err)}.`, 4000); }
        });
        row.querySelector("[data-del]")?.addEventListener("click", async () => {
          if (!confirm(`Excluir a cena “${s.name}”?${s.shared ? " Ela some de todos os aparelhos." : ""}`)) return;
          if (!s.shared){
            writeLocal(localSets().filter(x => x.id !== s.id));
            emit(); render();
            return;
          }
          try{
            setSharedData(await publishShared(null, { removeId: s.id }));
            render();
            toast("Cena excluída ✓");
          }catch(err){ if (!err.cancelled) toast(`Não foi possível excluir: ${explainError(err)}.`, 4000); }
        });
        list.appendChild(row);
      }
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name){ nameInput.focus(); return; }
    if (!engine.loops.size && !engine.spots.size){ toast("Ligue alguns ambientes antes de salvar a cena."); return; }
    const scene = snapshot(name);
    const wantsShare = hasVault() && shareCheck.checked;

    if (wantsShare){
      const existing = shared.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (existing && !confirm(`Já existe “${existing.name}”. Substituir?`)) return;
      try{
        setSharedData(await publishShared({ id: existing?.id ?? newId(), ...scene }));
        toast("Cena salva e compartilhada ✓");
      }catch(err){ if (!err.cancelled) toast(`Não foi possível compartilhar: ${explainError(err)}.`, 4000); return; }
    }else{
      const sets = localSets();
      const existing = sets.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (existing && !confirm(`Já existe “${existing.name}”. Substituir?`)) return;
      const entry = { id: existing?.id ?? newId(), name, icon: scene.icon, scene: { ...scene, fx: [] } };
      writeLocal(existing ? sets.map(x => x.id === existing.id ? entry : x) : [...sets, entry]);
      emit();
      toast("Cena salva ✓");
    }
    nameInput.value = "";
    render();
  });

  return {
    open(){ syncShare(); render(); dlg.showModal(); setTimeout(() => nameInput.blur(), 0); },
  };
}
