# 🎲 Jogatina Soundboard

Soundboard de mesa de RPG feito para o **iPad**: ambientes, trilhas, criaturas e efeitos, com cenas prontas e sons que tocam sozinhos.

## Usar no iPad

1. Abra o site no Safari → **Compartilhar → Adicionar à Tela de Início** (abre em tela cheia, como app).
2. Toque em **Começar a sessão** (ou **Continuar cena anterior**).
3. Na tela **Início** escolha uma **cena pronta** (Floresta à noite, Masmorra sombria, Tempestade…) ou abra um tema.

| Gesto | O que faz |
| --- | --- |
| **Toque** num ambiente (∞) | liga/desliga o loop, com fade |
| **Toque** num efeito (⚡, até 20 s) | toca uma vez |
| Botão do canto do card | o contrário (efeito em loop / ambiente 1×) |
| **Segurar** um som (ou clique direito no PC) | painel com loop, 1×, **🎲 aleatório**, volume, ⭐ favorito e ✏️ editar |

- **🎲 Aleatório**: o som toca sozinho de tempos em tempos (frequente, às vezes ou raro) — uma coruja na floresta, passos na masmorra.
- **🎬 Cenas**: guardam ambientes + aleatórios + volumes; trocar de cena faz transição suave. As **compartilhadas** (em `cenas.json`) aparecem em todos os aparelhos.
- **Uma trilha por vez**: ao tocar uma música de *Trilhas*, a anterior sai com fade (desligável em ⚙️ Ajustes).
- **🎲 Surpresa** em cada tema toca um efeito aleatório daquele tema.
- **⭐ Favoritos**, **🕘 Recentes** e **🔎 busca** (sons, temas e cenas).
- Embaixo, **Tocando** mostra tudo que está ativo com volume individual, visualizador e **Parar tudo**.
- A tela fica acesa enquanto houver som tocando.

## Organização dos sons

```
audio/
  Ambientes/   Chuva e Tempestade · Floresta e Campos · Mar e Porto · Cavernas e Masmorras · Rituais Sombrios
  Trilhas/     Keep on the Borderlands · Batalha · Tensão e Mistério · Cultistas
  Criaturas/   Aranha · Cavalo · Coruja · Dragão · Goblin · Lobo · Minotauro · Mortos-vivos · Rato · Warg
  Efeitos/     Combate
```

Cada pasta `audio/<Grupo>/<Tema>/` vira um tema; **o nome do arquivo é o nome do som**; sons de até 20 s viram efeitos.

## Gerenciar pelo iPad

Conecte uma vez em **⚙️ Ajustes → GitHub** com um token
(GitHub → Settings → Developer settings → *Fine-grained tokens* → *Only select repositories* (este) → *Contents: Read and write*).
O token fica salvo só naquele aparelho. Depois:

- **＋ Sons**: envia áudios para um tema existente ou cria tema/grupo novo.
- **Segurar um som → ✏️ Editar**: renomeia, move para outro tema ou remove (cenas e créditos são atualizados junto).
- **🎬 Cenas → Compartilhar**: salva a cena para todos os aparelhos.

Cada ação vira um commit; o GitHub Pages publica em ~1 minuto.

## Pelo PC (git)

Coloque arquivos em `audio/<Grupo>/<Tema>/` e faça commit + push na `main`. O GitHub Action
(`.github/workflows/playlist.yml`) atualiza o `playlist.json` sozinho — depois rode `git pull`.
Se o Action falhar ao dar push: *Settings → Actions → General → Workflow permissions → Read and write permissions*.

## Arquivos

| Arquivo | Para quê |
| --- | --- |
| `index.html`, `style.css` | página e visual |
| `js/app.js` | telas, navegação, painel do som, barra “Tocando” |
| `js/engine.js` | motor de áudio (Web Audio: volumes, fades, aleatórios, visualizador) |
| `js/library.js` | biblioteca, favoritos, recentes, créditos |
| `js/scenes.js` | cenas (do aparelho e compartilhadas) |
| `js/manage.js` | enviar / renomear / mover / remover sons |
| `js/github.js` | conexão e commits no GitHub |
| `js/util.js` | cores e ícones dos temas, utilidades |
| `playlist.json` | lista de sons (gerada; não precisa editar) |
| `cenas.json` | cenas compartilhadas |
| `credits.json` | autores e licenças dos sons do Freesound (ⓘ Créditos no app) |
| `renomeados.json` | caminhos antigos → novos (atualiza dados salvos no aparelho) |
| `ferramentas/` | `gerar_playlist.py` e scripts do Windows (gerar playlist, baixar do Freesound) |

Formatos aceitos: mp3, m4a, wav, ogg.
