let unlocked = false;

function $(id){ return document.getElementById(id); }

function setStatus(t){
  const el = $("status");
  if (el) el.textContent = t;
}

document.addEventListener("pointerdown", ()=>{ unlocked = true; }, { once:true, passive:true });
document.addEventListener("touchstart", ()=>{ unlocked = true; }, { once:true, passive:true });

async function loadPlaylist(){
  try{
    setStatus("Carregando playlist.json…");
    const r = await fetch("playlist.json?t=" + Date.now(), { cache:"no-store" });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    render(data.categories || []);
    setStatus("OK ✅");
  }catch(e){
    console.error(e);
    setStatus("Erro ao carregar playlist.json (rode generate_playlist.bat e faça push).");
  }
}

function render(categories){
  const root = $("themes");
  root.innerHTML = "";

  if (!categories.length){
    const p = document.createElement("div");
    p.style.opacity = ".8";
    p.textContent = "Nenhum tema encontrado. Rode generate_playlist.bat para gerar playlist.json.";
    root.appendChild(p);
    return;
  }

  categories.forEach(cat=>{
    const box = document.createElement("section");
    box.className = "theme";

    const h = document.createElement("h2");
    h.textContent = cat.name || "Sem nome";
    box.appendChild(h);

    const items = document.createElement("div");
    items.className = "items";

    (cat.items || []).forEach(item=>{
      const b = document.createElement("button");
      b.className = "btn track";
      b.textContent = item.title || "Sem título";
      b.addEventListener("click", ()=>play(item));
      items.appendChild(b);
    });

    box.appendChild(items);
    root.appendChild(box);
  });
}

function play(item){
  if(!unlocked){
    alert("Toque/click uma vez na página para liberar o áudio.");
    return;
  }
  const a = new Audio(item.url);
  a.loop = !!item.loop;
  a.volume = (typeof item.volume === "number") ? item.volume : 1;
  a.play().catch(err=>console.error(err));
}

$("reload")?.addEventListener("click", loadPlaylist);

loadPlaylist();
