
const OWNER = "pdfto314";
const REPO = "test";
const BRANCH = "main";
const AUDIO_PATH = "audio";

let unlocked = false;

// MULTI AMBIENT
const ambientPlayers = new Map(); // url -> Audio
const fxPlayers = new Map();

const LS_SETS = "jogatina_sets_multi_v1";

function ghUrl(path){
  const p = encodeURIComponent(path).replace(/%2F/g, "/");
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${p}?ref=${BRANCH}`;
}

async function listDir(path){
  const res = await fetch(ghUrl(path));
  return await res.json();
}

function nice(name){
  return name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g," ");
}

async function load(){
  const root = await listDir(AUDIO_PATH);
  const themes = root.filter(x=>x.type==="dir");
  const themesDiv = document.getElementById("themes");
  themesDiv.innerHTML="";

  for(const t of themes){
    const btn = document.createElement("button");
    btn.textContent = t.name;
    btn.onclick = ()=>openTheme(t.name);
    themesDiv.appendChild(btn);
  }
}

async function openTheme(name){
  const tracksDiv = document.getElementById("tracks");
  tracksDiv.innerHTML="";
  const files = await listDir(AUDIO_PATH+"/"+name);
  const audios = files.filter(f=>f.type==="file" && f.name.endsWith(".mp3"));

  for(const a of audios){
    const row = document.createElement("div");

    const title = document.createElement("span");
    title.textContent = nice(a.name);

    const vol = document.createElement("input");
    vol.type="range"; vol.min=0; vol.max=1; vol.step=0.01; vol.value=1;

    const ambBtn = document.createElement("button");
    ambBtn.textContent="Ambiente+";
    ambBtn.onclick = ()=>toggleAmbient(a.download_url, vol);

    const fxBtn = document.createElement("button");
    fxBtn.textContent="Efeito";
    fxBtn.onclick = ()=>playFx(a.download_url, vol);

    row.append(title, vol, ambBtn, fxBtn);
    tracksDiv.appendChild(row);
  }
}

function toggleAmbient(url, volSlider){
  if(ambientPlayers.has(url)){
    ambientPlayers.get(url).pause();
    ambientPlayers.delete(url);
    return;
  }
  const a = new Audio(url);
  a.loop = true;
  a.volume = parseFloat(volSlider.value);
  a.play();
  ambientPlayers.set(url,a);
}

function playFx(url, volSlider){
  const a = new Audio(url);
  a.volume = parseFloat(volSlider.value);
  a.play();
  fxPlayers.set(url,a);
}

function stopAllAmbient(){
  for(const a of ambientPlayers.values()) a.pause();
  ambientPlayers.clear();
}

function clearFx(){
  for(const a of fxPlayers.values()) a.pause();
  fxPlayers.clear();
}

// SETS COM MÚLTIPLOS AMBIENTES
function currentScene(){
  return {
    ambients:[...ambientPlayers.keys()],
    fx:[...fxPlayers.keys()]
  };
}

function readSets(){
  const raw = localStorage.getItem(LS_SETS);
  return raw ? JSON.parse(raw) : {sets:[]};
}

function writeSets(obj){
  localStorage.setItem(LS_SETS, JSON.stringify(obj));
}

function saveSet(){
  const name = document.getElementById("setName").value.trim();
  if(!name) return;
  const obj = readSets();
  obj.sets.push({id:Date.now(), name, scene:currentScene()});
  writeSets(obj);
  refreshSets();
}

function applySet(){
  const id = document.getElementById("setSelect").value;
  const obj = readSets();
  const s = obj.sets.find(x=>x.id==id);
  if(!s) return;

  stopAllAmbient();
  clearFx();

  for(const url of s.scene.ambients){
    const a = new Audio(url);
    a.loop=true;
    a.play();
    ambientPlayers.set(url,a);
  }
  for(const url of s.scene.fx){
    const a = new Audio(url);
    a.play();
    fxPlayers.set(url,a);
  }
}

function deleteSet(){
  const id = document.getElementById("setSelect").value;
  const obj = readSets();
  obj.sets = obj.sets.filter(x=>x.id!=id);
  writeSets(obj);
  refreshSets();
}

function refreshSets(){
  const sel = document.getElementById("setSelect");
  sel.innerHTML="";
  const obj = readSets();
  for(const s of obj.sets){
    const opt = document.createElement("option");
    opt.value=s.id;
    opt.textContent=s.name;
    sel.appendChild(opt);
  }
}

document.getElementById("saveSetBtn").onclick=saveSet;
document.getElementById("applySetBtn").onclick=applySet;
document.getElementById("deleteSetBtn").onclick=deleteSet;

document.getElementById("unlockBtn").onclick=async()=>{
  const a = new Audio();
  a.src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
  await a.play();
  unlocked=true;
};

refreshSets();
load();
