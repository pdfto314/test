let unlocked = false;

document.body.addEventListener("click", () => {
  unlocked = true;
}, { once: true });

async function loadPlaylist() {
  try {
    const response = await fetch("playlist.json?t=" + Date.now());
    const data = await response.json();
    render(data.categories);
  } catch (e) {
    document.getElementById("themes").innerHTML = "<p>Erro ao carregar playlist.json</p>";
  }
}

function render(categories) {
  const container = document.getElementById("themes");
  container.innerHTML = "";

  categories.forEach(cat => {
    const h2 = document.createElement("h2");
    h2.textContent = cat.name;
    container.appendChild(h2);

    cat.items.forEach(item => {
      const btn = document.createElement("button");
      btn.textContent = item.title;
      btn.onclick = () => playAudio(item);
      container.appendChild(btn);
    });
  });
}

function playAudio(item) {
  if (!unlocked) {
    alert("Toque primeiro em qualquer lugar para liberar áudio.");
    return;
  }

  const audio = new Audio(item.url);
  audio.loop = item.loop;
  audio.volume = item.volume || 1;
  audio.play().catch(err => console.error(err));
}

loadPlaylist();